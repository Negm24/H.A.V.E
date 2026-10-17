"""Payment-result authorization survives expiry, never a new visitor."""
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.db import connection
from django.test import RequestFactory, TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.accounts.tests.helpers import SessionFixtures
from apps.catalogue.models import Category, Product, ProductBatch
from apps.orders.services.order_services import reserve_order
from apps.payments.models import PaymentTransaction
from apps.payments.security.return_authorization import cookie_name, return_payment
from apps.payments.services import kashier_services as provider
from apps.payments.services.payment_services import start_checkout
from apps.terminals.models import TerminalSlot
from apps.terminals.security.state import session_key
from apps.terminals.services.inventory_services import set_stock


SANDBOX = dict(KASHIER_DEFAULT_TEST_KEY="sandbox-test", KASHIER_SECRET_KEY="sandbox-test",
    KASHIER_MERCHANT_ID="MID-TEST", PAYMENTS_PUBLIC_BASE_URL="https://test.example",
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])


class ReturnScopeFixtures(SessionFixtures):
    def setup_return_scope(self):
        self.setup_sessions()
        category = Category.objects.create(name_en="Result scope", name_ar="نتيجة الدفع")
        product = Product.objects.create(category=category, sku="RESULT-SCOPE", name_en="Test", name_ar="تجريبي",
            price="12.50", pack_description="Pack", usage_instructions_en="Test", usage_instructions_ar="تجريبي")
        batch = ProductBatch.objects.create(product=product, batch_number="RETURN-BATCH",
            expiry_date=timezone.localdate() + timedelta(days=30))
        slot = TerminalSlot.objects.create(terminal=self.terminal, product=product, slot_code="R1", capacity=20)
        set_stock(slot_id=slot.pk, batch=batch, quantity=10)
        self.guest = self.start_guest()
        self.order = reserve_order(terminal=self.terminal, customer=None, items={str(product.pk): 1},
            cart_version="return-cart", email="guest@example.test", language="en", print_requested=True,
            channel="TERMINAL", idempotency_key=uuid4().hex, terminal_session_id=self.state()["session_id"])

    def create_checkout(self, side_effect=None):
        with patch.object(provider, "create_session", side_effect=side_effect,
                return_value=("result-session", "https://payments.kashier.io/session/result-session?mode=test")) as call:
            result = start_checkout(self.order)
        return result, call

    def receipt_request(self, ticket):
        request = RequestFactory().get("/")
        request.COOKIES[cookie_name(self.order.pk)] = ticket
        return request


@override_settings(**SANDBOX)
class ReturnScopeRaceTests(ReturnScopeFixtures, TestCase):
    def setUp(self):
        self.setup_return_scope()

    def test_replacement_after_reservation_prevents_first_payment_scope(self):
        self.start_guest()
        with patch.object(provider, "create_session") as call, self.assertRaises(AuthError) as failure:
            start_checkout(self.order)
        self.assertEqual(failure.exception.status, 401)
        call.assert_not_called()
        self.assertFalse(PaymentTransaction.objects.filter(order=self.order).exists())

    def test_replacement_prevents_reissuing_an_existing_result_scope(self):
        (payment, ticket), _ = self.create_checkout()
        self.start_guest()
        with patch.object(provider, "create_session") as call, self.assertRaises(AuthError):
            start_checkout(self.order)
        call.assert_not_called()
        payment.refresh_from_db()
        self.assertIsNotNone(payment.return_ended_at)
        with self.assertRaises(AuthError):
            return_payment(self.receipt_request(ticket), self.order.pk, self.terminal)

    def test_expired_authentication_does_not_remove_an_already_issued_receipt_scope(self):
        (_, ticket), _ = self.create_checkout()
        self.redis.delete(session_key(self.terminal.pk))
        payment = return_payment(self.receipt_request(ticket), self.order.pk, self.terminal)
        self.assertEqual(payment.order_id, self.order.pk)
        self.assertIsNotNone(payment.return_started_at)

    def test_expired_original_session_cannot_issue_a_first_scope(self):
        self.change_state(last_activity_at=0)
        with patch.object(provider, "create_session") as call, self.assertRaises(AuthError):
            start_checkout(self.order)
        call.assert_not_called()
        self.assertFalse(PaymentTransaction.objects.exists())

    def test_end_session_revokes_and_cannot_reissue_a_receipt_scope(self):
        (payment, ticket), _ = self.create_checkout()
        result = self.client.post("/api/v1/terminals/sessions/end/",
            HTTP_AUTHORIZATION="Bearer " + self.guest, **self.headers)
        self.assertEqual(result.status_code, 204)
        payment.refresh_from_db()
        self.assertIsNotNone(payment.return_ended_at)
        with self.assertRaises(AuthError):
            return_payment(self.receipt_request(ticket), self.order.pk, self.terminal)
        with patch.object(provider, "create_session") as call, self.assertRaises(AuthError):
            start_checkout(self.order)
        call.assert_not_called()


@override_settings(**SANDBOX)
class ReturnScopeLockBoundaryTests(ReturnScopeFixtures, TransactionTestCase):
    def setUp(self):
        self.setup_return_scope()

    def test_replacement_during_provider_call_stays_revoked_without_network_under_locks(self):
        def replace_during_provider(*args):
            self.assertFalse(connection.in_atomic_block)
            self.start_guest()
            return "result-session", "https://payments.kashier.io/session/result-session?mode=test"
        (payment, ticket), call = self.create_checkout(side_effect=replace_during_provider)
        call.assert_called_once()
        payment.refresh_from_db()
        self.assertIsNotNone(payment.return_ended_at)
        with self.assertRaises(AuthError):
            return_payment(self.receipt_request(ticket), self.order.pk, self.terminal)
