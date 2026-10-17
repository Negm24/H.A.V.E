from io import StringIO
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import patch

from django.core.management import call_command, CommandError
from django.apps import apps
from django.test import TestCase, override_settings

from apps.catalogue.management.commands.seed_egypt_catalogue import CATEGORIES, PRODUCTS, SOURCES
from apps.catalogue.models import Category, Product, ProductBatch
from apps.catalogue.services.catalogue_services import availability, list_categories, terminal_products
from apps.terminals.models import Terminal, TerminalSlot, TerminalStock
from apps.terminals.services.inventory_services import set_stock


@override_settings(DEBUG=True)
class EgyptCatalogueSeedTests(TestCase):
    def setUp(self):
        self.terminals = [Terminal.objects.create(serial_number=f"EG-TEST-{i}", display_name=f"Test {i}",
            address_en="Test", address_ar="تجريبي", latitude=0, longitude=0, device_credential_hash=str(i) * 64) for i in (1, 2)]

    def seed(self, **kwargs):
        call_command("seed_egypt_catalogue", terminal=[t.pk for t in self.terminals], stdout=StringIO(), **kwargs)

    def test_both_terminals_have_correct_bilingual_categories_and_independent_stock(self):
        self.seed()
        self.assertEqual(Category.objects.count(), len(CATEGORIES))
        self.assertEqual(Product.objects.count(), len(PRODUCTS))
        self.assertEqual(TerminalStock.objects.count(), 2 * len(PRODUCTS))
        for row in PRODUCTS:
            product = Product.objects.get(sku=row["sku"])
            product.full_clean()
            self.assertEqual(product.category.name_en, CATEGORIES[row["category"]][0])
            self.assertIn("Test prices", product.warnings_en)
            self.assertFalse(product.requires_prescription)
            if row["source"]:
                self.assertIn(row["source"], SOURCES)
        for terminal in self.terminals:
            self.assertEqual(len(list_categories(terminal)), 10)
            self.assertEqual(terminal_products(terminal).count(), len(PRODUCTS))
            counts = set(availability(terminal).values())
            self.assertTrue({0, 1, 5, 6}.issubset(counts))
            terminal.refresh_from_db()
            self.assertEqual(terminal.device_credential_hash, terminal.pk[-1] * 64)
        panadol = Product.objects.get(sku="HAVE-EG-PANADOL-ADVANCE-500")
        self.assertEqual([availability(t)[panadol.pk] for t in self.terminals], [12, 8])

    def test_rerun_preserves_edits_stock_expiry_and_disabled_slots(self):
        self.seed()
        stock = TerminalStock.objects.first()
        set_stock(slot_id=stock.terminal_slot_id, batch=stock.batch, quantity=0)
        Product.objects.filter(pk=stock.batch.product_id).update(price="1.23", name_en="Owner edit")
        TerminalSlot.objects.filter(pk=stock.terminal_slot_id).update(is_enabled=False)
        counts = (Product.objects.count(), ProductBatch.objects.count(), TerminalStock.objects.count())
        expiry = stock.batch.expiry_date
        self.seed(replace_demo=True)
        stock.refresh_from_db()
        self.assertEqual(stock.quantity_on_hand, 0)
        self.assertFalse(stock.terminal_slot.is_enabled)
        self.assertEqual(stock.batch.expiry_date, expiry)
        self.assertEqual(stock.batch.product.name_en, "Owner edit")
        self.assertEqual(str(stock.batch.product.price), "1.23")
        self.assertEqual(counts, (Product.objects.count(), ProductBatch.objects.count(), TerminalStock.objects.count()))

    def test_demo_replacement_only_disables_targeted_demo_assignments(self):
        for terminal in self.terminals:
            call_command("seed_catalogue", terminal=terminal.pk, stdout=StringIO())
        self.seed(replace_demo=True)
        self.assertEqual(Product.objects.filter(sku__startswith="HAVE-DEMO-").count(), 28)
        self.assertFalse(TerminalSlot.objects.filter(product__sku__startswith="HAVE-DEMO-", is_enabled=True).exists())
        for terminal in self.terminals:
            self.assertFalse(terminal_products(terminal).filter(sku__startswith="HAVE-DEMO-").exists())
        self.assertEqual(TerminalStock.objects.filter(terminal_slot__product__sku__startswith="HAVE-DEMO-").count(), 56)

    def test_missing_terminal_and_production_fail_without_changes(self):
        with self.assertRaises(CommandError):
            call_command("seed_egypt_catalogue", terminal=[self.terminals[0].pk, "MISSING"], stdout=StringIO())
        with override_settings(DEBUG=False), self.assertRaises(CommandError):
            self.seed()
        self.assertFalse(Product.objects.exists())

    def test_inventory_failure_rolls_back_the_entire_seed(self):
        with patch("apps.catalogue.management.commands.seed_egypt_catalogue.set_stock", side_effect=RuntimeError("Test failure")):
            with self.assertRaises(RuntimeError):
                self.seed()
        self.assertFalse(Category.objects.exists())
        self.assertFalse(Product.objects.exists())
        self.assertFalse(TerminalSlot.objects.exists())

    def test_seed_has_no_artificial_two_pack_limit(self):
        self.seed()
        self.assertFalse(Product.objects.exclude(max_quantity_per_order=None).exists())

    def test_quantity_data_migration_preserves_other_limits_and_stock(self):
        self.seed()
        first, second = list(Product.objects.order_by("id")[:2])
        Product.objects.filter(pk=first.pk).update(max_quantity_per_order=2)
        Product.objects.filter(pk=second.pk).update(max_quantity_per_order=4)
        unrelated = Product.objects.create(sku="OWNER-PRODUCT", category=first.category,
            name_en="Owner product", name_ar="منتج", price="7.50", max_quantity_per_order=2,
            pack_description="Pack", usage_instructions_en="Test", usage_instructions_ar="تجريبي")
        before = list(TerminalStock.objects.order_by("pk").values_list("pk", "quantity_on_hand"))
        migrate = import_module("apps.catalogue.migrations.0003_remove_synthetic_egypt_quantity_cap")
        migrate.remove_synthetic_limit(apps, SimpleNamespace(connection=SimpleNamespace(alias="default")))
        first.refresh_from_db()
        second.refresh_from_db()
        unrelated.refresh_from_db()
        self.assertIsNone(first.max_quantity_per_order)
        self.assertEqual(second.max_quantity_per_order, 4)
        self.assertEqual(unrelated.max_quantity_per_order, 2)
        self.assertEqual(str(unrelated.price), "7.50")
        self.assertEqual(before, list(TerminalStock.objects.order_by("pk").values_list("pk", "quantity_on_hand")))
