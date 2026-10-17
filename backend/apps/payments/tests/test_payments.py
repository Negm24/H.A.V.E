from datetime import timedelta
import hashlib
import hmac
from io import BytesIO
import json
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError
from urllib.parse import quote
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.accounts.security.state import get_redis_client
from apps.accounts.tests.helpers import SessionFixtures
from apps.orders.models import Order, StockReservation
from apps.orders.tests import test_orders as domain
from apps.payments.models import PaymentTransaction
from apps.payments.security.webhook import verify_webhook
from apps.payments.services import kashier_services as provider
from apps.payments.services.payment_services import start_checkout, reconcile, request_refund, process_refund, cancel_purchase
from apps.terminals.services.session_services import operate


@override_settings(KASHIER_DEFAULT_TEST_KEY="sandbox-api-test", KASHIER_SECRET_KEY="sandbox-secret-test",
    KASHIER_MERCHANT_ID="MID-TEST", PAYMENTS_PUBLIC_BASE_URL="https://test.example")
class PaymentTests(TestCase):
    def setUp(self):
        domain.OrderTests.setUp(self)
        self.prefix = f"have:test:payments:{uuid4().hex}:"
        override = override_settings(AUTH_REDIS_PREFIX=self.prefix)
        override.enable()
        self.addCleanup(override.disable)
        self.redis = get_redis_client()
        self.addCleanup(SessionFixtures.cleanup_redis, self)

    def reserve(self, **changes):
        if changes.get("channel") == "TERMINAL" and "terminal_session_id" not in changes:
            state, raw_token = operate(self.terminal, "start")
            customer = changes.get("customer", self.user.customer)
            if customer is not None:
                user = customer.user
                user.phone_verified_at = timezone.now()
                user.save(update_fields=["phone_verified_at"])
                state, _ = operate(self.terminal, "login", raw_token, user=user)
            changes["terminal_session_id"] = state["session_id"]
        return domain.OrderTests.reserve(self, **changes)

    def session(self, order):
        with patch.object(provider, "create_session", return_value=("session123", "https://payments.kashier.io/session/session123?mode=test")):
            return start_checkout(order)

    def test_capture_creation_idempotent_and_no_network_under_transaction(self):
        order = self.reserve()
        with patch.object(provider, "create_session", return_value=("session123", "https://payments.kashier.io/session/session123?mode=test")) as create:
            first, _ = start_checkout(order)
            second, _ = start_checkout(order)
        self.assertEqual(first.pk, second.pk)
        create.assert_called_once()
        self.assertEqual(PaymentTransaction.objects.count(), 1)

    def test_creation_timeout_never_reissues_uncertain_charge(self):
        order = self.reserve()
        with patch.object(provider, "create_session", side_effect=provider.ProviderUnavailable()) as create:
            with self.assertRaises(AuthError):
                start_checkout(order)
            with self.assertRaises(AuthError):
                start_checkout(order)
        create.assert_called_once()
        order.refresh_from_db()
        self.assertTrue(order.payment_uncertain)
        self.assertEqual(order.reservations.count() if hasattr(order, "reservations") else StockReservation.objects.filter(order_product__order=order, status="ACTIVE").count(), 1)

    def test_validation_rejection_releases_allocations_without_repeating_creation(self):
        order = self.reserve()
        failure = HTTPError(provider.API, 400, "Bad request", {},
                            BytesIO(b'{"message":"\\"merchantRedirect\\" must be a valid URL"}'))
        with patch.object(provider, "urlopen", side_effect=failure) as call:
            with self.assertRaises(provider.ProviderUnavailable):
                start_checkout(order)
            with self.assertRaises(AuthError):
                start_checkout(order)
        call.assert_called_once()
        order.refresh_from_db()
        self.assertEqual((order.status, order.payment_uncertain), ("CANCELLED", False))
        self.assertEqual(order.payments.get().status, "FAILED")
        self.assertFalse(StockReservation.objects.filter(order_product__order=order, status="ACTIVE").exists())
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_duplicate_unrecognized_or_malformed400_stays_uncertain(self):
        for body in (b'{"message":"Order already exists"}', b'{"message":"Bad request"}', b'not-json'):
            with self.subTest(body=body):
                failure = HTTPError(provider.API, 400, "Bad request", {}, BytesIO(body))
                with patch.object(provider, "urlopen", side_effect=failure), self.assertRaises(provider.ProviderUnavailable) as error:
                    provider._call(provider.API, "/v3/payment/sessions", method="POST", body={})
                self.assertFalse(error.exception.definitive)

    def test_provider_success_must_be_a_json_object(self):
        for body in (b'[]', b'null', b'not-json'):
            with self.subTest(body=body), patch.object(provider, "urlopen") as call:
                call.return_value.__enter__.return_value.read.return_value = body
                with self.assertRaises(provider.ProviderUnavailable):
                    provider._call(provider.API, "/v3/payment/sessions")

    def session_document(self, order, **changes):
        return {"_id": "recovered1", "merchantId": "MID-TEST", "status": "CREATED",
                "paymentParams": {"order": order.order_number, "currency": "EGP",
                                  "amount": str(order.customer_payable_amount)}, **changes}

    def listing(self, rows, *, page=1, pages=1, total=None):
        return {"data": rows, "pagination": {"page": page, "pages": pages,
                "total": len(rows) if total is None else total}}

    def test_lost_creation_recovers_and_persists_session_without_another_post(self):
        order = self.reserve()
        with patch.object(provider, "create_session", side_effect=provider.ProviderUnavailable()):
            with self.assertRaises(AuthError):
                start_checkout(order)
        document = self.session_document(order)
        payment = order.payments.get()
        pending = {"data": {"sessionId": "recovered1", "merchantId": "MID-TEST", "merchantOrderId": order.order_number,
            "currency": "EGP", "amount": str(order.subtotal), "orderId": "NA", "status": "CREATED"}}
        with patch.object(provider, "_call", side_effect=[self.listing([document]), document, pending, {"data": []}]) as reads:
            reconcile(payment.pk)
        self.assertTrue(all(call.kwargs.get("method", "GET") == "GET" for call in reads.call_args_list))
        payment.refresh_from_db()
        self.assertEqual(payment.session_id, "recovered1")
        self.assertEqual(payment.checkout_url, "https://payments.kashier.io/session/recovered1?mode=test")
        with patch.object(provider, "create_session") as create:
            resumed, _ = start_checkout(order)
        create.assert_not_called()
        self.assertEqual(resumed.pk, payment.pk)

    def test_session_recovery_validates_all_pages_and_exact_reference(self):
        order = self.reserve()
        document = self.session_document(order)
        unrelated = self.session_document(order, _id="unrelated", paymentParams={"order": "another-order"})
        with patch.object(provider, "_call", side_effect=[self.listing([unrelated], pages=2, total=2),
                self.listing([document], page=2, pages=2, total=2), document]) as call:
            self.assertEqual(provider.recover_session(order)[0], "recovered1")
        self.assertIn("page=2", call.call_args_list[1].args[1])
        with patch.object(provider, "_call", return_value=self.listing([unrelated])):
            self.assertIsNone(provider.recover_session(order))

    def test_session_recovery_rejects_mismatch_ambiguity_and_incomplete_listing(self):
        order = self.reserve()
        document = self.session_document(order)
        for changes in ({"merchantId": "foreign"}, {"mode": "live"}, {"_id": "foreign"},
                {"paymentParams": document["paymentParams"] | {"amount": "0.01"}},
                {"paymentParams": document["paymentParams"] | {"currency": "USD"}}):
            with self.subTest(changes=changes), patch.object(provider, "_call", side_effect=[self.listing([document]), document | changes]):
                with self.assertRaises(provider.ProviderUnavailable):
                    provider.recover_session(order)
        for listing in (self.listing([document], total=2), self.listing([document], pages=11),
                self.listing([document, document | {"_id": "duplicate-reference"}]), {"data": [document]}):
            with self.subTest(listing=listing), patch.object(provider, "_call", return_value=listing):
                with self.assertRaises(provider.ProviderUnavailable):
                    provider.recover_session(order)

    def test_cancel_after_reconciliation_closed_unpaid_order_is_idempotent(self):
        order = self.reserve()
        self.session(order)
        with patch.object(provider, "abandon_session"), patch.object(provider, "verify_order", return_value={"state": "FAILED"}):
            self.assertEqual(cancel_purchase(order).status, "CANCELLED")
            self.assertEqual(cancel_purchase(order).status, "CANCELLED")
        self.assertFalse(StockReservation.objects.filter(order_product__order=order, status="ACTIVE").exists())

    def test_terminal_lost_response_reissues_only_its_cookie_not_another_charge(self):
        order = self.reserve(channel="TERMINAL", print_requested=True)
        with patch.object(provider, "create_session", return_value=("session123", "https://payments.kashier.io/session/session123?mode=test")) as create:
            payment, first_ticket = start_checkout(order)
            second_payment, second_ticket = start_checkout(order)
        self.assertEqual(payment.pk, second_payment.pk)
        self.assertTrue(second_ticket)
        self.assertNotEqual(first_ticket, second_ticket)
        create.assert_called_once()

    def test_ended_checkout_key_never_reopens_a_hosted_session(self):
        order = self.reserve()
        self.session(order)
        Order.objects.filter(pk=order.pk).update(status="CANCELLED")
        with patch.object(provider, "create_session") as call:
            with self.assertRaises(AuthError):
                start_checkout(order)
        call.assert_not_called()

    def test_refund_stale_worker_cannot_overwrite_a_newer_success(self):
        order, refund = self.paid_cancelled()
        def newer_worker(*args):
            PaymentTransaction.objects.filter(pk=refund.pk).update(status="SUCCEEDED", attempts=99)
            Order.objects.filter(pk=order.pk).update(total_refunded=refund.amount)
            return {"status": "PENDING"}
        with patch.object(provider, "refund", side_effect=newer_worker):
            process_refund(refund.pk)
        refund.refresh_from_db()
        self.assertEqual(refund.status, "SUCCEEDED")

    def test_declined_attempt_while_session_open_remains_uncertain_until_success(self):
        order = self.reserve()
        session = {"data": {"sessionId": "sid", "merchantId": "MID-TEST", "merchantOrderId": order.order_number,
            "currency": "EGP", "amount": str(order.subtotal), "orderId": "provider1", "status": "PENDING"}}
        failed_attempt = {"data": [{"merchantOrderId": order.order_number, "orderId": "provider1", "status": "FAILED"}]}
        with patch.object(provider, "_call", side_effect=[session, failed_attempt]):
            self.assertEqual(provider.verify_order(order, "sid")["state"], "UNKNOWN")
        captured = {"data": [{"merchantOrderId": order.order_number, "orderId": "provider1", "status": "CAPTURED"}]}
        with patch.object(provider, "_call", side_effect=[session, captured]):
            self.assertEqual(provider.verify_order(order, "sid")["state"], "PAID")

    def test_missing_session_becomes_explicit_review_after_checkout_deadline(self):
        order = self.reserve()
        with patch.object(provider, "create_session", side_effect=provider.ProviderUnavailable()):
            with self.assertRaises(AuthError):
                start_checkout(order)
        Order.objects.filter(pk=order.pk).update(expires_at=timezone.now()-timedelta(seconds=1))
        payment = order.payments.get()
        with patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}):
            reconcile(payment.pk)
        order.refresh_from_db()
        self.assertEqual(order.status, "REVIEW_REQUIRED")
        self.assertTrue(order.payment_uncertain)
        self.assertTrue(StockReservation.objects.filter(order_product__order=order, status="ACTIVE").exists())

    def test_definitive_auth_rejection_releases_stock(self):
        order = self.reserve()
        with patch.object(provider, "create_session", side_effect=provider.ProviderUnavailable(definitive=True)):
            with self.assertRaises(AuthError):
                start_checkout(order)
        order.refresh_from_db()
        self.assertEqual(order.status, "CANCELLED")
        self.assertFalse(order.payment_uncertain)
        self.assertFalse(StockReservation.objects.filter(order_product__order=order, status="ACTIVE").exists())

    def test_verified_hub_capture_has_fixed_deadline_and_duplicate_safe(self):
        order = self.reserve()
        payment, _ = self.session(order)
        with patch.object(provider, "verify_order", return_value={"state": "PAID", "provider_reference": "provider-order-1"}):
            reconcile(payment.pk)
            order.refresh_from_db()
            deadline = order.collection_deadline
            reconcile(payment.pk)
        order.refresh_from_db()
        self.assertEqual(order.total_paid, order.subtotal)
        self.assertEqual(order.collection_deadline, deadline)
        self.assertEqual((deadline - order.paid_at).total_seconds(), 86400)
        self.assertEqual(order.status, "PENDING")
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_verified_terminal_capture_deducts_once_and_completes(self):
        order = self.reserve(channel="TERMINAL", print_requested=True)
        payment, ticket = self.session(order)
        self.assertTrue(ticket)
        with patch.object(provider, "verify_order", return_value={"state": "PAID", "provider_reference": "provider-terminal-1"}):
            reconcile(payment.pk)
            reconcile(payment.pk)
        order.refresh_from_db()
        self.stock.refresh_from_db()
        self.assertEqual(order.status, "COMPLETED")
        self.assertEqual(self.stock.quantity_on_hand, 9)
        self.assertTrue(order.receipt)

    def test_pending_retains_reservations_and_definitive_failed_releases(self):
        order = self.reserve()
        payment, _ = self.session(order)
        with patch.object(provider, "verify_order", return_value={"state": "UNKNOWN"}):
            reconcile(payment.pk)
        self.assertTrue(StockReservation.objects.filter(order_product__order=order, status="ACTIVE").exists())
        with patch.object(provider, "verify_order", return_value={"state": "FAILED"}):
            reconcile(payment.pk)
        order.refresh_from_db()
        self.assertEqual(order.status, "CANCELLED")

    def paid_cancelled(self):
        order = self.reserve()
        capture, _ = self.session(order)
        with patch.object(provider, "verify_order", return_value={"state": "PAID", "provider_reference": "paid-reference"}):
            reconcile(capture.pk)
        from apps.orders.services.order_services import cancel_order
        order = cancel_order(order.pk, "COLLECTION_EXPIRED")
        return order, request_refund(order)

    def test_full_refund_durable_and_success_does_not_change_onhand(self):
        order, refund = self.paid_cancelled()
        self.assertEqual(request_refund(order).pk, refund.pk)
        with patch.object(provider, "refund", return_value={"status": "SUCCESS", "transactionId": "refund-1"}) as call:
            process_refund(refund.pk)
            process_refund(refund.pk)
        call.assert_called_once()
        order.refresh_from_db()
        self.assertEqual(order.total_refunded, order.total_paid)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)

    def test_uncertain_refund_is_reconciled_not_resubmitted(self):
        order, refund = self.paid_cancelled()
        with patch.object(provider, "refund", side_effect=provider.ProviderUnavailable()) as call:
            process_refund(refund.pk)
            with patch.object(provider, "refund_state", return_value="SUCCEEDED"):
                process_refund(refund.pk)
        call.assert_called_once()
        order.refresh_from_db()
        self.assertEqual(order.total_refunded, order.total_paid)

    def test_failed_refund_not_reported_completed_or_retried(self):
        order, refund = self.paid_cancelled()
        with patch.object(provider, "refund", return_value={"status": "FAILURE"}) as call:
            process_refund(refund.pk)
            process_refund(refund.pk)
        call.assert_called_once()
        order.refresh_from_db()
        refund.refresh_from_db()
        self.assertEqual(order.total_refunded, 0)
        self.assertEqual(refund.status, "FAILED")

    def test_saved_cards_never_return_tokens_or_other_customer_cards(self):
        reference = provider.customer_reference(self.user.customer)
        payload = {"status": "SUCCESS", "response": {"paymentMethods": [
            {"type": "CARD", "customer": {"reference": reference}, "card": {"number": "5123********0008", "cardToken": "PRIVATE", "expiry": {"month": "06", "year": "25"}}},
            {"type": "CARD", "customer": {"reference": "someone-else"}, "card": {"number": "5555********7777", "cardToken": "OTHER"}},
        ]}}
        with patch.object(provider, "_call", return_value=payload) as call:
            cards = provider.saved_cards(self.user.customer)
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["last_four"], "0008")
        self.assertNotIn("PRIVATE", json.dumps(cards))
        expected = hmac.new(b"sandbox-api-test", f"/?tokenization=MID-TEST.{reference}".encode(), hashlib.sha256).hexdigest()
        self.assertEqual(call.call_args.kwargs["headers"]["Kashier-Hash"], expected)

    def test_saved_card_outage_not_empty_and_documented_no_card400_is_empty(self):
        with patch.object(provider, "_call", side_effect=provider.ProviderUnavailable()):
            with self.assertRaises(AuthError):
                provider.saved_cards(self.user.customer)
        failure = HTTPError("https://test-fep.kashier.io", 400, "Bad", {}, BytesIO(b'{"message":"There are no cards with this token"}'))
        with patch.object(provider, "urlopen", side_effect=failure):
            self.assertEqual(provider.saved_cards(self.user.customer), [])

    def test_session_payload_guest_isolation_and_testonly_url(self):
        order = self.reserve(customer=None, channel="TERMINAL", print_requested=True)
        with patch.object(provider, "_call", return_value={"_id": "abc", "sessionUrl": "https://payments.kashier.io/session/abc?mode=test"}) as call:
            provider.create_session(order, "http://localhost:5173/payment-return")
        body = call.call_args.kwargs["body"]
        self.assertFalse(body["retrieveSavedCard"])
        self.assertNotIn("reference", body["customer"])
        self.assertNotIn("saveCard", body)
        self.assertFalse(body["manualCapture"])
        # Live sandbox validation rejects this documented-but-unsupported field.
        self.assertNotIn("mode", body)
        self.assertEqual(call.call_args.args[:2], ("https://test-api.kashier.io", "/v3/payment/sessions"))
        for url in ["https://payments.kashier.io/session/abc?mode=live", "http://payments.kashier.io/session/a?mode=test", "https://evil.test/?mode=test"]:
            self.assertFalse(provider.valid_checkout_url(url))

    def test_abandon_uses_current_hosted_hash_and_payload_not_obsolete_empty_patch(self):
        params = {"hash": "private-payment-hash", "currency": "EGP", "amount": "55.50", "order": "order-ref",
                  "customer": {"reference": "customer-ref"}}
        document = {"message": "success", "data": {"_id": "session1", "merchantId": "MID-TEST", "paymentParams": params}}
        with patch.object(provider, "_call", side_effect=[document, {"status": "ABANDONED"}]) as call:
            provider.abandon_session("session1")
        self.assertEqual(call.call_args_list[0].args, (provider.API, "/v3/payment/sessions/session1"))
        self.assertEqual(call.call_args.kwargs["method"], "PATCH")
        self.assertEqual(call.call_args.kwargs["headers"], {"Kashier-Hash": "private-payment-hash"})
        self.assertEqual(call.call_args.kwargs["body"], {"merchantId": "MID-TEST", "customer": params["customer"],
            "order": {"currency": "EGP", "amount": "55.50", "reference": "order-ref", "originalAmount": "55.50"}})

    def test_abandon_rejects_foreign_missing_or_malformed_session_before_patch(self):
        for document in [{"data": None}, {"data": {"_id": "session1", "merchantId": "someone-else", "paymentParams": {}}},
                         {"data": {"_id": "session1", "merchantId": "MID-TEST", "paymentParams": {"currency": "EGP"}}}]:
            with self.subTest(document=document), patch.object(provider, "_call", return_value=document) as call:
                with self.assertRaises(AuthError):
                    provider.abandon_session("session1")
                call.assert_called_once()

    def test_provider_reconciliation_rejects_amount_mismatch_and_requires_captured(self):
        order = self.reserve()
        data = {"data": {"sessionId": "session1", "merchantId": "MID-TEST", "merchantOrderId": order.order_number,
            "currency": "EGP", "amount": str(order.subtotal), "orderId": "provider1"}}
        with patch.object(provider, "_call", side_effect=[data, {"data": [{"merchantOrderId": order.order_number, "orderId": "provider1", "status": "AUTHORIZED"}]}]):
            self.assertEqual(provider.verify_order(order, "session1")["state"], "UNKNOWN")
        data["data"]["amount"] = "1.00"
        with patch.object(provider, "_call", return_value=data):
            with self.assertRaises(AuthError):
                provider.verify_order(order, "session1")

    def test_webhook_hmac_rejects_forgery_unsigned_critical_fields(self):
        data = {"merchantOrderId": "A", "kashierOrderId": "K", "amount": 55.5, "currency": "EGP", "status": "SUCCESS", "transactionId": "T"}
        keys = sorted(data)
        message = "&".join(f"{k}={quote(str(data[k]), safe='~-._')}" for k in keys)
        signature = hmac.new(b"sandbox-api-test", message.encode(), hashlib.sha256).hexdigest()
        data["signatureKeys"] = keys
        self.assertEqual(verify_webhook({"event": "pay", "data": data}, signature)["transactionId"], "T")
        for bad in ["0" * 64, ""]:
            with self.assertRaises(AuthError):
                verify_webhook({"data": data}, bad)
        data["signatureKeys"] = [k for k in keys if k != "amount"]
        with self.assertRaises(AuthError):
            verify_webhook({"data": data}, signature)
