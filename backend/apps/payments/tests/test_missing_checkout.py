"""A failed-to-open checkout must not become an endless reservation loop."""
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.orders.models import Order, StockReservation
from apps.payments.services import kashier_services as provider
from apps.payments.services.payment_services import start_checkout, reconcile, cancel_purchase
from apps.payments.tests import test_payments as payment_fixtures, test_purchase_api as api_fixtures


@override_settings(KASHIER_DEFAULT_TEST_KEY="sandbox-test", KASHIER_SECRET_KEY="sandbox-test",
    KASHIER_MERCHANT_ID="MID-TEST", PAYMENTS_PUBLIC_BASE_URL="https://test.example", KIOSK_PUBLIC_BASE_URL="https://kiosk.example")
class MissingCheckoutTests(TestCase):
    setUp = payment_fixtures.PaymentTests.setUp
    reserve = payment_fixtures.PaymentTests.reserve
    listing = payment_fixtures.PaymentTests.listing

    def missing(self, expired=True):
        order = self.reserve()
        with patch.object(provider, "create_session", side_effect=provider.ProviderUnavailable()):
            with self.assertRaises(AuthError):
                start_checkout(order)
        if expired:
            Order.objects.filter(pk=order.pk).update(expires_at=timezone.now() - timedelta(minutes=2))
            order.refresh_from_db()
        return order, order.payments.get(operation="CAPTURE")

    def empty_orders(self):
        return {"status": "SUCCESS", "data": [], "pagination": {"total": 0, "page": 1, "pages": 0}}

    def test_empty_search_before_deadline_never_proves_unpaid(self):
        order, payment = self.missing(expired=False)
        with patch.object(provider, "_call", return_value=self.listing([])) as calls:
            self.assertEqual(provider.verify_order(order, "")["state"], "UNKNOWN")
        self.assertEqual(calls.call_count, 1)
        self.assertTrue(StockReservation.objects.filter(status="ACTIVE").exists())

    def test_just_expired_creation_keeps_settlement_margin(self):
        order, payment = self.missing()
        Order.objects.filter(pk=order.pk).update(expires_at=timezone.now() - timedelta(seconds=10))
        order.refresh_from_db()
        with patch.object(provider, "_call", return_value=self.listing([])) as calls:
            self.assertEqual(provider.verify_order(order, "")["state"], "UNKNOWN")
        self.assertEqual(calls.call_count, 1)

    def test_expired_missing_session_requires_complete_unfiltered_sweep_and_empty_order_search(self):
        order, payment = self.missing()
        with patch.object(provider, "_call", side_effect=[self.listing([]), self.listing([]), self.empty_orders()]) as calls:
            reconcile(payment.pk)
        self.assertEqual(calls.call_count, 3)
        self.assertNotIn("search=", calls.call_args_list[1].args[1])
        self.assertTrue(all(call.kwargs.get("method", "GET") == "GET" for call in calls.call_args_list))
        order.refresh_from_db(); payment.refresh_from_db(); self.stock.refresh_from_db()
        self.assertEqual((order.status, payment.status, order.payment_uncertain), ("CANCELLED", "FAILED", False))
        self.assertEqual(order.cancellation_reason, "CHECKOUT_EXPIRED")
        self.assertFalse(StockReservation.objects.filter(status="ACTIVE").exists())
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_incomplete_or_failed_orders_lookup_never_releases_stock(self):
        for orders in ({"data": []}, self.empty_orders() | {"status": "FAILURE"},
                self.empty_orders() | {"pagination": {"total": 1, "page": 1, "pages": 1}},
                self.empty_orders() | {"data": [{"merchantOrderId": "existing-payment"}]}):
            with self.subTest(orders=orders):
                order, payment = self.missing()
                with patch.object(provider, "_call", side_effect=[self.listing([]), self.listing([]), orders]):
                    self.assertEqual(provider.verify_order(order, "")["state"], "UNKNOWN")
                self.assertTrue(StockReservation.objects.filter(order_product__order=order, status="ACTIVE").exists())

    def test_provider_outage_never_means_unpaid(self):
        order, payment = self.missing()
        with patch.object(provider, "_call", side_effect=provider.ProviderUnavailable()):
            reconcile(payment.pk)
        order.refresh_from_db()
        self.assertTrue(order.payment_uncertain)
        self.assertTrue(StockReservation.objects.filter(status="ACTIVE").exists())

    def test_cancel_can_resolve_missing_creation_but_returns_specific_uncertainty_when_unproven(self):
        order, payment = self.missing()
        with patch.object(provider, "_call", side_effect=[self.listing([]), self.listing([]), self.empty_orders()]):
            self.assertEqual(cancel_purchase(order).status, "CANCELLED")
        fresh, _ = self.missing(expired=False)
        with patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}):
            with self.assertRaises(AuthError) as error:
                cancel_purchase(fresh)
        self.assertEqual(error.exception.code, "PAYMENT_CHECKING")


@override_settings(KASHIER_DEFAULT_TEST_KEY="sandbox-test", KASHIER_SECRET_KEY="sandbox-test",
    KASHIER_MERCHANT_ID="MID-TEST", PAYMENTS_PUBLIC_BASE_URL="https://test.example", KIOSK_PUBLIC_BASE_URL="https://kiosk.example")
class CheckoutLoopApiTests(TestCase):
    setUp = api_fixtures.PurchaseApiTests.setUp
    setup_sessions = api_fixtures.PurchaseApiTests.setup_sessions
    cleanup_redis = api_fixtures.PurchaseApiTests.cleanup_redis
    start_guest = api_fixtures.PurchaseApiTests.start_guest
    terminal_call = api_fixtures.PurchaseApiTests.terminal_call
    add = api_fixtures.PurchaseApiTests.add
    checkout = api_fixtures.PurchaseApiTests.checkout

    def test_guest_status_read_is_scoped_to_original_valid_session_not_general_history(self):
        version = self.add()
        with patch.object(provider, "create_session", return_value=("guest", "https://payments.kashier.io/session/guest?mode=test")):
            opened = self.checkout(version)
        identifier = opened.data["order"]["id"]
        self.assertEqual(self.terminal_call("get", f"orders/{identifier}/").status_code, 200)
        self.assertEqual(self.terminal_call("get", "orders/").status_code, 401)
        self.token = self.start_guest()
        self.assertEqual(self.terminal_call("get", f"orders/{identifier}/").status_code, 404)

    def test_explicit_stale_cart_rejection_is_safe_to_review_with_new_request(self):
        version = self.add()
        changed = self.terminal_call("put", f"cart/items/{self.product.pk}/", {"quantity": 2, "expected_version": version})
        rejected = self.checkout(version)
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.data["code"], "CART_CHANGED")
        self.assertFalse(Order.objects.exists())
        with patch.object(provider, "create_session", return_value=("new", "https://payments.kashier.io/session/new?mode=test")):
            self.assertEqual(self.checkout(changed.data["version"]).status_code, 200)

    def test_cancelled_idempotent_attempt_returns_result_not_endless_retry_conflict(self):
        from uuid import uuid4
        version, key = self.add(), str(uuid4())
        with patch.object(provider, "create_session", side_effect=provider.ProviderUnavailable(definitive=True)):
            self.assertEqual(self.checkout(version, idempotency_key=key).status_code, 503)
        with patch.object(provider, "create_session") as create:
            result = self.checkout(version, idempotency_key=key)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["order"]["status"], "CANCELLED")
        self.assertIsNone(result.data["checkout_url"])
        create.assert_not_called()
