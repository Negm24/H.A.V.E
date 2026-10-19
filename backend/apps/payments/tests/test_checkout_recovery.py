"""Shopping regressions: recovery never creates a second provider payment."""
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.accounts.tests.helpers import SessionFixtures
from apps.orders.models import Order, StockReservation
from apps.orders.services.order_services import order_data, cancel_order
from apps.payments.models import PaymentTransaction
from apps.payments.services import kashier_services as provider
from apps.payments.services.payment_services import reconcile
from apps.payments.tests import test_payments as payment_fixtures, test_purchase_api as api_fixtures


@override_settings(KASHIER_DEFAULT_TEST_KEY="sandbox-test", KASHIER_SECRET_KEY="sandbox-test",
    KASHIER_MERCHANT_ID="MID-TEST", PAYMENTS_PUBLIC_BASE_URL="https://hub.example",
    KIOSK_PUBLIC_BASE_URL="https://laptop.example.ts.net:8443",
    DEVELOPMENT_KIOSK_PUBLIC_ORIGIN="https://laptop.example.ts.net:8443")
class CheckoutRecoveryTests(TestCase):
    setUp = payment_fixtures.PaymentTests.setUp
    reserve = payment_fixtures.PaymentTests.reserve
    session = payment_fixtures.PaymentTests.session

    def test_kiosk_checkout_uses_neutral_hub_return_not_provider_8443_redirect(self):
        order = self.reserve(channel="TERMINAL", print_requested=True)
        with patch.object(provider, "create_session", return_value=("sid", "https://payments.kashier.io/session/sid?mode=test")) as call:
            from apps.payments.services.payment_services import start_checkout
            start_checkout(order, simulator_id="a" * 32)
        self.assertEqual(call.call_args.args[1], f"https://hub.example/api/v1/payments/return/{order.pk}/")
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_customer_can_resume_kiosk_purchase_in_hub_without_new_provider_session(self):
        from apps.payments.services.payment_services import resume_checkout
        order = self.reserve(channel="TERMINAL", print_requested=True)
        capture, _ = self.session(order)
        deadline = order.expires_at
        with patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}), patch.object(provider, "create_session") as create:
            payment, ticket = resume_checkout(order, user_id=self.user.pk, app="HUB")
        create.assert_not_called()
        self.assertEqual(payment.pk, capture.pk)
        self.assertIsNone(ticket)
        order.refresh_from_db()
        self.assertTrue(order.collection_required)
        self.assertEqual(order.expires_at, deadline)
        self.assertEqual(payment.return_app, "HUB")

    def test_remote_resume_does_not_dispense_when_verification_finds_payment(self):
        from apps.payments.services.payment_services import resume_checkout
        order = self.reserve(channel="TERMINAL", print_requested=True)
        self.session(order)
        with patch.object(provider, "verify_order", return_value={"state": "PAID", "provider_reference": "paid-remote"}):
            payment, _ = resume_checkout(order, user_id=self.user.pk, app="HUB")
        order.refresh_from_db()
        self.assertEqual(payment.status, "SUCCEEDED")
        self.assertTrue(order.collection_required)
        self.assertEqual(order.status, "PENDING")
        self.assertEqual((order.collection_deadline - order.paid_at).total_seconds(), 86400)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_expired_original_customer_session_requires_collection_on_late_confirmation(self):
        from apps.terminals.security.state import session_key
        order = self.reserve(channel="TERMINAL", print_requested=True)
        payment, _ = self.session(order)
        self.redis.delete(session_key(self.terminal.pk))
        with patch.object(provider, "verify_order", return_value={"state": "PAID", "provider_reference": "late-session"}):
            reconcile(payment.pk)
        order.refresh_from_db()
        self.assertTrue(order.collection_required)
        self.assertEqual(order.status, "PENDING")
        self.assertIsNotNone(order.collection_deadline)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_expired_unpaid_provider_is_closed_before_release(self):
        order = self.reserve()
        payment, _ = self.session(order)
        Order.objects.filter(pk=order.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        with patch.object(provider, "verify_order", side_effect=[{"state": "UNKNOWN"}, {"state": "FAILED"}]), patch.object(provider, "abandon_session") as close:
            reconcile(payment.pk)
        close.assert_called_once_with(payment.session_id)
        order.refresh_from_db()
        self.assertEqual((order.status, order.cancellation_reason), ("CANCELLED", "CHECKOUT_EXPIRED"))
        self.assertFalse(StockReservation.objects.filter(order_product__order=order, status="ACTIVE").exists())

    def test_expired_ambiguous_payment_keeps_allocations_and_cannot_resume(self):
        from apps.payments.services.payment_services import resume_checkout
        order = self.reserve()
        payment, _ = self.session(order)
        Order.objects.filter(pk=order.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        with patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}), patch.object(provider, "abandon_session", side_effect=provider.ProviderUnavailable()):
            resumed, _ = resume_checkout(order, user_id=self.user.pk, app="HUB")
        order.refresh_from_db()
        self.assertEqual(resumed.pk, payment.pk)
        self.assertEqual(order_data(order)["payment_state"], "CHECKING_PAYMENT")
        self.assertFalse(order_data(order)["can_resume"])
        self.assertTrue(StockReservation.objects.filter(order_product__order=order, status="ACTIVE").exists())

    def test_verified_payment_after_definitive_cancellation_queues_refund_not_fulfilment(self):
        order = self.reserve(channel="TERMINAL", print_requested=True)
        payment, _ = self.session(order)
        cancel_order(order.pk, "CHECKOUT_EXPIRED", definitive_unpaid=True)
        with patch.object(provider, "verify_order", return_value={"state": "PAID", "provider_reference": "late-cancelled"}):
            reconcile(payment.pk)
        order.refresh_from_db()
        self.assertEqual(order.status, "CANCELLED")
        self.assertEqual(order.payments.get(operation="REFUND").amount, order.customer_payable_amount)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_expired_uncertain_hold_recovers_to_collectible_after_late_verified_payment(self):
        order = self.reserve()
        payment, _ = self.session(order)
        Order.objects.filter(pk=order.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        with patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}), patch.object(provider, "abandon_session"):
            reconcile(payment.pk)
        order.refresh_from_db()
        self.assertEqual(order.status, "REVIEW_REQUIRED")
        with patch.object(provider, "verify_order", return_value={"state": "PAID", "provider_reference": "delayed-confirmation"}):
            reconcile(payment.pk)
        order.refresh_from_db()
        self.assertEqual(order.status, "PENDING")
        self.assertTrue(order.collection_required)
        self.assertEqual((order.collection_deadline - order.paid_at).total_seconds(), 86400)
        self.assertTrue(StockReservation.objects.filter(order_product__order=order, status="ACTIVE").exists())
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_resume_rejects_other_customer_and_expired_guest_ownership(self):
        from apps.payments.services.payment_services import resume_checkout
        order = self.reserve()
        self.session(order)
        with self.assertRaises(AuthError):
            resume_checkout(order, user_id="not-the-owner", app="HUB")
        guest = self.reserve(customer=None, channel="TERMINAL", print_requested=True)
        self.session(guest)
        with self.assertRaises(AuthError):
            resume_checkout(guest, user_id=self.user.pk, app="HUB")

    def test_neutral_return_ignores_untrusted_redirect_and_payment_parameters(self):
        order = self.reserve()
        payment, _ = self.session(order)
        response = self.client.get(f"/api/v1/payments/return/{order.pk}/?redirect=https://evil.example&status=SUCCESS")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], f"https://hub.example/orders/{order.pk}?payment=return")
        payment.refresh_from_db()
        self.assertEqual(payment.status, "PENDING")

    def test_neutral_kiosk_return_preserves_only_stored_selector(self):
        order = self.reserve(channel="TERMINAL", print_requested=True)
        from apps.payments.services.payment_services import start_checkout
        with patch.object(provider, "create_session", return_value=("sid", "https://payments.kashier.io/session/sid?mode=test")):
            start_checkout(order, simulator_id="a" * 32)
        response = self.client.get(f"/api/v1/payments/return/{order.pk}/?terminal=evil")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], f"https://laptop.example.ts.net:8443/payment-return?order_id={order.pk}&terminal={'a' * 32}")

    def test_finished_purchase_cannot_be_rewritten_as_remote_collection(self):
        from apps.payments.services.payment_services import resume_checkout
        order = self.reserve(channel="TERMINAL", print_requested=True)
        payment, _ = self.session(order)
        with patch.object(provider, "verify_order", return_value={"state": "PAID", "provider_reference": "already-dispensed"}):
            reconcile(payment.pk)
        resume_checkout(order, user_id=self.user.pk, app="HUB")
        order.refresh_from_db()
        self.assertEqual(order.status, "COMPLETED")
        self.assertFalse(order.collection_required)
        self.assertIsNone(order.collection_deadline)

    def test_paid_purchase_converted_before_dispense_gets_collection_receipt(self):
        from apps.orders.services.order_services import mark_paid
        from apps.orders.models import Receipt
        from apps.payments.services.payment_services import resume_checkout
        order = self.reserve(channel="TERMINAL", print_requested=True)
        self.session(order)
        mark_paid(order.pk)
        self.assertFalse(Receipt.objects.filter(order=order).exists())
        resume_checkout(order, user_id=self.user.pk, app="HUB")
        self.assertEqual(Receipt.objects.get(order=order).receipt_snapshot["fulfilment"], "AWAITING_COLLECTION")
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_hub_purchase_resume_on_kiosk_authorises_local_dispense_and_restricts_receipt_scope(self):
        from apps.payments.services.payment_services import resume_checkout
        from apps.terminals.services.session_services import operate
        from apps.payments.security.return_authorization import cookie_name, return_payment, revoke_terminal_results
        from django.test import RequestFactory
        order = self.reserve()
        payment, _ = self.session(order)
        state, guest = operate(self.terminal, "start")
        self.user.phone_verified_at = timezone.now()
        self.user.save(update_fields=["phone_verified_at"])
        state, _ = operate(self.terminal, "login", guest, user=self.user)
        with patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}), patch.object(provider, "saved_cards", return_value=[{"last_four": "1118"}]), patch.object(provider, "create_session") as create:
            resumed, ticket = resume_checkout(order, user_id=self.user.pk, app="TERMINAL", terminal=self.terminal,
                session_id=state["session_id"], simulator_id="b" * 32)
        create.assert_not_called()
        self.assertEqual(resumed.pk, payment.pk)
        self.assertTrue(ticket)
        self.assertEqual(resumed.return_app, "TERMINAL")
        self.assertEqual(str(resumed.return_terminal_session_id), state["session_id"])
        order.refresh_from_db()
        self.assertFalse(order.collection_required)
        request = RequestFactory().get("/")
        request.COOKIES[cookie_name(order.pk)] = ticket
        self.assertEqual(return_payment(request, order.pk, self.terminal).pk, payment.pk)
        # SessionStartView revokes result tickets under the Terminal row lock
        # before creating the next guest; operate() is deliberately Redis-only.
        revoke_terminal_results(self.terminal)
        operate(self.terminal, "start")
        with self.assertRaises(AuthError):
            return_payment(request, order.pk, self.terminal)

    def test_customer_resume_at_another_machine_and_without_saved_card_is_rejected(self):
        from apps.payments.services.payment_services import resume_checkout
        from apps.terminals.models import Terminal
        from apps.terminals.services.session_services import operate
        order = self.reserve()
        self.session(order)
        with self.assertRaises(AuthError):
            resume_checkout(order, user_id=self.user.pk, app="TERMINAL", terminal=Terminal(serial_number="OTHER"), session_id=uuid4())
        _, guest = operate(self.terminal, "start")
        self.user.phone_verified_at = timezone.now()
        self.user.save(update_fields=["phone_verified_at"])
        state, _ = operate(self.terminal, "login", guest, user=self.user)
        with patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}), patch.object(provider, "saved_cards", return_value=[]), self.assertRaises(AuthError):
            resume_checkout(order, user_id=self.user.pk, app="TERMINAL", terminal=self.terminal, session_id=state["session_id"])


