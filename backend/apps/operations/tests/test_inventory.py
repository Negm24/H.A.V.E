from datetime import timedelta
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image

from apps.catalogue.models import Category, ProductBatch
from apps.terminals.models import Terminal
from apps.orders.services.order_services import mark_paid, fulfil_order
from apps.operations.models import ActivityEntry, OwnerAction
from apps.operations.services.simulators import simulator_url
from .helpers import OperationsFixtures


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class CatalogueInventoryTests(OperationsFixtures, TestCase):
    def setUp(self):
        self.setup_operations()

    def test_category_create_edit_and_stale_revision(self):
        created = self.admin_post("categories/", {"name_en": "New", "name_ar": "جديد", "is_active": True})
        self.assertEqual(created.status_code, 201, created.data)
        row = created.json()
        self.assertEqual(row["revision"], 1)
        path = f"categories/{row['id']}/"
        changed = self.admin_post(path, {"revision": 1, "is_active": False}, method="patch")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertEqual(changed.json()["revision"], 2)
        self.assertEqual(self.admin_post(path, {"revision": 1, "name_en": "Stale"}, method="patch").status_code, 409)

    def test_get_lists_do_not_invent_absent_boolean_filters(self):
        inactive = Category.objects.create(name_en="Inactive", name_ar="غير نشط", is_active=False)
        categories = self.admin.get("/api/v1/owner/categories/?page_size=100").json()
        self.assertEqual({item["id"] for item in categories["items"]}, {self.category.pk, inactive.pk})
        active = self.admin.get("/api/v1/owner/categories/?is_active=true").json()
        self.assertEqual([item["id"] for item in active["items"]], [self.category.pk])
        disabled = Terminal.objects.create(serial_number="DISABLED-OPS", display_name="Disabled", address_en="Test",
            address_ar="تجريبي", latitude=0, longitude=0, device_credential_hash="0" * 64, is_disabled=True)
        kiosks = self.admin.get("/api/v1/owner/kiosks/?page_size=100").json()
        self.assertEqual({item["serial_number"] for item in kiosks["items"]}, {self.terminal.pk, disabled.pk})
        filtered = self.admin.get("/api/v1/owner/kiosks/?is_disabled=true").json()
        self.assertEqual([item["serial_number"] for item in filtered["items"]], [disabled.pk])
        self.user.is_disabled = True
        self.user.save(update_fields=["is_disabled"])
        customers = self.admin.get("/api/v1/owner/customers/").json()
        self.assertEqual([item["id"] for item in customers["items"]], [self.user.pk])

    def test_product_price_edit_preserves_reserved_snapshot_and_rejects_unsupported_fields(self):
        order = self.reserve()
        response = self.admin_post(f"products/{self.product.pk}/", {"revision": 1, "price": "12.50"}, method="patch")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["price"], "12.50")
        self.assertEqual(format(order.items.get().unit_price, ".2f"), "10.00")
        self.assertEqual(self.admin_post(f"products/{self.product.pk}/", {"revision": 2, "image": "arbitrary/path"}, method="patch").status_code, 400)

    def adjust(self, **changes):
        return self.admin_post("stock/adjust/", dict(slot_id=self.slot.pk, batch_id=self.batch.pk,
            quantity=8, revision=self.stock.revision, reason="Fictional inventory count") | changes)

    def test_stock_floor_capacity_revision_and_consumption_revision(self):
        from django.core.exceptions import ValidationError
        from apps.terminals.services.inventory_services import set_stock
        order = self.reserve()
        with self.assertRaises(ValidationError):
            set_stock(slot_id=self.slot.pk, batch=self.batch, quantity=2)
        with self.assertRaises(ValidationError):
            set_stock(slot_id=self.slot.pk, batch=self.batch, quantity=21)
        accepted = set_stock(slot_id=self.slot.pk, batch=self.batch, quantity=8)
        self.assertEqual(accepted.quantity_on_hand, 8)
        self.assertEqual(accepted.revision, 2)
        self.assertEqual(self.adjust(quantity=9).status_code, 405)
        mark_paid(order.pk)
        fulfil_order(order.pk, terminal=self.terminal)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 5)
        self.assertEqual(self.stock.revision, 3)

    def test_batch_and_slot_eligibility_cannot_be_changed_under_existing_stock_or_holds(self):
        self.reserve()
        self.assertEqual(self.admin_post(f"slots/{self.slot.pk}/", {"revision": 1, "capacity": 5}, method="patch").status_code, 409)
        self.assertEqual(self.admin_post(f"slots/{self.slot.pk}/", {"revision": 1, "is_enabled": False}, method="patch").status_code, 409)
        expiry = (timezone.localdate() + timedelta(days=90)).isoformat()
        self.assertEqual(self.admin_post(f"batches/{self.batch.pk}/", {"revision": 1, "expiry_date": expiry}, method="patch").status_code, 409)

    def test_legacy_stock_write_rejected_even_for_new_batch(self):
        batch = ProductBatch.objects.create(product=self.product, batch_number="SECOND", expiry_date=self.batch.expiry_date)
        self.assertEqual(self.adjust(batch_id=batch.pk, quantity=2, revision=0).status_code, 405)
        self.assertFalse(batch.terminal_stock.exists())

    def test_validated_image_roundtrip_shared_catalogue_field_and_removal(self):
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            source = BytesIO()
            Image.new("RGB", (12, 8), "green").save(source, format="PNG")
            upload = SimpleUploadedFile("product.png", source.getvalue(), content_type="image/png")
            response = self.admin_post(f"products/{self.product.pk}/image/", {"revision": 1, "image": upload}, format="multipart")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertTrue(response.json()["image_url"].endswith(".webp"))
            self.product.refresh_from_db()
            with self.product.image.open("rb") as content:
                self.assertEqual(Image.open(content).format, "WEBP")
            old_name = self.product.image.name
            with self.captureOnCommitCallbacks(execute=True):
                removed = self.admin_post(f"products/{self.product.pk}/image/", {"revision": 2}, method="delete")
            self.assertEqual(removed.status_code, 200, removed.data)
            self.assertIsNone(removed.json()["image_url"])
            self.assertFalse(self.product.image.storage.exists(old_name))

    def test_image_rejects_svg_and_stale_revision_without_mutating_record(self):
        upload = SimpleUploadedFile("fake.png", b"<svg><script>test</script></svg>", content_type="image/png")
        response = self.admin_post(f"products/{self.product.pk}/image/", {"revision": 1, "image": upload}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.product.refresh_from_db()
        self.assertFalse(self.product.image)
        self.assertEqual(self.product.revision, 1)
        self.assertFalse(ActivityEntry.objects.filter(action="IMAGE_REPLACE").exists())

    @override_settings(KIOSK_PUBLIC_BASE_URL="https://kiosk.example.test:8443")
    def test_simulator_link_contains_only_configured_identifier_and_handles_missing_or_invalid_mapping(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "simulators.local.json"
            self.assertIsNone(simulator_url(self.terminal, paths=[path]))
            path.write_text(json.dumps({self.terminal.pk: "a" * 32}))
            self.assertEqual(simulator_url(self.terminal, paths=[path]),
                "https://kiosk.example.test:8443/?terminal=" + "a" * 32)
            path.write_text(json.dumps({self.terminal.pk: "../arbitrary"}))
            self.assertIsNone(simulator_url(self.terminal, paths=[path]))
            path.write_text("invalid JSON")
            self.assertIsNone(simulator_url(self.terminal, paths=[path]))
