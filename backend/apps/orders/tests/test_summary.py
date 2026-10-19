from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.tests.helpers import SessionFixtures
from apps.orders.models import Order
from apps.orders.services.summary_services import collection_summary
from apps.terminals.models import Terminal


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class CollectionSummaryTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.other_terminal = Terminal.objects.create(serial_number="OTHER", display_name="Other machine",
            address_en="Other", address_ar="أخرى", latitude=0, longitude=0, device_credential_hash="f" * 64)

    def order(self, **changes):
        values = dict(customer_id=self.user.pk, terminal=self.terminal, channel="HUB", collection_required=True,
            subtotal="10.00", customer_payable_amount="10.00", email_receipt_to=self.user.email,
            idempotency_key=str(Order.objects.count()), checkout_fingerprint="a" * 64, cart_version="version",
            expires_at=timezone.now() + timedelta(minutes=10), paid_at=timezone.now(),
            collection_deadline=timezone.now() + timedelta(hours=24))
        return Order.objects.create(**(values | changes))

    def test_only_paid_pending_unexpired_collection_orders_count_with_machine_guidance(self):
        self.order()
        self.order(terminal=self.other_terminal)
        self.order(paid_at=None)
        self.order(collection_deadline=timezone.now() - timedelta(seconds=1))
        self.order(status="REVIEW_REQUIRED")
        self.order(status="COMPLETED")
        self.order(collection_required=False)
        result = collection_summary(self.user.pk, self.terminal)
        self.assertEqual((result["awaiting_collection_count"], result["at_terminal_count"], result["elsewhere_count"]), (2, 1, 1))
        self.assertEqual({row["serial_number"] for row in result["collection_terminals"]}, {self.terminal.pk, self.other_terminal.pk})
        self.assertEqual(collection_summary("other-customer")["awaiting_collection_count"], 0)

    def test_summary_routes_require_account_and_never_renew_terminal_activity(self):
        self.order()
        access = self.hub_login().json()["access_token"]
        hub = self.client.get("/api/v1/hub/orders/summary/", HTTP_AUTHORIZATION="Bearer " + access)
        self.assertEqual(hub.status_code, 200)
        self.assertEqual(hub.json()["awaiting_collection_count"], 1)
        guest = self.start_guest()
        endpoint = "/api/v1/terminals/orders/summary/"
        self.assertEqual(self.client.get(endpoint, HTTP_AUTHORIZATION="Bearer " + guest, **self.headers).status_code, 401)
        token = self.terminal_login(guest).json()["session_token"]
        before = self.state()
        result = self.client.get(endpoint, HTTP_AUTHORIZATION="Bearer " + token, **self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["at_terminal_count"], 1)
        self.assertEqual(self.state(), before)