@override_settings(KASHIER_DEFAULT_TEST_KEY="sandbox-test", KASHIER_SECRET_KEY="sandbox-test",
    KASHIER_MERCHANT_ID="MID-TEST", PAYMENTS_PUBLIC_BASE_URL="https://hub.example", KIOSK_PUBLIC_BASE_URL="https://kiosk.example")
class CheckoutRecoveryApiTests(SessionFixtures, TestCase):
    setUp = api_fixtures.PurchaseApiTests.setUp
    terminal_call = api_fixtures.PurchaseApiTests.terminal_call
    add = api_fixtures.PurchaseApiTests.add
    checkout = api_fixtures.PurchaseApiTests.checkout

    def test_guest_can_resume_and_cancel_only_with_original_active_session(self):
        version = self.add()
        with patch.object(provider, "create_session", return_value=("guest-recover", "https://payments.kashier.io/session/guest-recover?mode=test")) as create:
            first = self.checkout(version)
            order_id = first.data["order"]["id"]
            with patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}):
                resumed = self.terminal_call("post", f"orders/{order_id}/resume/", {"return_simulator_id": "a" * 32})
        create.assert_called_once()
        self.assertEqual(resumed.status_code, 200, resumed.data)
        self.assertTrue(resumed.data["checkout_url"])
        self.assertTrue(resumed.cookies)
        with patch.object(provider, "abandon_session"), patch.object(provider, "verify_order", return_value={"state": "FAILED"}):
            cancelled = self.terminal_call("post", f"orders/{order_id}/cancel/")
        self.assertEqual(cancelled.status_code, 200, cancelled.data)
        self.assertEqual(cancelled.data["status"], "CANCELLED")

    def test_replacement_guest_session_cannot_recover_or_cancel_original_order(self):
        version = self.add()
        with patch.object(provider, "create_session", return_value=("guest-recover", "https://payments.kashier.io/session/guest-recover?mode=test")):
            first = self.checkout(version)
        order_id = first.data["order"]["id"]
        self.token = self.start_guest()
        for action in ("resume", "cancel"):
            self.assertEqual(self.terminal_call("post", f"orders/{order_id}/{action}/").status_code, 404)

    def test_new_key_cannot_duplicate_unfinished_checkout_and_cart_is_not_deleted(self):
        version = self.add()
        with patch.object(provider, "create_session", return_value=("one-checkout", "https://payments.kashier.io/session/one-checkout?mode=test")) as create:
            first = self.checkout(version)
            second = self.checkout(version)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data["order"]["id"], first.data["order"]["id"])
        self.assertIsNone(second.data["checkout_url"])
        self.assertEqual(Order.objects.count(), 1)
        create.assert_called_once()
        current = self.terminal_call("get", "cart/")
        self.assertEqual(current.data["version"], version)
        self.assertEqual(current.data["total_quantity"], 3)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_provider_rejection_preserves_guest_cart_and_releases_only_reservation(self):
        version = self.add()
        with patch.object(provider, "create_session", side_effect=provider.ProviderUnavailable(definitive=True)):
            result = self.checkout(version)
        self.assertEqual(result.status_code, 503)
        current = self.terminal_call("get", "cart/")
        self.assertEqual(current.data["version"], version)
        self.assertEqual(current.data["total_quantity"], 3)
        self.assertFalse(StockReservation.objects.filter(status="ACTIVE").exists())
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_hub_then_kiosk_then_hub_resume_share_one_session_and_checkout_deadline(self):
        from apps.carts.services.cart_services import change_cart
        headers = {"HTTP_AUTHORIZATION": "Bearer " + self.hub_login().data["access_token"]}
        cart = change_cart(user_id=self.user.pk, terminal=self.terminal, product_id=self.product.pk,
            quantity=3, expected_version="empty")
        body = {"terminal_serial": self.terminal.pk, "cart_version": cart["version"], "idempotency_key": str(uuid4())}
        with patch.object(provider, "create_session", return_value=("cross-app", "https://payments.kashier.io/session/cross-app?mode=test")) as create:
            opened = self.client.post("/api/v1/hub/orders/checkout/", body, format="json", **headers)
            self.assertEqual(opened.status_code, 200, opened.data)
            order_id = opened.data["order"]["id"]
            deadline = opened.data["order"]["expires_at"]
            self.token = self.terminal_login(self.token).data["session_token"]
            with patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}), patch.object(provider, "saved_cards", return_value=[{"last_four": "1118"}]):
                kiosk = self.terminal_call("post", f"orders/{order_id}/resume/", {"return_simulator_id": "c" * 32})
                self.assertEqual(kiosk.status_code, 200, kiosk.data)
                self.assertEqual(kiosk.data["checkout_url"], opened.data["checkout_url"])
                self.assertEqual(kiosk.data["order"]["expires_at"], deadline)
                self.assertTrue(kiosk.cookies)
                hub = self.client.post(f"/api/v1/hub/orders/{order_id}/resume/", {}, format="json", **headers)
        create.assert_called_once()
        self.assertEqual(hub.status_code, 200, hub.data)
        self.assertEqual(hub.data["checkout_url"], opened.data["checkout_url"])
        self.assertEqual(hub.data["order"]["expires_at"], deadline)
        self.assertTrue(hub.data["order"]["collection_required"])
        self.assertEqual(PaymentTransaction.objects.get(order_id=order_id).return_app, "HUB")
        # The old Kiosk result cookie cannot read a scope moved back to Hub.
        self.assertEqual(self.terminal_call("get", f"orders/{order_id}/result/", token=False).status_code, 401)
