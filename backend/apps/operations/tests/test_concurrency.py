from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

from django.db import close_old_connections, connections
from django.test import TransactionTestCase, override_settings

from apps.accounts.security.errors import AuthError
from apps.operations.models import OwnerAction
from apps.operations.services.actions import submit_order_action, run_pending_actions
from apps.operations.services.kiosks import set_maintenance
from apps.terminals.services.session_services import operate
from .helpers import OperationsFixtures


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class OwnerConcurrencyTests(OperationsFixtures, TransactionTestCase):
    def setUp(self):
        self.setup_operations()

    def parallel(self, *operations):
        barrier = Barrier(len(operations))
        def run(operation):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return operation()
            except AuthError:
                return "BLOCKED"
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            return list(pool.map(run, operations))

    def test_maintenance_and_new_session_cannot_both_win(self):
        def start():
            operate(self.terminal, "start")
            return "SESSION"
        def pause():
            set_maintenance(actor=self.owner, serial=self.terminal.pk, enabled=True,
                reason="Race acceptance test", revision=1)
            return "MAINTENANCE"
        results = self.parallel(start, pause)
        self.assertEqual(results.count("BLOCKED"), 1, results)
        self.assertEqual(sum(value in {"SESSION", "MAINTENANCE"} for value in results), 1)

    def test_two_workers_claim_one_owner_action_without_duplicate_effect(self):
        order = self.reserve()
        job = submit_order_action(actor=self.owner, order_id=order.pk, action="cancel", action_id=uuid4())
        from apps.payments.services.payment_services import cancel_purchase
        with patch("apps.operations.services.actions.cancel_purchase", wraps=cancel_purchase) as cancel:
            processed = self.parallel(run_pending_actions, run_pending_actions)
        self.assertEqual(sum(processed), 1)
        cancel.assert_called_once()
        job.refresh_from_db()
        self.assertEqual(job.status, "SUCCEEDED")

    def test_parallel_loading_cannot_spend_external_packs_twice(self):
        from apps.operations.models import ExternalStock
        from apps.operations.services.inventory import transfer
        from apps.terminals.models import TerminalSlot
        ExternalStock.objects.create(batch=self.batch, quantity=5)
        other = TerminalSlot.objects.create(terminal=self.terminal, product=self.product, slot_code="B1", capacity=20)
        def load(slot):
            transfer(actor=self.owner, slot_id=slot.pk, batch_id=self.batch.pk, quantity=5,
                slot_revision=1, external_revision=1, reason="Concurrent load", action_id=uuid4())
            return "LOADED"
        results = self.parallel(lambda: load(self.slot), lambda: load(other))
        self.assertEqual(sorted(results), ["BLOCKED", "LOADED"])
        self.assertEqual(ExternalStock.objects.get(batch=self.batch).quantity, 0)

    def test_product_loading_serializes_external_batch_spending(self):
        from apps.operations.models import ExternalStock
        from apps.operations.services.cabinet_transfers import load, load_plan
        from apps.terminals.models import TerminalSlot
        ExternalStock.objects.create(batch=self.batch, quantity=5)
        other = TerminalSlot.objects.create(terminal=self.terminal, product=self.product, slot_code="C1", capacity=20)
        plans = [load_plan(slot_id=slot.pk, product_id=self.product.pk, quantity=5) for slot in (self.slot, other)]
        def perform(plan):
            load(actor=self.owner, slot_id=plan["slot_id"], product_id=self.product.pk, quantity=5,
                 slot_revision=plan["slot_revision"],
                 batches=[{key: row[key] for key in ("batch_id", "quantity", "revision")} for row in plan["batches"]],
                 action_id=uuid4())
            return "LOADED"
        results = self.parallel(lambda: perform(plans[0]), lambda: perform(plans[1]))
        self.assertEqual(sorted(results), ["BLOCKED", "LOADED"])
        self.assertEqual(ExternalStock.objects.get(batch=self.batch).quantity, 0)

    def test_reservation_racing_product_replacement_preserves_existing_orders(self):
        from datetime import timedelta
        from django.utils import timezone
        from apps.catalogue.models import Product, ProductBatch
        from apps.operations.models import ExternalStock
        from apps.operations.services.inventory import transfer
        product = Product.objects.create(sku="RACE-OTHER", category=self.category, name_en="Other", name_ar="آخر", price="5.00", pack_description="Pack", usage_instructions_en="Test", usage_instructions_ar="اختبار")
        batch = ProductBatch.objects.create(product=product, batch_number="RACE-NEW", expiry_date=timezone.localdate()+timedelta(days=60))
        ExternalStock.objects.create(batch=batch, quantity=5)
        def reserve():
            self.reserve()
            return "RESERVED"
        def swap():
            transfer(actor=self.owner, slot_id=self.slot.pk, batch_id=batch.pk, quantity=5,
                slot_revision=1, external_revision=1, reason="Race replacement", action_id=uuid4())
            return "REPLACED"
        results = self.parallel(reserve, swap)
        self.assertEqual(results.count("BLOCKED"), 1, results)
