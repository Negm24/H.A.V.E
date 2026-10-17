from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.core.management import call_command, CommandError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase, override_settings
from django.utils import timezone
from redis.exceptions import ConnectionError as RedisConnectionError

from apps.accounts.tests.helpers import SessionFixtures, SESSIONS
from apps.catalogue.models import Category, Product, ProductBatch
from apps.catalogue.services.catalogue_services import availability
from apps.terminals.models import TerminalSlot, TerminalStock, Terminal
from apps.terminals.services.inventory_services import set_stock

BASE = "/api/v1/terminals/"


class CatalogueTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.category = Category.objects.create(name_en="Test", name_ar="اختبار")
        self.product = Product.objects.create(sku="TEST", category=self.category, name_en="Sample", name_ar="عينة",
            pack_description="24 tablets", price=Decimal("18.50"), max_quantity_per_order=3,
            usage_instructions_en="Demo only", usage_instructions_ar="تجريبي")
        self.batch = ProductBatch.objects.create(product=self.product, batch_number="B1", expiry_date=timezone.localdate() + timedelta(days=30))
        self.slot = TerminalSlot.objects.create(terminal=self.terminal, slot_code="A1", product=self.product, capacity=10)
        self.stock = set_stock(slot_id=self.slot.pk, batch=self.batch, quantity=6)
        self.token = self.start_guest()

    def get(self, path, token=None, headers=None):
        return self.client.get(BASE + path, HTTP_AUTHORIZATION="Bearer " + (token or self.token), **(headers or self.headers))

    def put(self, quantity, product=None, **extra):
        version = self.get("cart/").json().get("version", "empty")
        return self.client.put(BASE + f"cart/items/{(product or self.product).pk}/", {"quantity": quantity, "expected_version": version, **extra}, format="json",
            HTTP_AUTHORIZATION="Bearer " + self.token, **self.headers)

    def test_catalogue_and_detail_have_real_decimal_stock_and_null_images(self):
        row = self.get("catalogue/products/").json()[0]
        self.assertEqual((row["price"], row["stock_quantity"], row["quantity_limit"], row["image_url"]), ("18.50", 6, 3, None))
        self.assertEqual(self.get(f"catalogue/products/{self.product.pk}/").json(), row)
        self.assertEqual(self.get("catalogue/categories/").json()[0]["product_count"], 1)

    def test_zero_stock_visible_but_not_addable(self):
        set_stock(slot_id=self.slot.pk, batch=self.batch, quantity=0)
        self.assertEqual(len(self.get("catalogue/products/").json()), 1)
        self.assertEqual(self.put(1).status_code, 400)

    def test_expired_disabled_and_inconsistent_inventory_excluded(self):
        self.batch.expiry_date = timezone.localdate() - timedelta(days=1)
        self.batch.save()
        self.assertEqual(availability(self.terminal).get(self.product.pk, 0), 0)
        self.slot.is_enabled = False
        self.slot.save()
        self.assertEqual(self.get("catalogue/products/").json(), [])

    def test_overcapacity_and_mismatched_sql_rows_fail_closed(self):
        TerminalStock.objects.filter(pk=self.stock.pk).update(quantity_on_hand=11)
        self.assertEqual(availability(self.terminal).get(self.product.pk, 0), 0)
        TerminalStock.objects.filter(pk=self.stock.pk).update(quantity_on_hand=1)
        other = Product.objects.create(sku="OTHER", category=self.category, name_en="Other", name_ar="آخر", price=1,
            max_quantity_per_order=2, pack_description="Pack", usage_instructions_en="Demo", usage_instructions_ar="تجريبي")
        ProductBatch.objects.filter(pk=self.batch.pk).update(product=other)
        self.assertEqual(availability(self.terminal).get(self.product.pk, 0), 0)

    def test_other_terminal_and_inactive_products_do_not_leak(self):
        other = Terminal.objects.create(serial_number="OTHER", display_name="Other", address_en="X", address_ar="X", latitude=0, longitude=0, device_credential_hash="0" * 64)
        self.slot.terminal = other
        self.slot.save()
        self.assertEqual(self.get("catalogue/products/").json(), [])
        self.assertEqual(self.get(f"catalogue/products/{self.product.pk}/").status_code, 404)
        self.slot.terminal = self.terminal
        self.slot.save()
        self.category.is_active = False
        self.category.save()
        self.assertEqual(self.get("catalogue/categories/").json(), [])

    def test_inventory_writes_enforce_product_and_total_capacity(self):
        batch = ProductBatch.objects.create(product=self.product, batch_number="B2", expiry_date=self.batch.expiry_date)
        with self.assertRaises(ValidationError):
            set_stock(slot_id=self.slot.pk, batch=batch, quantity=5)
        self.assertFalse(TerminalStock.objects.filter(batch=batch).exists())
        for quantity in [-1, True, 1.5]:
            with self.assertRaises(ValidationError):
                set_stock(slot_id=self.slot.pk, batch=batch, quantity=quantity)

    def test_constraints_and_protection(self):
        with self.assertRaises(ProtectedError):
            self.product.delete()
        for model, pk, changes in [(Product, self.product.pk, {"price": -1}),
                                   (Product, self.product.pk, {"max_quantity_per_order": 0}),
                                   (TerminalSlot, self.slot.pk, {"capacity": 0}),
                                   (TerminalStock, self.stock.pk, {"quantity_on_hand": -1})]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                model.objects.filter(pk=pk).update(**changes)

    def test_cart_uses_database_prices_and_absolute_quantities(self):
        response = self.put(2, price="0.01").json()
        self.assertEqual((response["total"], response["total_quantity"]), ("37.00", 2))
        self.assertEqual(self.put(2).json()["total_quantity"], 2)
        self.product.price = Decimal("20.00")
        self.product.save()
        self.assertEqual(self.get("cart/").json()["total"], "40.00")
        self.assertEqual(self.put(0).json()["items"], [])

    def test_invalid_quantity_stock_limit_and_prescription(self):
        for quantity in [True, "2", -1, 1.5, 4]:
            self.assertEqual(self.put(quantity).status_code, 400)
        self.product.requires_prescription = True
        self.product.save()
        self.assertEqual(self.put(1).status_code, 400)

    def test_cart_reads_and_writes_preserve_clocks_and_ttl(self):
        before = self.state()
        self.put(1)
        self.get("cart/")
        self.get("catalogue/products/")
        after = self.state()
        self.assertEqual(before["started_at"], after["started_at"])
        self.assertEqual(before["last_activity_at"], after["last_activity_at"])

    def test_login_rotation_discards_guest_cart_and_rejects_old_token(self):
        self.put(2)
        self.user.phone_verified_at = timezone.now()
        self.user.save()
        response = self.terminal_login(self.token)
        self.assertEqual(response.status_code, 200, response.data)
        rotated = response.json()["session_token"]
        self.assertEqual(self.get("cart/", token=rotated).json()["total_quantity"], 0)
        self.assertEqual(self.get("cart/").status_code, 401)

    def test_stock_change_marks_cart_without_silent_removal(self):
        self.put(3)
        set_stock(slot_id=self.slot.pk, batch=self.batch, quantity=1)
        cart = self.get("cart/").json()
        self.assertTrue(cart["has_issues"])
        self.assertEqual(cart["items"][0]["quantity"], 3)
        self.assertIn("stock_changed", cart["items"][0]["issues"])

    def test_reset_end_expiry_and_bad_credentials(self):
        self.put(1)
        new_token = self.start_guest()
        self.assertEqual(self.get("cart/", token=new_token).json()["items"], [])
        self.assertEqual(self.get("cart/").status_code, 401)
        self.token = new_token
        self.change_state(last_activity_at=0)
        self.assertEqual(self.get("cart/").status_code, 401)
        bad = self.headers | {"HTTP_X_TERMINAL_KEY": "wrong"}
        self.assertEqual(self.get("catalogue/products/", headers=bad).status_code, 401)

    def test_clear_cart_and_redis_failure(self):
        self.put(1)
        result = self.client.delete(BASE + "cart/", {"expected_version": self.get("cart/").json()["version"]}, format="json",
                                    HTTP_AUTHORIZATION="Bearer " + self.token, **self.headers)
        self.assertEqual(result.json()["items"], [])
        with patch("apps.terminals.security.state.get_redis_client", side_effect=RedisConnectionError):
            self.assertEqual(self.get("cart/").status_code, 503)

    @override_settings(DEBUG=True)
    def test_seed_is_repeat_safe_and_does_not_refill(self):
        call_command("seed_catalogue", terminal=self.terminal.pk, stdout=StringIO())
        counts = (Category.objects.count(), Product.objects.count(), TerminalStock.objects.count())
        sample = TerminalStock.objects.filter(terminal_slot__slot_code="DEMO-002").get()
        sample.quantity_on_hand = 0
        sample.save()
        call_command("seed_catalogue", terminal=self.terminal.pk, stdout=StringIO())
        sample.refresh_from_db()
        self.assertEqual(sample.quantity_on_hand, 0)
        self.assertEqual(counts, (Category.objects.count(), Product.objects.count(), TerminalStock.objects.count()))
        with self.assertRaises(CommandError):
            call_command("seed_catalogue", terminal="MISSING", stdout=StringIO())

    @override_settings(DEBUG=False)
    def test_seed_cannot_run_outside_development(self):
        with self.assertRaises(CommandError):
            call_command("seed_catalogue", terminal=self.terminal.pk)
