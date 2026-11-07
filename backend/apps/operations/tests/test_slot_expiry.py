from datetime import timedelta, datetime, timezone as dt_timezone
from unittest.mock import patch
from uuid import uuid4
from django.test import TestCase, override_settings
from apps.accounts.security.errors import AuthError
from apps.catalogue.models import ProductBatch
from apps.catalogue.services.catalogue_services import availability
from apps.operations.services.cabinet_transfers import return_packs, load_plan
from apps.operations.services.inventory import cabinet_data
from apps.operations.models import ExternalStock
from apps.terminals.services.expiry import expiry_today
from apps.terminals.services.inventory_services import set_stock
from .helpers import OperationsFixtures


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class SlotExpiryTests(OperationsFixtures, TestCase):
    def setUp(self):
        self.setup_operations()
        self.old = ProductBatch.objects.create(product=self.product, batch_number='EXPIRED', expiry_date=expiry_today()-timedelta(days=1))

    def add_expired(self):
        return set_stock(slot_id=self.slot.pk, batch=self.old, quantity=1)

    def test_mixed_slot_blocks_all_stock_and_checkout(self):
        self.add_expired()
        self.assertEqual(availability(self.terminal).get(self.product.pk, 0), 0)
        with self.assertRaises(AuthError):
            self.reserve()
        with self.assertRaises(AuthError):
            load_plan(slot_id=self.slot.pk, product_id=self.product.pk, quantity=1)
        self.assertEqual(cabinet_data(self.terminal)['slots'][0]['expiry_state'], 'expired')

    def test_confirmed_removal_restores_fresh_stock_and_replays_once(self):
        old_stock = self.add_expired()
        payload = dict(actor=self.owner, slot_id=self.slot.pk, slot_revision=self.slot.revision,
            batches=[dict(batch_id=self.old.pk, quantity=1, revision=old_stock.revision)], action_id=uuid4())
        with self.assertRaises(AuthError):
            return_packs(**payload)
        old_stock.refresh_from_db()
        self.assertEqual(old_stock.quantity_on_hand, 1)
        first = return_packs(**payload, expired_removal_confirmed=True)
        self.assertEqual(return_packs(**payload, expired_removal_confirmed=True), first)
        self.assertEqual(ExternalStock.objects.get(batch=self.old).quantity, 1)
        self.assertEqual(availability(self.terminal)[self.product.pk], 12)
        self.assertEqual(cabinet_data(self.terminal)['slots'][0]['expiry_state'], 'normal')

    def test_warning_boundaries_do_not_block_customers(self):
        for days, state in [(31, 'normal'), (30, 'expiring_soon'), (0, 'expiring_soon')]:
            ProductBatch.objects.filter(pk=self.batch.pk).update(expiry_date=expiry_today()+timedelta(days=days))
            self.assertEqual(cabinet_data(self.terminal)['slots'][0]['expiry_state'], state)
            self.assertEqual(availability(self.terminal)[self.product.pk], 12)

    def test_empty_expired_rows_do_not_block(self):
        set_stock(slot_id=self.slot.pk, batch=self.old, quantity=0)
        self.assertEqual(availability(self.terminal)[self.product.pk], 12)

    def test_paid_collection_cannot_use_fresh_batch_from_expired_slot(self):
        from apps.orders.services.order_services import mark_paid, fulfil_order
        order = self.reserve()
        mark_paid(order.pk)
        self.add_expired()
        with self.assertRaises(AuthError):
            fulfil_order(order.pk)
        order.refresh_from_db()
        self.assertEqual(order.status, 'REVIEW_REQUIRED')
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_confirmation_cannot_override_reservations(self):
        order = self.reserve()
        ProductBatch.objects.filter(pk=self.batch.pk).update(expiry_date=expiry_today()-timedelta(days=1))
        with self.assertRaises(AuthError):
            return_packs(actor=self.owner, slot_id=self.slot.pk, slot_revision=self.slot.revision,
                batches=[dict(batch_id=self.batch.pk, quantity=12, revision=self.stock.revision)],
                action_id=uuid4(), expired_removal_confirmed=True)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_cairo_rollover(self):
        with patch('django.utils.timezone.now', return_value=datetime(2026, 11, 7, 23, 0, tzinfo=dt_timezone.utc)):
            self.assertEqual(expiry_today().isoformat(), '2026-11-08')
