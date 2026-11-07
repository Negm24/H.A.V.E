"""Trading pauses gate new customer work without changing payment truth."""
from unittest.mock import patch

from django.test import TestCase, override_settings

from apps.accounts.security.errors import AuthError
from apps.orders.models import Order
from apps.payments.services import kashier_services as provider
from apps.payments.services.payment_services import reconcile, resume_checkout, start_checkout
from apps.payments.tests import test_payments as fixtures
from apps.terminals.models import Terminal


@override_settings(KASHIER_DEFAULT_TEST_KEY="sandbox-test", KASHIER_SECRET_KEY="sandbox-test",
                   KASHIER_MERCHANT_ID="MID-TEST", PAYMENTS_PUBLIC_BASE_URL="https://hub.example",
                   KIOSK_PUBLIC_BASE_URL="https://kiosk.example")
class AdminPaymentMaintenanceTests(TestCase):
    setUp = fixtures.PaymentTests.setUp
    reserve = fixtures.PaymentTests.reserve
    session = fixtures.PaymentTests.session

    def pause(self):
        Terminal.objects.filter(pk=self.terminal.pk).update(maintenance_enabled=True)

    def test_pause_prevents_provider_creation_after_reservation(self):
        order = self.reserve()
        self.pause()
        with patch.object(provider, "create_session") as create, self.assertRaises(AuthError):
            start_checkout(order)
        create.assert_not_called()
        self.assertFalse(order.payments.exists())

    def test_hub_resume_does_not_reopen_or_verify_a_paused_machine(self):
        order = self.reserve()
        capture, _ = self.session(order)
        deadline = order.expires_at
        self.pause()
        with patch.object(provider, "verify_order") as verify, self.assertRaises(AuthError):
            resume_checkout(order, user_id=self.user.pk, app="HUB")
        verify.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.expires_at, deadline)
        self.assertEqual(order.payments.count(), 1)
        self.assertEqual(order.payments.get().pk, capture.pk)

    def test_verified_payment_continues_during_pause_without_dispensing(self):
        order = self.reserve()
        capture, _ = self.session(order)
        self.pause()
        with patch.object(provider, "verify_order", return_value={"state": "PAID", "provider_reference": "verified-paused"}):
            reconcile(capture.pk)
        order.refresh_from_db()
        capture.refresh_from_db()
        self.assertEqual(capture.status, "SUCCEEDED")
        self.assertIsNotNone(order.paid_at)
        self.assertTrue(order.collection_required)
        deadline = order.collection_deadline
        self.assertEqual((deadline - order.paid_at).total_seconds(), 86400)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_on_hand, 12)
        Terminal.objects.filter(pk=self.terminal.pk).update(maintenance_enabled=False)
        order.refresh_from_db()
        self.assertEqual(order.collection_deadline, deadline)
        self.assertEqual(Order.objects.get(pk=order.pk).status, "PENDING")
