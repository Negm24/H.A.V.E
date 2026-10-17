from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.accounts.services.customer_services.registration import create_customer_account
from apps.catalogue.models import Category, Product, ProductBatch
from apps.catalogue.services.catalogue_services import availability, product_data
from apps.orders.models import Order, OrderProduct, Receipt, StockReservation
from apps.orders.services.order_services import reserve_order, mark_paid, fulfil_order, cancel_order, expire_orders, order_data
from apps.orders.services.receipt_services import deliver_receipt
from apps.terminals.models import Terminal, TerminalSlot
from apps.terminals.services.inventory_services import set_stock


class OrderTests(TestCase):
    def setUp(self):
        self.user = create_customer_account(first_name="Order", last_name="Customer", phone_number="01012345678",
            email="orders@example.test", date_of_birth=date(2000, 1, 1), pin="4826")
        self.terminal = Terminal.objects.create(serial_number="ORDER-TEST", display_name="Test", address_en="Test",
            address_ar="تجريبي", latitude=0, longitude=0, device_credential_hash="0" * 64)
        self.category = Category.objects.create(name_en="Orders", name_ar="الطلبات")
        self.product = Product.objects.create(sku="ORDER-PRODUCT", category=self.category, name_en="Test product",
            name_ar="منتج تجريبي", pack_description="Test pack", price=Decimal("18.50"),
            usage_instructions_en="Test", usage_instructions_ar="تجريبي", max_quantity_per_order=None)
        self.batch = ProductBatch.objects.create(product=self.product, batch_number="ORDER-B1",
            expiry_date=timezone.localdate() + timedelta(days=30))
        self.slot = TerminalSlot.objects.create(terminal=self.terminal, slot_code="A1", product=self.product, capacity=30)
        self.stock = set_stock(slot_id=self.slot.pk, batch=self.batch, quantity=12)

    def reserve(self, **changes):
        values = dict(terminal=self.terminal, customer=self.user.customer, items={str(self.product.pk): 3},
            cart_version="a" * 32, email=self.user.email, channel="HUB", language="en",
            print_requested=False, idempotency_key=uuid4().hex)
        return reserve_order(**(values | changes))

    def test_reservation_snapshots_prices_and_reduces_availability_not_stock(self):
        order = self.reserve()
        self.assertEqual(order.subtotal, Decimal("55.50"))
        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertEqual(availability(self.terminal)[self.product.pk], 9)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)
        self.product.price = "21.50"
        self.product.save()
        self.assertEqual(order.items.get().unit_price, Decimal("18.50"))

    def test_idempotent_checkout_and_different_context_conflict(self):
        key = uuid4().hex
        first = self.reserve(idempotency_key=key)
        self.assertEqual(self.reserve(idempotency_key=key).pk, first.pk)
        self.assertEqual(StockReservation.objects.count(), 1)
        with self.assertRaises(AuthError):
            self.reserve(idempotency_key=key, items={str(self.product.pk): 4})

    def test_fefo_allocation_can_split_product_across_batches(self):
        other_batch = ProductBatch.objects.create(product=self.product, batch_number="EARLIER",
            expiry_date=timezone.localdate() + timedelta(days=1))
        earlier = set_stock(slot_id=self.slot.pk, batch=other_batch, quantity=2)
        order = self.reserve()
        self.assertEqual([(line.terminal_stock_id, line.quantity_requested) for line in order.items.all()], [(earlier.pk, 2), (self.stock.pk, 1)])

    def test_no_oversell_and_all_or_nothing_reservations(self):
        self.reserve(items={str(self.product.pk): 10})
        with self.assertRaises(AuthError):
            self.reserve(items={str(self.product.pk): 3})
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(availability(self.terminal)[self.product.pk], 2)

    def test_null_limit_uses_stock_but_legitimate_limit_remains_enforced(self):
        self.assertEqual(product_data(self.product, availability(self.terminal))["quantity_limit"], 12)
        self.reserve(items={str(self.product.pk): 4})
        self.product.max_quantity_per_order = 2
        self.product.save()
        with self.assertRaises(AuthError):
            self.reserve(items={str(self.product.pk): 3})

    def test_stock_only_cap_and_nonnegative_constraints(self):
        for changes in [{"price": -1}, {"max_quantity_per_order": 0}]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                Product.objects.filter(pk=self.product.pk).update(**changes)

    def test_expired_disabled_prescription_and_inconsistent_stock_fail_closed(self):
        self.product.requires_prescription = True
        self.product.save()
        with self.assertRaises(AuthError):
            self.reserve()
        self.product.requires_prescription = False
        self.product.save()
        self.batch.expiry_date = timezone.localdate() - timedelta(days=1)
        self.batch.save()
        with self.assertRaises(AuthError):
            self.reserve()
        self.batch.expiry_date = timezone.localdate() + timedelta(days=1)
        self.batch.save()
        self.terminal.is_disabled = True
        self.terminal.save()
        with self.assertRaises(AuthError):
            self.reserve()
        self.assertFalse(Order.objects.exists())

    def test_guest_needs_email_and_print_but_not_account(self):
        for changes in [{"email": ""}, {"email": "not-an-email"}, {"customer": None, "print_requested": False}]:
            with self.assertRaises(AuthError):
                self.reserve(**changes)
        order = self.reserve(channel="TERMINAL", customer=None, print_requested=True, terminal_session_id=uuid4())
        self.assertIsNone(order.customer_id)

    def test_hub_payment_preserves_stock_and_sets_one_fixed_collection_deadline(self):
        order = self.reserve()
        paid = mark_paid(order.pk)
        deadline = paid.collection_deadline
        self.assertAlmostEqual((deadline - paid.paid_at).total_seconds(), 86400)
        self.assertTrue(Receipt.objects.filter(order=order).exists())
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)
        self.assertEqual(mark_paid(order.pk).collection_deadline, deadline)
        with self.assertRaises(AuthError):
            mark_paid(order.pk, amount="0.01")

    def test_simulated_fulfilment_is_idempotent_and_receipt_snapshot_immutable(self):
        order = self.reserve(channel="TERMINAL")
        mark_paid(order.pk)
        completed = fulfil_order(order.pk, terminal=self.terminal)
        self.assertEqual(completed.status, Order.Status.COMPLETED)
        self.assertTrue(completed.completed_at)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 9)
        self.assertEqual(StockReservation.objects.get().status, StockReservation.Status.CONSUMED)
        self.assertEqual(fulfil_order(order.pk).pk, order.pk)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 9)
        receipt = Receipt.objects.get(order=order)
        receipt.receipt_snapshot = {"changed": True}
        with self.assertRaises(ValidationError):
            receipt.save()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Receipt.objects.filter(pk=receipt.pk).update(receipt_snapshot={"bypass": True})
        self.assertEqual(order_data(completed)["receipt"]["snapshot"]["total_paid"], "55.50")

    def test_hub_collection_cannot_be_replayed_at_another_terminal(self):
        order = self.reserve()
        mark_paid(order.pk)
        other = Terminal(serial_number="WRONG")
        with self.assertRaises(AuthError):
            fulfil_order(order.pk, terminal=other)
        self.assertEqual(fulfil_order(order.pk, terminal=self.terminal).status, Order.Status.COMPLETED)

    def test_expired_collection_rejects_even_before_worker_and_releases_once(self):
        order = self.reserve()
        mark_paid(order.pk)
        Order.objects.filter(pk=order.pk).update(collection_deadline=timezone.now() - timedelta(seconds=1))
        with self.assertRaises(AuthError):
            fulfil_order(order.pk)
        order.refresh_from_db()
        self.assertEqual((order.status, order.cancellation_reason), (Order.Status.CANCELLED, "COLLECTION_EXPIRED"))
        self.assertEqual(availability(self.terminal)[self.product.pk], 12)
        self.assertEqual(expire_orders(), [])
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_worker_only_releases_definitive_unpaid_or_expired_paid_orders(self):
        first = self.reserve()
        second = self.reserve(items={str(self.product.pk): 2})
        Order.objects.filter(pk__in=[first.pk, second.pk]).update(expires_at=timezone.now() - timedelta(minutes=1))
        Order.objects.filter(pk=second.pk).update(payment_uncertain=True)
        self.assertEqual([row.pk for row in expire_orders()], [first.pk])
        # An expired deadline is not permission to release possibly paid stock.
        self.assertEqual(availability(self.terminal)[self.product.pk], 10)
        with self.assertRaises(AuthError):
            cancel_order(second.pk)
        cancel_order(second.pk, definitive_unpaid=True)
        self.assertEqual(availability(self.terminal)[self.product.pk], 12)

    def test_collection_expiry_worker_releases_without_incrementing_on_hand(self):
        order = self.reserve()
        paid = mark_paid(order.pk)
        self.assertEqual([row.pk for row in expire_orders(now=paid.collection_deadline)], [order.pk])
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)
        self.assertEqual(order.items.get().reservations.get().status, StockReservation.Status.EXPIRED)

    def test_stock_drift_requires_review_and_no_partial_decrement(self):
        order = self.reserve()
        mark_paid(order.pk)
        set_stock(slot_id=self.slot.pk, batch=self.batch, quantity=1)
        with self.assertRaises(AuthError):
            fulfil_order(order.pk)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.REVIEW_REQUIRED)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 1)
        self.assertEqual(order.items.get().quantity_dispensed, 0)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_receipt_delivery_markers_retry_and_do_not_change_snapshot(self):
        order = self.reserve()
        mark_paid(order.pk)
        receipt = Receipt.objects.get(order=order)
        original = receipt.receipt_snapshot
        with patch("apps.orders.services.receipt_services.send_mail", side_effect=RuntimeError("private SMTP detail")):
            self.assertFalse(deliver_receipt(receipt.pk))
        receipt.refresh_from_db()
        self.assertEqual(receipt.email_attempts, 1)
        self.assertNotIn("private", receipt.last_email_error)
        Receipt.objects.filter(pk=receipt.pk).update(next_email_at=timezone.now() - timedelta(seconds=1))
        self.assertTrue(deliver_receipt(receipt.pk))
        self.assertTrue(deliver_receipt(receipt.pk))
        receipt.refresh_from_db()
        self.assertEqual(receipt.receipt_snapshot, original)
        self.assertEqual(receipt.email_attempts, 2)

    def test_finalized_purchase_relationships_cannot_be_cascade_deleted(self):
        order = self.reserve()
        for record in [self.user.customer, self.terminal, self.product, self.stock]:
            with self.assertRaises(ProtectedError):
                record.delete()
        with self.assertRaises(ProtectedError):
            order.delete()

    def test_print_stub_is_called_once_and_never_claims_real_printing(self):
        from apps.orders.services.printing_services import print_receipt_stub
        order = self.reserve(channel="TERMINAL", customer=None, print_requested=True)
        mark_paid(order.pk)
        with patch("apps.orders.services.order_services.print_receipt_stub", wraps=print_receipt_stub) as printing:
            fulfil_order(order.pk)
            fulfil_order(order.pk)
        printing.assert_called_once()
        snapshot = Receipt.objects.get(order=order).receipt_snapshot
        self.assertEqual(snapshot["printing"], "SIMULATED_REQUESTED")
        self.assertIn("no physical printer", snapshot["printing_note"])

    def test_go_green_receipt_has_no_print_request(self):
        order = self.reserve(print_requested=False)
        mark_paid(order.pk)
        self.assertEqual(Receipt.objects.get(order=order).receipt_snapshot["printing"], "GO_GREEN")

    def test_late_verified_payment_after_cancel_is_recorded_but_never_dispensed(self):
        order = self.reserve()
        cancel_order(order.pk, "CHECKOUT_EXPIRED", definitive_unpaid=True)
        paid = mark_paid(order.pk)
        self.assertEqual(paid.status, "CANCELLED")
        self.assertEqual(paid.total_paid, Decimal("55.50"))
        with self.assertRaises(AuthError):
            fulfil_order(order.pk)
        self.assertEqual(availability(self.terminal)[self.product.pk], 12)
        self.assertEqual(Receipt.objects.get(order=order).receipt_snapshot["fulfilment"], "CANCELLED_REFUND_PENDING")
