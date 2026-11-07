from datetime import timedelta
import time
from uuid import uuid4

from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.tests.helpers import SessionFixtures
from apps.catalogue.models import Category, Product, ProductBatch
from apps.orders.services.order_services import reserve_order
from apps.terminals.models import TerminalSlot
from apps.terminals.services.inventory_services import set_stock


class OperationsFixtures(SessionFixtures):
    def setup_operations(self):
        self.setup_sessions()
        self.owner = create_owner_account(first_name="Private", last_name="Owner", phone_number="01112345678",
            email="operations-owner@example.test", password="Orchid-River-Sample-4826!")
        self.admin = APIClient(enforce_csrf_checks=True)
        self.admin.force_login(self.owner, backend="apps.accounts.backends.OwnerBackend")
        session = self.admin.session
        session.update({"owner_started_at": time.time(), "owner_last_activity_at": time.time()})
        session.save()
        self.category = Category.objects.create(name_en="Operations", name_ar="عمليات")
        self.product = Product.objects.create(sku="OPS-PRODUCT", category=self.category, name_en="Test product",
            name_ar="منتج تجريبي", price="10.00", pack_description="Pack", usage_instructions_en="Test",
            usage_instructions_ar="تجريبي", max_quantity_per_order=None)
        self.batch = ProductBatch.objects.create(product=self.product, batch_number="OPS-BATCH",
            expiry_date=timezone.localdate() + timedelta(days=60))
        self.slot = TerminalSlot.objects.create(terminal=self.terminal, product=self.product, slot_code="A1", capacity=20)
        self.stock = set_stock(slot_id=self.slot.pk, batch=self.batch, quantity=12)

    def admin_post(self, suffix, data, *, method="post", format="json"):
        csrf = self.admin.get("/api/v1/auth/csrf/").json()["csrf_token"]
        return getattr(self.admin, method)("/api/v1/owner/" + suffix, data, format=format, HTTP_X_CSRFTOKEN=csrf)

    def reserve(self, **changes):
        defaults = dict(terminal=self.terminal, customer=self.user.customer, items={str(self.product.pk): 3},
            cart_version="operations", email=self.user.email, channel="HUB", idempotency_key=uuid4().hex)
        return reserve_order(**(defaults | changes))
