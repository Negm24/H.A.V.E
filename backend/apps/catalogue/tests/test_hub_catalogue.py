from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.accounts.tests.helpers import SessionFixtures
from apps.catalogue.models import Category, Product, ProductBatch
from apps.terminals.models import Terminal, TerminalSlot
from apps.terminals.services.inventory_services import set_stock


class HubCatalogueTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.user.phone_verified_at = timezone.now()
        self.user.save()
        self.access = self.hub_login().json()["access_token"]
        category = Category.objects.create(name_en="Network", name_ar="الشبكة")
        self.product = Product.objects.create(category=category, sku="NETWORK", name_en="Sample", name_ar="عينة",
            price="21.50", max_quantity_per_order=10, pack_description="Pack", usage_instructions_en="Demo", usage_instructions_ar="تجريبي")
        batch = ProductBatch.objects.create(product=self.product, batch_number="N1", expiry_date=timezone.localdate() + timedelta(days=10))
        self.second = Terminal.objects.create(serial_number="NETWORK-2", display_name="Other", address_en="X", address_ar="X", latitude=0, longitude=0, device_credential_hash="0" * 64)
        for terminal, quantity in [(self.terminal, 3), (self.second, 5)]:
            slot = TerminalSlot.objects.create(terminal=terminal, slot_code="N1", product=self.product, capacity=20)
            set_stock(slot_id=slot.pk, batch=batch, quantity=quantity)

    def get(self, path, terminal=None):
        return self.client.get("/api/v1/hub/catalogue/" + path + "?terminal_serial=" + (terminal or self.terminal).pk,
            HTTP_AUTHORIZATION="Bearer " + self.access)

    def test_selected_terminal_stock_has_timestamp_and_needs_no_device(self):
        response = self.get("products/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["availability_scope"], "TERMINAL")
        self.assertIn("observed_at", response.json())
        self.assertEqual(response.json()["items"][0]["stock_quantity"], 3)
        self.assertEqual(self.get("products/", terminal=self.second).json()["items"][0]["stock_quantity"], 5)
        self.assertEqual(self.get("categories/").json()["items"][0]["product_count"], 1)
        self.assertEqual(self.get(f"products/{self.product.pk}/").json()["product"]["id"], self.product.pk)

    def test_disabled_terminal_cannot_be_selected_or_affect_another_machine_stock(self):
        self.second.is_disabled = True
        self.second.save()
        self.assertEqual(self.get("products/").json()["items"][0]["stock_quantity"], 3)
        self.assertEqual(self.get("products/", terminal=self.second).status_code, 400)

    def test_missing_or_unknown_terminal_requires_selection_before_browse(self):
        headers = {"HTTP_AUTHORIZATION": "Bearer " + self.access}
        self.assertEqual(self.client.get("/api/v1/hub/catalogue/products/", **headers).status_code, 400)
        self.assertEqual(self.client.get("/api/v1/hub/catalogue/products/?terminal_serial=UNKNOWN", **headers).status_code, 400)

    def test_catalogue_survives_redis_outage_after_login(self):
        with patch("apps.accounts.security.state.get_redis_client", side_effect=RuntimeError("Redis unavailable")):
            self.assertEqual(self.get("products/").status_code, 200)

    def test_guest_and_terminal_tokens_cannot_authorize_hub(self):
        self.assertEqual(self.client.get("/api/v1/hub/catalogue/products/").status_code, 401)
        token = self.start_guest()
        response = self.client.get("/api/v1/hub/catalogue/products/", HTTP_AUTHORIZATION="Bearer " + token, **self.headers)
        self.assertEqual(response.status_code, 401)
