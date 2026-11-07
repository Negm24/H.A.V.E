from datetime import timedelta
from uuid import uuid4
from django.test import TestCase, override_settings
from django.utils import timezone
from apps.accounts.security.errors import AuthError
from apps.catalogue.models import ProductBatch
from apps.operations.models import ExternalStock, StockMovement
from apps.operations.services.cabinet_transfers import load_plan, load, return_packs
from .helpers import OperationsFixtures


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class FixedCabinetTests(OperationsFixtures, TestCase):
    def setUp(self):
        self.setup_operations()
        self.external = ExternalStock.objects.create(batch=self.batch, quantity=2)
        self.later = ProductBatch.objects.create(product=self.product, batch_number='LATER', expiry_date=self.batch.expiry_date+timedelta(days=5))
        ExternalStock.objects.create(batch=self.later, quantity=10)

    def test_fefo_split_load_and_replay(self):
        plan = load_plan(slot_id=self.slot.pk,product_id=self.product.pk,quantity=5)
        self.assertEqual([row['quantity'] for row in plan['batches']],[2,3])
        allocations = [{key:row[key] for key in ('batch_id','quantity','revision')} for row in plan['batches']]
        payload = dict(actor=self.owner,slot_id=self.slot.pk,product_id=self.product.pk,quantity=5,slot_revision=self.slot.revision,batches=allocations,action_id=uuid4())
        first = load(**payload)
        self.assertEqual(load(**payload),first)
        self.assertEqual(self.slot.stock.get(batch=self.batch).quantity_on_hand,14)
        self.assertEqual(self.slot.stock.get(batch=self.later).quantity_on_hand,3)
        self.assertEqual(StockMovement.objects.count(),2)

    def test_return_respects_reservations_and_is_idempotent(self):
        self.reserve()
        payload = dict(actor=self.owner,slot_id=self.slot.pk,slot_revision=self.slot.revision,
            batches=[{'batch_id':self.batch.pk,'quantity':10,'revision':self.stock.revision}],action_id=uuid4())
        with self.assertRaises(AuthError):
            return_packs(**payload)
        self.assertEqual(self.slot.stock.get(batch=self.batch).quantity_on_hand,12)
        payload['batches'][0]['quantity']=9
        first = return_packs(**payload)
        self.assertEqual(return_packs(**payload),first)
        self.assertEqual(self.slot.stock.get(batch=self.batch).quantity_on_hand,3)
        self.assertEqual(ExternalStock.objects.get(batch=self.batch).quantity,11)

    def test_stale_external_allocation_changes_no_balances(self):
        plan = load_plan(slot_id=self.slot.pk,product_id=self.product.pk,quantity=1)
        self.external.revision += 1
        self.external.save()
        with self.assertRaises(AuthError):
            load(actor=self.owner,slot_id=self.slot.pk,product_id=self.product.pk,quantity=1,slot_revision=self.slot.revision,
                 batches=[{key:plan['batches'][0][key] for key in ('batch_id','quantity','revision')}],action_id=uuid4())
        self.assertEqual(self.slot.stock.get(batch=self.batch).quantity_on_hand,12)

    def test_legacy_transfer_cannot_restock_retired_slot(self):
        from apps.operations.services.inventory import transfer
        from apps.terminals.models import TerminalSlot
        self.slot.is_operational = False
        self.slot.save()
        with self.assertRaises(TerminalSlot.DoesNotExist):
            transfer(actor=self.owner, slot_id=self.slot.pk, batch_id=self.batch.pk,
                     quantity=1, slot_revision=self.slot.revision, external_revision=self.external.revision,
                     reason="Retired slot test", action_id=uuid4())
        self.assertEqual(ExternalStock.objects.get(pk=self.external.pk).quantity, 2)
