from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

from django.core.exceptions import ValidationError
from django.db import close_old_connections
from django.test import TransactionTestCase
from django.utils import timezone

from apps.accounts.tests.helpers import SessionFixtures
from apps.accounts.security.errors import AuthError
from apps.catalogue.models import Category, Product, ProductBatch
from apps.terminals.models import TerminalSlot
from apps.terminals.services.cart_services import change_cart, get_cart
from apps.terminals.services.inventory_services import set_stock


class InventoryConcurrencyTests(SessionFixtures, TransactionTestCase):
    def setUp(self):
        self.setup_sessions()
        category = Category.objects.create(name_en="Concurrency", name_ar="اختبار")
        self.product = Product.objects.create(category=category, sku="CONCURRENT", name_en="Test", name_ar="اختبار",
            pack_description="Pack", price="10.25", max_quantity_per_order=6, usage_instructions_en="Demo", usage_instructions_ar="تجريبي")
        self.slot = TerminalSlot.objects.create(terminal=self.terminal, product=self.product, slot_code="C1", capacity=6)
        self.batches = [ProductBatch.objects.create(product=self.product, batch_number=str(i), expiry_date=timezone.localdate() + timedelta(days=30)) for i in range(2)]

    def test_slot_lock_prevents_parallel_overfilling(self):
        barrier = Barrier(2)
        def write(batch):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                set_stock(slot_id=self.slot.pk, batch=batch, quantity=5)
                return True
            except ValidationError:
                return False
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as executor:
            result = list(executor.map(write, self.batches))
        self.assertEqual(sorted(result), [False, True])
        self.assertEqual(sum(self.slot.stock.values_list("quantity_on_hand", flat=True)), 5)

    def test_parallel_cart_puts_set_absolute_quantities_without_reserving_stock(self):
        set_stock(slot_id=self.slot.pk, batch=self.batches[0], quantity=6)
        token = self.start_guest()
        version = get_cart(self.terminal, token)["version"]
        barrier = Barrier(2)
        def write(quantity):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                change_cart(self.terminal, token, product_id=self.product.pk, quantity=quantity, expected_version=version)
                return "ok"
            except AuthError as exc:
                return exc.status
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(write, [1, 2]))
        self.assertCountEqual(results, ["ok", 409])
        self.assertIn(get_cart(self.terminal, token)["total_quantity"], [1, 2])
        self.assertEqual(self.slot.stock.get().quantity_on_hand, 6)
