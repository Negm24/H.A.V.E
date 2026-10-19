"""Payment result scopes cannot revive, switch or lengthen authentication."""
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.tests.helpers import SessionFixtures
from apps.carts.security.state import customer_cart_key
from apps.orders.models import Order
from apps.payments.models import PaymentTransaction
from apps.payments.services import kashier_services as provider
from apps.payments.services.payment_services import reconcile
from apps.payments.tests import test_purchase_api as fixture
from apps.terminals.security.state import session_key


@override_settings(KASHIER_DEFAULT_TEST_KEY="sandbox-test", KASHIER_SECRET_KEY="sandbox-test", KASHIER_MERCHANT_ID="MID-TEST",
    PAYMENTS_PUBLIC_BASE_URL="https://test.example", KIOSK_PUBLIC_BASE_URL="https://kiosk.example",
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class PaymentReturnSessionTests(SessionFixtures, TestCase):
    setUp = fixture.PurchaseApiTests.setUp
    terminal_call = fixture.PurchaseApiTests.terminal_call
    add = fixture.PurchaseApiTests.add
    checkout = fixture.PurchaseApiTests.checkout

    def opened(self, customer=True):
        if customer:
            self.token = self.terminal_login(self.token).data["session_token"]
        version = self.add()
        with patch.object(provider, "saved_cards", return_value=[{"last_four": "1118"}]), patch.object(provider, "create_session",
                return_value=("session-test", "https://payments.kashier.io/session/session-test?mode=test")):
            response = self.checkout(version)
        self.assertEqual(response.status_code, 200, response.data)
        return Order.objects.get(pk=response.data["order"]["id"])

    def paid(self, order):
        with patch.object(provider, "verify_order", return_value={"state": "PAID", "provider_reference": "paid-" + str(order.pk)}):
            reconcile(order.payments.get(operation="CAPTURE").pk)
        order.refresh_from_db()

    def test_continue_rotates_same_customer_session_once_without_restarting_absolute_clock(self):
        order = self.opened(); self.paid(order)
        before = self.state()
        result = self.terminal_call("get", f"orders/{order.pk}/result/", token=False)
        self.assertTrue(result.data["can_continue_session"])
        self.assertIsNone(result.data["customer_id"])
        self.assertNotIn("session_token", result.data)
        continued = self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False)
        self.assertEqual(continued.status_code, 200, continued.data)
        self.assertEqual(continued.data["customer"]["id"], self.user.pk)
        token = continued.data["session_token"]
        self.assertNotEqual(token, self.token)
        self.assertEqual(self.terminal_me(token).status_code, 200)
        self.assertEqual(self.terminal_me(self.token).status_code, 401)
        self.assertEqual(self.state()["session_id"], before["session_id"])
        self.assertEqual(self.state()["started_at"], before["started_at"])
        self.assertLessEqual(continued.data["session_expires_in"], 900)
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False).status_code, 401)

    def test_guest_continue_stays_guest_and_end_removes_only_that_session(self):
        order = self.opened(customer=False); self.paid(order)
        continued = self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False)
        self.assertEqual(continued.status_code, 200, continued.data)
        self.assertNotIn("customer", continued.data)
        self.assertIsNone(self.state()["user_id"])
        self.assertEqual(self.terminal_me(continued.data["session_token"]).status_code, 401)

    def test_end_session_also_closes_server_authentication_without_deleting_saved_basket(self):
        order = self.opened(); self.paid(order)
        key = customer_cart_key(self.user.pk, self.terminal.pk)
        self.assertTrue(self.redis.exists(key))
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/end/", token=False).status_code, 204)
        self.assertFalse(self.redis.exists(session_key(self.terminal.pk)))
        self.assertTrue(self.redis.exists(key))

    def test_replacement_visitor_cannot_continue_or_be_ended_by_previous_result(self):
        order = self.opened(); self.paid(order)
        self.start_guest(); before = self.state()
        for action in ("continue", "end"):
            self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/{action}/", token=False).status_code, 401)
        self.assertEqual(self.state(), before)

    def test_missing_return_proof_cannot_restore_identity(self):
        order = self.opened(); self.paid(order)
        before = self.state()
        self.client.cookies.clear()
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False).status_code, 401)
        self.assertEqual(self.state(), before)

    def test_admin_disabled_terminal_cannot_continue(self):
        order = self.opened(); self.paid(order)
        self.terminal.is_disabled = True
        self.terminal.save(update_fields=["is_disabled"])
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False).status_code, 401)

    def test_expired_auth_and_changed_credentials_cannot_be_restored(self):
        order = self.opened(); self.paid(order)
        before = self.state()
        self.change_state(last_activity_at=0)
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False).status_code, 409)
        self.change_state(**before)
        self.change_state(started_at=0)
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False).status_code, 409)
        self.change_state(**before)
        customer = self.user.customer
        customer.credential_changed_at = timezone.now() + timedelta(seconds=2); customer.save(update_fields=["credential_changed_at"])
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False).status_code, 401)

    def test_unpaid_return_never_authenticates_and_expired_receipt_can_end_but_not_restore(self):
        order = self.opened()
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False).status_code, 409)
        self.paid(order)
        PaymentTransaction.objects.filter(order=order).update(return_started_at=timezone.now() - timedelta(seconds=61))
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False).status_code, 401)
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/result/end/", token=False).status_code, 204)
        self.assertFalse(self.redis.exists(session_key(self.terminal.pk)))

    def test_kiosk_resume_binds_latest_live_session_and_dispenses_hub_origin_once(self):
        from apps.carts.services.cart_services import change_cart
        access = self.hub_login().data["access_token"]
        cart = change_cart(user_id=self.user.pk, terminal=self.terminal, product_id=self.product.pk, quantity=3, expected_version="empty")
        with patch.object(provider, "create_session", return_value=("hub-session", "https://payments.kashier.io/session/hub-session?mode=test")):
            opened = self.client.post("/api/v1/hub/orders/checkout/", {"terminal_serial": self.terminal.pk, "cart_version": cart["version"], "idempotency_key": str(uuid4())},
                format="json", HTTP_AUTHORIZATION="Bearer " + access)
        self.assertEqual(opened.status_code, 200, opened.data)
        order = Order.objects.get(pk=opened.data["order"]["id"])
        self.token = self.terminal_login(self.token).data["session_token"]
        with patch.object(provider, "saved_cards", return_value=[{"last_four": "1118"}]), patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}):
            response = self.terminal_call("post", f"orders/{order.pk}/resume/")
        self.assertEqual(response.status_code, 200, response.data)
        self.paid(order)
        self.assertEqual(order.channel, "HUB")
        self.assertFalse(order.collection_required)
        self.assertEqual(order.status, "COMPLETED")
        self.stock.refresh_from_db(); self.assertEqual(self.stock.quantity_on_hand, 9)
        self.paid(order)
        self.stock.refresh_from_db(); self.assertEqual(self.stock.quantity_on_hand, 9)

    def test_awaiting_payment_attention_excludes_expired_or_checking_attempts(self):
        order = self.opened()
        summary = self.terminal_call("get", "orders/summary/")
        self.assertEqual(summary.data["awaiting_payment_count"], 1)
        self.assertEqual(summary.data["attention_count"], 1)
        self.assertEqual(summary.data["awaiting_collection_count"], 0)
        Order.objects.filter(pk=order.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.terminal_call("get", "orders/summary/").data["awaiting_payment_count"], 0)

    def test_customer_resumes_original_kiosk_order_in_new_authenticated_session_and_dispenses(self):
        order = self.opened()
        original = self.state()["session_id"]
        self.token = self.start_guest()
        self.token = self.terminal_login(self.token).data["session_token"]
        self.assertNotEqual(self.state()["session_id"], original)
        with patch.object(provider, "saved_cards", return_value=[{"last_four": "1118"}]), patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}):
            resumed = self.terminal_call("post", f"orders/{order.pk}/resume/")
        self.assertEqual(resumed.status_code, 200, resumed.data)
        self.paid(order)
        self.assertEqual(order.status, "COMPLETED")
        result = self.terminal_call("post", f"orders/{order.pk}/result/continue/", token=False)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["session_id"], self.state()["session_id"])
        self.stock.refresh_from_db(); self.assertEqual(self.stock.quantity_on_hand, 9)

    def test_expired_latest_kiosk_resume_session_requires_collection_without_dispensing(self):
        order = self.opened()
        with patch.object(provider, "saved_cards", return_value=[{"last_four": "1118"}]), patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}):
            resumed = self.terminal_call("post", f"orders/{order.pk}/resume/")
        self.assertEqual(resumed.status_code, 200, resumed.data)
        self.change_state(last_activity_at=0)
        self.paid(order)
        self.assertEqual(order.status, "PENDING")
        self.assertTrue(order.collection_required)
        self.assertEqual((order.collection_deadline - order.paid_at).total_seconds(), 86400)
        self.stock.refresh_from_db(); self.assertEqual(self.stock.quantity_on_hand, 12)
