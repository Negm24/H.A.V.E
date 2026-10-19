from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.management import call_command, CommandError
from django.db import DatabaseError
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.orders.models import Order, Receipt, StockReservation
from apps.orders.services.notification_services import send_order_notice
from apps.orders.services.order_services import mark_paid
from apps.orders.tests import test_orders as fixtures
from apps.payments.models import PaymentTransaction
from apps.payments.services.worker_services import run_cycle


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class OrderMaintenanceTests(TestCase):
    def setUp(self):
        fixtures.OrderTests.setUp(self)
        # Worker connection hygiene is for a long-running process, not the
        # enclosing atomic transaction maintained by Django TestCase.
        close = patch("apps.payments.services.worker_services.close_old_connections")
        close.start()
        self.addCleanup(close.stop)
        cleanup = patch("apps.payments.services.worker_services.clear_purchased_cart")
        self.clear_cart = cleanup.start()
        self.addCleanup(cleanup.stop)

    def reserve(self, **changes):
        return fixtures.OrderTests.reserve(self, **changes)

    def paid(self, **changes):
        order = self.reserve(**changes)
        capture = PaymentTransaction.objects.create(order=order, operation="CAPTURE", amount=order.customer_payable_amount,
            status="SUCCEEDED", idempotency_key=f"capture:{order.pk}", provider_reference=f"capture-{order.pk}")
        return mark_paid(order.pk), capture

    def test_restart_recovers_payment_committed_before_terminal_fulfilment(self):
        from uuid import uuid4
        from apps.accounts.security.state import get_redis_client
        from apps.terminals.security.state import session_key
        from apps.terminals.services.session_services import operate
        override = override_settings(AUTH_REDIS_PREFIX="have:test:worker:" + uuid4().hex + ":")
        override.enable(); self.addCleanup(override.disable)
        self.addCleanup(get_redis_client().delete, session_key(self.terminal.pk))
        self.user.phone_verified_at = timezone.now(); self.user.save(update_fields=["phone_verified_at"])
        _, guest = operate(self.terminal, "start")
        state, _ = operate(self.terminal, "login", guest, user=self.user)
        order, _ = self.paid(channel="TERMINAL", terminal_session_id=state["session_id"])
        self.assertEqual(order.status, "PENDING")
        result = run_cycle()
        order.refresh_from_db()
        self.assertEqual(order.status, "COMPLETED")
        self.assertEqual(result["fulfilled"], 1)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 9)
        # Work created during a batch is eligible on its next bounded cycle.
        run_cycle()
        receipt = Receipt.objects.get(order=order)
        self.assertIsNotNone(receipt.email_sent_at)
        run_cycle()
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 9)
        self.assertEqual(Receipt.objects.filter(order=order).count(), 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_expiry_creates_one_durable_full_refund_and_processing_then_confirmation_emails(self):
        order, capture = self.paid()
        Order.objects.filter(pk=order.pk).update(collection_deadline=timezone.now() - timedelta(seconds=1))
        # Initial expiry persists the refund intent; the worker can crash after
        # this cycle and still discover that same record after restart.
        with patch("apps.payments.services.worker_services.process_refund"):
            run_cycle()
        order.refresh_from_db()
        self.assertEqual((order.status, order.cancellation_reason), ("CANCELLED", "COLLECTION_EXPIRED"))
        self.assertIsNotNone(order.expiry_email_sent_at)
        self.assertIsNone(order.refund_email_sent_at)
        refund = PaymentTransaction.objects.get(order=order, operation="REFUND")
        self.assertEqual((refund.amount, refund.related_transaction_id), (order.total_paid, capture.pk))
        self.assertTrue(any("is being processed" in message.body for message in mail.outbox))
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)
        self.assertEqual(StockReservation.objects.get().status, "EXPIRED")
        PaymentTransaction.objects.filter(pk=refund.pk).update(status="SUCCEEDED")
        Order.objects.filter(pk=order.pk).update(total_refunded=order.total_paid)
        run_cycle()
        order.refresh_from_db()
        self.assertIsNotNone(order.refund_email_sent_at)
        self.assertEqual(order.expiry_email_attempts, 1)
        self.assertEqual(order.refund_email_attempts, 1)
        self.assertEqual(PaymentTransaction.objects.filter(order=order, operation="REFUND").count(), 1)
        self.assertTrue(any("provider confirmed a full refund" in message.body for message in mail.outbox))
        sent = len(mail.outbox)
        run_cycle()
        self.assertEqual(len(mail.outbox), sent)

    def test_refund_confirmation_never_sent_before_provider_confirms_full_amount(self):
        order, _ = self.paid()
        Order.objects.filter(pk=order.pk).update(status="CANCELLED", cancellation_reason="CUSTOMER_CANCELLED", total_refunded="1.00")
        self.assertFalse(send_order_notice(order.pk, "refund"))
        self.assertFalse(mail.outbox)
        order.refresh_from_db()
        self.assertEqual(order.refund_email_attempts, 0)

    def test_notice_failure_is_sanitized_and_backoff_and_lease_survive_restart(self):
        order, _ = self.paid(language="ar")
        Order.objects.filter(pk=order.pk).update(status="CANCELLED", cancellation_reason="COLLECTION_EXPIRED")
        with patch("apps.orders.services.notification_services.send_mail", side_effect=RuntimeError("private SMTP credentials")):
            self.assertFalse(send_order_notice(order.pk, "expiry"))
        order.refresh_from_db()
        self.assertEqual(order.expiry_email_attempts, 1)
        self.assertNotIn("private", order.expiry_email_last_error)
        self.assertGreater(order.expiry_email_next_attempt_at, timezone.now())
        self.assertFalse(send_order_notice(order.pk, "expiry"))
        order.refresh_from_db()
        self.assertEqual(order.expiry_email_attempts, 1)
        Order.objects.filter(pk=order.pk).update(expiry_email_next_attempt_at=timezone.now() - timedelta(seconds=1),
            expiry_email_lease_until=timezone.now() + timedelta(minutes=1))
        self.assertFalse(send_order_notice(order.pk, "expiry"))
        Order.objects.filter(pk=order.pk).update(expiry_email_lease_until=timezone.now() - timedelta(seconds=1))
        self.assertTrue(send_order_notice(order.pk, "expiry"))
        self.assertIn("انتهت مهلة", mail.outbox[-1].subject)
        order.refresh_from_db()
        self.assertEqual(order.expiry_email_attempts, 2)

    def test_uncertain_payment_keeps_stock_and_worker_reconciles_only_due_unleased_work(self):
        order = self.reserve()
        Order.objects.filter(pk=order.pk).update(payment_uncertain=True, expires_at=timezone.now() - timedelta(hours=1))
        payment = PaymentTransaction.objects.create(order=order, operation="CAPTURE", amount=order.customer_payable_amount,
            status="UNKNOWN", idempotency_key=f"capture:{order.pk}", lease_until=timezone.now() + timedelta(minutes=1))
        with patch("apps.payments.services.worker_services.reconcile") as reconcile:
            run_cycle()
            reconcile.assert_not_called()
            PaymentTransaction.objects.filter(pk=payment.pk).update(lease_until=timezone.now() - timedelta(seconds=1))
            run_cycle()
            reconcile.assert_called_once_with(payment.pk)
        order.refresh_from_db()
        self.assertEqual(order.status, "PENDING")
        self.assertEqual(StockReservation.objects.get().status, "ACTIVE")

    def test_once_command_exits_and_rejects_invalid_intervals(self):
        output = StringIO()
        with patch("apps.payments.management.commands.order_worker.run_cycle", return_value={"errors": 0}) as work:
            call_command("order_worker", once=True, stdout=output)
        work.assert_called_once()
        self.assertIn('"errors": 0', output.getvalue())
        with self.assertRaises(CommandError):
            call_command("order_worker", once=True, interval=0, stdout=StringIO())

    def test_paid_cart_cleanup_retries_after_redis_outage_and_is_durable(self):
        order, _ = self.paid()
        self.clear_cart.side_effect = RuntimeError("Redis is offline")
        result = run_cycle()
        order.refresh_from_db()
        self.assertIsNone(order.cart_cleanup_completed_at)
        self.assertGreater(result["errors"], 0)
        self.clear_cart.side_effect = None
        run_cycle()
        order.refresh_from_db()
        self.assertIsNotNone(order.cart_cleanup_completed_at)
        self.assertEqual(self.clear_cart.call_count, 2)
        run_cycle()
        self.assertEqual(self.clear_cart.call_count, 2)

    def test_later_basket_edits_are_reported_as_preserved_after_paid_cleanup(self):
        order, _ = self.paid()
        self.clear_cart.return_value = False
        run_cycle()
        order.refresh_from_db()
        self.assertTrue(order.cart_preserved)
        self.assertIsNotNone(order.cart_cleanup_completed_at)

    def test_cancelled_late_capture_does_not_clear_the_customer_basket(self):
        order, _ = self.paid()
        Order.objects.filter(pk=order.pk).update(status="CANCELLED", cancellation_reason="CHECKOUT_EXPIRED")
        with patch("apps.payments.services.worker_services.process_refund"):
            run_cycle()
        self.clear_cart.assert_not_called()

    def test_database_outage_does_not_discard_worker_process(self):
        output, errors = StringIO(), StringIO()
        with patch("apps.payments.management.commands.order_worker.run_cycle", side_effect=DatabaseError("private DSN")):
            call_command("order_worker", once=True, stdout=output, stderr=errors)
        self.assertIn('"errors": 1', output.getvalue())
        self.assertNotIn("private", errors.getvalue())
