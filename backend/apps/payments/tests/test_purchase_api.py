from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4
from django.test import TestCase, override_settings
from django.utils import timezone
from apps.accounts.tests.helpers import SessionFixtures
from apps.catalogue.models import Category, Product, ProductBatch
from apps.terminals.models import TerminalSlot
from apps.terminals.services.inventory_services import set_stock
from apps.payments.services import kashier_services as provider
from apps.payments.models import PaymentTransaction
from apps.orders.models import Order
from apps.orders.services.order_services import mark_paid
from apps.carts.services.cart_services import change_cart, get_cart


@override_settings(KASHIER_DEFAULT_TEST_KEY="sandbox-test", KASHIER_SECRET_KEY="sandbox-test", KASHIER_MERCHANT_ID="MID-TEST", PAYMENTS_PUBLIC_BASE_URL="https://test.example", KIOSK_PUBLIC_BASE_URL="https://kiosk.example")
class PurchaseApiTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.user.phone_verified_at = timezone.now()
        self.user.save(update_fields=["phone_verified_at"])
        category = Category.objects.create(name_en="Purchase", name_ar="شراء")
        self.product = Product.objects.create(category=category, sku="API-P", name_en="Test pack", name_ar="عبوة", price="12.50",
            pack_description="Test", usage_instructions_en="Test", usage_instructions_ar="تجريبي", max_quantity_per_order=None)
        batch = ProductBatch.objects.create(product=self.product, batch_number="API-B", expiry_date=timezone.localdate()+timedelta(days=2))
        slot = TerminalSlot.objects.create(terminal=self.terminal, product=self.product, slot_code="P", capacity=20)
        self.stock = set_stock(slot_id=slot.pk, batch=batch, quantity=12)
        self.token = self.start_guest()

    def terminal_call(self, method, path, body=None, token=None):
        headers = dict(self.headers)
        if token is not False:
            headers["HTTP_AUTHORIZATION"] = "Bearer " + (token or self.token)
        return getattr(self.client, method)("/api/v1/terminals/"+path, body or {}, format="json", **headers)

    def add(self):
        response = self.terminal_call("put", f"cart/items/{self.product.pk}/", {"quantity": 3, "expected_version": "empty"})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["version"]

    def checkout(self, version, **changes):
        body = dict(cart_version=version, email="guest@example.test", language="en", print_requested=True, idempotency_key=str(uuid4())) | changes
        return self.terminal_call("post", "orders/checkout/", body)

    def test_guest_checkout_cookie_privacy_and_session_expiry_independent_result(self):
        version = self.add()
        with patch.object(provider, "create_session", return_value=("api-session", "https://payments.kashier.io/session/api-session?mode=test")):
            response = self.checkout(version)
        self.assertEqual(response.status_code, 200, response.data)
        order_id = response.data["order"]["id"]
        cookie = next(iter(response.cookies.values()))
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")
        self.change_state(last_activity_at=0)
        self.assertEqual(self.terminal_me(self.token).status_code, 401)
        result = self.terminal_call("get", f"orders/{order_id}/result/", token=False)
        self.assertEqual(result.status_code, 200, result.data)
        history = self.terminal_call("get", "orders/", token=False)
        self.assertEqual(history.status_code, 401)
        end = self.terminal_call("post", f"orders/{order_id}/result/end/", token=False)
        self.assertEqual(end.status_code, 204)
        self.assertEqual(self.terminal_call("get", f"orders/{order_id}/result/", token=False).status_code, 401)

    def test_missing_kiosk_origin_rejects_before_order_reservation_or_provider_call(self):
        version = self.add()
        with override_settings(KIOSK_PUBLIC_BASE_URL=""), patch.object(provider, "create_session") as create:
            response = self.checkout(version)
        self.assertEqual(response.status_code, 503)
        self.assertFalse(Order.objects.exists())
        self.assertFalse(PaymentTransaction.objects.exists())
        create.assert_not_called()

    def test_https_return_uses_kiosk_origin_and_scoped_secure_cookie(self):
        version = self.add()
        selector = "a" * 32
        with patch.object(provider, "create_session", return_value=("https-session", "https://payments.kashier.io/session/https-session?mode=test")) as create:
            response = self.checkout(version, return_simulator_id=selector)
        self.assertEqual(response.status_code, 200, response.data)
        order_id = response.data["order"]["id"]
        self.assertEqual(create.call_args.args[1], f"https://test.example/api/v1/payments/return/{order_id}/")
        cookie = next(iter(response.cookies.values()))
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["path"], f"/api/v1/terminals/orders/{order_id}/")

    def test_signedin_no_saved_card_blocks_before_reservation_and_lookup_outage503(self):
        self.token = self.terminal_login(self.token).data["session_token"]
        version = self.add()
        with patch.object(provider, "saved_cards", return_value=[]):
            self.assertEqual(self.checkout(version).status_code, 400)
        self.assertFalse(Order.objects.exists())
        with patch.object(provider, "saved_cards", side_effect=provider.ProviderUnavailable()):
            self.assertEqual(self.checkout(version).status_code, 503)
        self.assertFalse(Order.objects.exists())

    def test_guest_email_required_and_forged_browser_success_not_paid(self):
        version = self.add()
        self.assertEqual(self.checkout(version, email="").status_code, 400)
        self.assertFalse(Order.objects.exists())
        self.assertEqual(self.terminal_call("get", f"orders/{uuid4()}/result/?status=SUCCESS", token=False).status_code, 401)

    def test_result_ticket_expires_and_wrong_device_denied(self):
        version = self.add()
        with patch.object(provider, "create_session", return_value=("api-session", "https://payments.kashier.io/session/api-session?mode=test")):
            response = self.checkout(version)
        order_id = response.data["order"]["id"]
        PaymentTransaction.objects.filter(order_id=order_id).update(return_started_at=timezone.now()-timedelta(seconds=61))
        self.assertEqual(self.terminal_call("get", f"orders/{order_id}/result/", token=False).status_code, 401)

    def test_new_visitor_cannot_reopen_previous_receipt_cookie(self):
        version = self.add()
        with patch.object(provider, "create_session", return_value=("visitor-session", "https://payments.kashier.io/session/visitor-session?mode=test")):
            response = self.checkout(version)
        order_id = response.data["order"]["id"]
        self.assertEqual(self.terminal_call("get", f"orders/{order_id}/result/", token=False).status_code, 200)
        self.start_guest()
        self.assertEqual(self.terminal_call("get", f"orders/{order_id}/result/", token=False).status_code, 401)

    def test_terminal_order_actions_are_post_only(self):
        for path in ["orders/checkout/", f"orders/{uuid4()}/cancel/", f"orders/{uuid4()}/collect/", f"orders/{uuid4()}/reorder/"]:
            self.assertEqual(self.terminal_call("get", path).status_code, 405)

    def test_qr_cooldown_shared_across_guest_restarts(self):
        first = self.client.post("/api/v1/auth/customers/terminal/qr-login/", HTTP_AUTHORIZATION="Bearer "+self.token, **self.headers)
        self.assertEqual(first.status_code, 201, first.data)
        self.token = self.start_guest()
        second = self.client.post("/api/v1/auth/customers/terminal/qr-login/", HTTP_AUTHORIZATION="Bearer "+self.token, **self.headers)
        self.assertEqual(second.status_code, 429)
        self.assertLessEqual(int(second["Retry-After"]), 10)

    def hub_headers(self):
        return {"HTTP_AUTHORIZATION": "Bearer " + self.hub_login().data["access_token"]}

    def test_hub_checkout_owned_history_and_collect_at_selected_terminal(self):
        headers = self.hub_headers()
        cart = change_cart(user_id=self.user.pk, terminal=self.terminal, product_id=self.product.pk, quantity=3, expected_version="empty")
        body = dict(terminal_serial=self.terminal.pk, cart_version=cart["version"], language="en", idempotency_key=str(uuid4()))
        with patch.object(provider, "create_session", return_value=("hub-session", "https://payments.kashier.io/session/hub-session?mode=test")):
            response = self.client.post("/api/v1/hub/orders/checkout/", body, format="json", **headers)
        self.assertEqual(response.status_code, 200, response.data)
        order = Order.objects.get(pk=response.data["order"]["id"])
        mark_paid(order.pk)
        self.assertEqual(self.client.get(f"/api/v1/hub/orders/{order.pk}/", **headers).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/hub/orders/", **headers).data[0]["id"], str(order.pk))
        self.token = self.terminal_login(self.token).data["session_token"]
        collected = self.terminal_call("post", f"orders/{order.pk}/collect/")
        self.assertEqual(collected.status_code, 200, collected.data)
        self.assertEqual(collected.data["status"], "COMPLETED")
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 9)
        self.assertEqual(self.terminal_call("post", f"orders/{order.pk}/collect/").status_code, 200)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 9)

    def test_guest_history_denied_and_other_customer_order_hidden(self):
        from apps.orders.services.order_services import reserve_order
        from apps.accounts.services.customer_services.registration import create_customer_account
        from datetime import date
        other = create_customer_account(first_name="Other", last_name="Customer", phone_number="01112345678",
            email="other@example.test", date_of_birth=date(2000, 1, 1), pin="4826")
        order = reserve_order(terminal=self.terminal, customer=other.customer, items={str(self.product.pk):1},
            cart_version="v", email=other.email, channel="HUB", idempotency_key=str(uuid4()))
        self.assertEqual(self.terminal_call("get", "orders/").status_code, 401)
        self.assertEqual(self.client.get(f"/api/v1/hub/orders/{order.pk}/", **self.hub_headers()).status_code, 404)
        self.assertEqual(self.client.post(f"/api/v1/auth/owners/orders/{order.pk}/cancel/", {}, format="json").status_code, 403)

    def test_reorder_requires_replacement_and_uses_current_prices_without_charging(self):
        from apps.orders.services.order_services import reserve_order, cancel_order
        order = reserve_order(terminal=self.terminal, customer=self.user.customer, items={str(self.product.pk):3},
            cart_version="v", email=self.user.email, channel="HUB", idempotency_key=str(uuid4()))
        cancel_order(order.pk)
        headers = self.hub_headers()
        cart = change_cart(user_id=self.user.pk, terminal=self.terminal, product_id=self.product.pk, quantity=1, expected_version="empty")
        self.product.price = "20.00"
        self.product.save()
        path = f"/api/v1/hub/orders/{order.pk}/reorder/"
        rejected = self.client.post(path, {"cart_version":cart["version"],"replace_existing":False}, format="json", **headers)
        self.assertEqual(rejected.status_code, 409)
        response = self.client.post(path, {"cart_version":cart["version"],"replace_existing":True}, format="json", **headers)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["total"], "60.00")
        self.assertFalse(PaymentTransaction.objects.exists())

    def test_result_polls_do_not_extend_but_explicit_interaction_does(self):
        version = self.add()
        with patch.object(provider, "create_session", return_value=("private-session", "https://payments.kashier.io/session/private-session?mode=test")):
            response = self.checkout(version)
        order_id = response.data["order"]["id"]
        payment = PaymentTransaction.objects.get(order_id=order_id)
        PaymentTransaction.objects.filter(pk=payment.pk).update(return_started_at=timezone.now()-timedelta(seconds=30))
        payment.refresh_from_db()
        clock = payment.return_started_at
        self.assertEqual(self.terminal_call("get", f"orders/{order_id}/result/", token=False).status_code, 200)
        payment.refresh_from_db()
        self.assertEqual(payment.return_started_at, clock)
        self.assertEqual(self.terminal_call("post", f"orders/{order_id}/result/activity/", token=False).status_code, 204)
        payment.refresh_from_db()
        self.assertGreater(payment.return_started_at, clock)
