from datetime import timedelta
from uuid import uuid4
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.utils import timezone
from apps.accounts.security.errors import AuthError
from apps.catalogue.models import Product, ProductBatch
from apps.operations.models import ExternalStock, StockMovement
from apps.operations.services.inventory import transfer, adjust_external, save_layout, cabinet_data
from apps.operations.services.reporting import business, period_bounds
from apps.operations.services.presence import indicators
from apps.payments.models import PaymentTransaction
from .helpers import OperationsFixtures


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class RedesignTests(OperationsFixtures, TestCase):
    def setUp(self):
        self.setup_operations()
        self.other = Product.objects.create(sku="OTHER-REDESIGN", category=self.category, name_en="Other", name_ar="آخر", price="5.00", pack_description="Pack", usage_instructions_en="Test", usage_instructions_ar="اختبار")
        self.incoming = ProductBatch.objects.create(product=self.other, batch_number="NEW", expiry_date=timezone.localdate()+timedelta(days=60))
        self.external = ExternalStock.objects.create(batch=self.incoming, quantity=20)

    def move(self, **changes):
        return transfer(**(dict(actor=self.owner, slot_id=self.slot.pk, batch_id=self.incoming.pk, quantity=5,
            slot_revision=1, external_revision=1, reason="Test swap", action_id=uuid4()) | changes))

    def test_atomic_swap_returns_old_batch_and_idempotent_retry(self):
        key = uuid4()
        with self.assertRaises(AuthError):
            self.move(action_id=key)
        from apps.operations.services.cabinet_transfers import return_packs
        return_packs(actor=self.owner, slot_id=self.slot.pk, slot_revision=1,
            batches=[{"batch_id":self.batch.pk,"quantity":12,"revision":self.stock.revision}], action_id=uuid4())
        first = self.move(action_id=key, slot_revision=2)
        self.assertEqual(self.move(action_id=key, slot_revision=2), first)
        self.stock.refresh_from_db()
        self.slot.refresh_from_db()
        self.external.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 0)
        self.assertEqual(ExternalStock.objects.get(batch=self.batch).quantity, 12)
        self.assertEqual(self.external.quantity, 15)
        self.assertEqual(self.slot.product_id, self.other.pk)
        self.assertEqual(StockMovement.objects.count(), 2)
        with self.assertRaises(AuthError):
            self.move(action_id=key, quantity=6)

    def test_reserved_swap_capacity_and_insufficient_preserve_both_sides(self):
        self.reserve()
        with self.assertRaises(AuthError):
            self.move()
        self.stock.refresh_from_db()
        self.external.refresh_from_db()
        self.assertEqual((self.stock.quantity_on_hand, self.external.quantity), (12,20))
        self.assertFalse(StockMovement.objects.exists())
        for quantity in (21, 30):
            with self.assertRaises(AuthError):
                self.move(quantity=quantity)

    def test_external_correction_and_owner_endpoint_retires_direct_write(self):
        key = uuid4()
        data = dict(actor=self.owner, batch_id=self.incoming.pk, quantity=9, revision=1, reason="Count", action_id=key)
        self.assertEqual(adjust_external(**data), adjust_external(**data))
        self.assertEqual(ExternalStock.objects.get(batch=self.incoming).quantity, 9)
        response = self.admin_post("stock/adjust/", {"slot_id": self.slot.pk, "batch_id": self.batch.pk, "quantity": 0, "revision":1,"reason":"test"})
        self.assertEqual(response.status_code, 405)

    def test_same_product_new_batch_and_expired_batch_validation(self):
        batch = ProductBatch.objects.create(product=self.product, batch_number="RESTOCK", expiry_date=self.batch.expiry_date)
        ExternalStock.objects.create(batch=batch, quantity=10)
        self.move(batch_id=batch.pk, quantity=4)
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.product_id, self.product.pk)
        self.assertEqual(self.slot.stock.get(batch=batch).quantity_on_hand, 4)
        self.assertEqual(ExternalStock.objects.get(batch=batch).quantity, 6)
        self.incoming.expiry_date = timezone.localdate()-timedelta(days=1)
        self.incoming.save()
        with self.assertRaises(AuthError):
            self.move(slot_revision=self.slot.revision)
        self.assertEqual(self.slot.stock.get(batch=batch).quantity_on_hand, 4)

    def test_layout_confirmation_and_duplicate_position_rollback(self):
        layout = cabinet_data(self.terminal)
        self.assertFalse(layout["confirmed"])
        with self.assertRaises(AuthError):
            save_layout(actor=self.owner, serial=self.terminal.pk, revision=1, positions=[])

    def test_report_successful_capture_and_unknown_refund(self):
        order = self.reserve()
        now = timezone.now()
        PaymentTransaction.objects.create(order=order, operation="CAPTURE", amount="30", status="SUCCEEDED", completed_at=now, idempotency_key=uuid4().hex)
        PaymentTransaction.objects.create(order=order, operation="REFUND", amount="30", status="UNKNOWN", idempotency_key=uuid4().hex)
        report = business("today")
        self.assertEqual(report["gross_received"],"30.00")
        self.assertEqual(report["net_received"],"30.00")
        self.assertEqual(next(r for r in report["refunds"] if r["status"]=="UNKNOWN")["amount"],"30.00")
        self.assertEqual(report["analytics"]["products"][0]["amount"],"30.00")
        self.assertEqual(report["analytics"]["kiosks"][0]["address"], self.terminal.address_en)
        order.items.update(category_name_snapshot=None)
        legacy_report = business("today")
        self.assertEqual(legacy_report["analytics"]["categories"][0]["label"], self.category.name_en)
        self.assertEqual(legacy_report["analytics"]["categories"][0]["quantity"], 3)
        self.assertTrue(legacy_report["analytics"]["category_uses_current_catalogue"])
        from apps.operations.api.readers import records
        filtered = records("orders", {"date_basis":"capture_confirmed","period":"today"})
        self.assertEqual(list(filtered.values_list("pk",flat=True)),[order.pk])
        self.assertEqual(records("orders", {"product_id": self.other.pk}).count(), 0)
        self.assertEqual(records("orders", {"product_id": self.product.pk}).count(), 1)
        self.assertEqual(records("orders", {"channel": "TERMINAL"}).count(), 0)
        self.assertEqual(records("orders", {"category": "Missing category"}).count(), 0)
        self.assertEqual(records("orders", {"category": self.category.name_en}).count(), 1)
        order.items.update(category_name_snapshot="Original category")
        self.assertEqual(business("today")["analytics"]["categories"][0]["label"], "Original category")
        self.assertEqual(records("orders", {"category": self.category.name_en}).count(), 0)
        self.assertEqual(sum(float(b["amount"]) for b in report["revenue"]),30)

    def test_cairo_week_starts_saturday(self):
        start, _ = period_bounds("week")
        self.assertEqual(start.weekday(),5)

    def test_fresh_heartbeat_and_active_session_are_independent(self):
        self.start_guest()
        fake = timezone.now().isoformat()
        with patch("apps.operations.services.presence.get_redis_client") as redis:
            redis.return_value.get.return_value = fake
            state = indicators(self.terminal)
        self.assertEqual(state["connection_state"],"online")
        self.assertEqual(state["session_state"],"in_session")
        self.assertEqual(state["availability"],"Trading enabled")
