from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.orders.models import StockReservation
from apps.orders.services.order_services import mark_paid, fulfil_order, cancel_order
from apps.operations.models import OwnerAction
from apps.operations.services.actions import submit_order_action, run_pending_actions
from apps.payments.models import PaymentTransaction
from .helpers import OperationsFixtures


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class DurableActionTests(OperationsFixtures, TestCase):
    def setUp(self):
        self.setup_operations()

    def submit(self, order, action, action_id=None):
        return submit_order_action(actor=self.owner, order_id=order.pk, action=action, action_id=action_id or uuid4())

    def test_cancel_is_queued_durable_idempotent_and_runs_once(self):
        order = self.reserve()
        identity = uuid4()
        job = self.submit(order, "cancel", identity)
        self.assertEqual(job.status, "QUEUED")
        self.assertEqual(self.submit(order, "cancel", identity).pk, job.pk)
        self.assertEqual(run_pending_actions(), 1)
        self.assertEqual(run_pending_actions(), 0)
        job.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(job.status, "SUCCEEDED")
        self.assertEqual(order.status, "CANCELLED")
        self.assertEqual(StockReservation.objects.get().status, "RELEASED")

    def test_completed_order_cannot_be_cancelled(self):
        order = self.reserve()
        mark_paid(order.pk)
        fulfil_order(order.pk)
        with self.assertRaises(AuthError):
            self.submit(order, "cancel")
        self.assertFalse(OwnerAction.objects.exists())

    def test_reconcile_preserves_unknown_and_never_blindly_replays_job(self):
        order = self.reserve()
        PaymentTransaction.objects.create(order=order, operation="CAPTURE", amount=order.customer_payable_amount,
            idempotency_key=uuid4().hex, status="UNKNOWN")
        job = self.submit(order, "reconcile")
        with patch("apps.operations.services.actions.reconcile") as reconcile:
            self.assertEqual(run_pending_actions(), 1)
            self.assertEqual(run_pending_actions(), 0)
        reconcile.assert_called_once()
        job.refresh_from_db()
        self.assertEqual(job.status, "UNKNOWN")
        self.assertEqual(job.result["payment_status"], "UNKNOWN")

    def test_receipt_lease_remains_pending_without_fake_success(self):
        order = self.reserve()
        mark_paid(order.pk)
        receipt = order.receipt
        receipt.next_email_at = timezone.now() + timedelta(minutes=5)
        receipt.save(update_fields=["next_email_at"])
        job = self.submit(order, "retry-receipt")
        with patch("apps.orders.services.receipt_services.send_mail") as send:
            run_pending_actions()
        send.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, "UNKNOWN")
        receipt.refresh_from_db()
        self.assertIsNone(receipt.email_sent_at)

    def test_stale_running_job_becomes_unknown_without_replaying_external_effect(self):
        order = self.reserve()
        job = self.submit(order, "cancel")
        OwnerAction.objects.filter(pk=job.pk).update(status="RUNNING", started_at=timezone.now() - timedelta(minutes=6))
        with patch("apps.operations.services.actions.cancel_purchase") as cancel:
            run_pending_actions()
        cancel.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, "UNKNOWN")

    def test_postcommit_metrics_emit_only_once_for_authoritative_transition(self):
        order = self.reserve()
        with patch("apps.observability.metrics.record_outcome") as record, self.captureOnCommitCallbacks(execute=True):
            cancel_order(order.pk)
            cancel_order(order.pk)
        record.assert_called_once_with("order.cancelled")

    def test_review_readers_include_unknown_payments_and_failed_refunds_as_distinct_orders(self):
        from apps.operations.api.readers import overview, records
        order = self.reserve()
        capture = PaymentTransaction.objects.create(order=order, operation="CAPTURE", amount=order.customer_payable_amount,
            idempotency_key=uuid4().hex, status="UNKNOWN")
        PaymentTransaction.objects.create(order=order, operation="REFUND", amount=order.customer_payable_amount,
            idempotency_key=uuid4().hex, status="FAILED", related_transaction=capture)
        self.assertEqual(overview()["review_payments"], 1)
        self.assertEqual(list(records("orders", {"status": "REVIEW_PAYMENTS"}).values_list("pk", flat=True)), [order.pk])
        PaymentTransaction.objects.filter(pk=capture.pk).update(status="SUCCEEDED")
        self.assertEqual(overview()["review_payments"], 1)
        PaymentTransaction.objects.filter(order=order, operation="REFUND").update(status="SUCCEEDED")
        self.assertEqual(overview()["review_payments"], 0)
