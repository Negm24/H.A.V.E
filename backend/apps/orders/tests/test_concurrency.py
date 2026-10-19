from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from threading import Barrier
from uuid import uuid4

from django.db import close_old_connections, connections
from django.test import TransactionTestCase
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.accounts.services.customer_services.registration import create_customer_account
from apps.catalogue.models import Category, Product, ProductBatch
from apps.orders.models import Order, Receipt, StockReservation
from apps.orders.services.order_services import reserve_order, mark_paid, fulfil_order
from apps.terminals.models import Terminal, TerminalSlot
from apps.terminals.services.inventory_services import set_stock


class PurchaseConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = create_customer_account(first_name="Parallel", last_name="Customer", phone_number="01012345678",
            email="parallel@example.test", date_of_birth=date(2000, 1, 1), pin="4826")
        self.terminal = Terminal.objects.create(serial_number="PARALLEL", display_name="Test", address_en="Test",
            address_ar="تجريبي", latitude=0, longitude=0, device_credential_hash="0" * 64)
        category = Category.objects.create(name_en="Parallel", name_ar="متزامن")
        self.product = Product.objects.create(sku="PARALLEL", category=category, name_en="Test", name_ar="تجريبي",
            price="10.00", pack_description="Pack", usage_instructions_en="Test", usage_instructions_ar="تجريبي")
        batch = ProductBatch.objects.create(product=self.product, batch_number="B1",
            expiry_date=timezone.localdate() + timedelta(days=30))
        slot = TerminalSlot.objects.create(terminal=self.terminal, product=self.product, slot_code="A1", capacity=20)
        self.stock = set_stock(slot_id=slot.pk, batch=batch, quantity=12)

    def reserve(self, key=None):
        return reserve_order(terminal=self.terminal, customer=self.user.customer, items={str(self.product.pk): 8},
            cart_version="parallel", email=self.user.email, channel="TERMINAL", idempotency_key=key or uuid4().hex)

    def parallel(self, operation):
        barrier = Barrier(2)
        def run():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return operation()
            except AuthError:
                return None
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            return list(pool.map(lambda _: run(), range(2)))

    def test_two_checkouts_cannot_reserve_the_same_remaining_stock(self):
        result = self.parallel(lambda: self.reserve().pk)
        self.assertEqual(sum(row is not None for row in result), 1)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(StockReservation.objects.get().quantity, 8)

    def test_two_matching_requests_share_one_idempotent_order(self):
        key = uuid4().hex
        result = self.parallel(lambda: self.reserve(key).pk)
        self.assertIsNotNone(result[0])
        self.assertEqual(result[0], result[1])
        self.assertEqual(Order.objects.count(), 1)

    def test_concurrent_collection_decrements_stock_once(self):
        order = self.reserve()
        mark_paid(order.pk)
        self.parallel(lambda: fulfil_order(order.pk).pk)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 4)
        self.assertEqual(Receipt.objects.filter(order=order).count(), 1)
        self.assertEqual(StockReservation.objects.get().status, StockReservation.Status.CONSUMED)

    def test_cross_app_new_keys_cannot_create_two_unpaid_attempts_for_customer_machine(self):
        def create():
            return reserve_order(terminal=self.terminal, customer=self.user.customer,
                items={str(self.product.pk): 2}, cart_version="same-saved-basket", email=self.user.email,
                channel="HUB", idempotency_key=uuid4().hex, prevent_duplicate_checkout=True).pk
        result = self.parallel(create)
        self.assertEqual(sum(row is not None for row in result), 1)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(StockReservation.objects.get().quantity, 2)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)
