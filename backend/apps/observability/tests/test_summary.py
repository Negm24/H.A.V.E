from datetime import timedelta
import json
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.observability.models import MetricBucket
from apps.operations.tests.helpers import OperationsFixtures
from apps.orders.models import Receipt
from apps.payments.models import PaymentTransaction


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class TechnicalSummaryTests(OperationsFixtures, TestCase):
    def setUp(self):
        self.setup_operations()

    def test_backlog_distinguishes_due_leased_failed_and_deferred_work_without_error_contents(self):
        now = timezone.now()
        order = self.reserve()
        payment = PaymentTransaction.objects.create(order=order, operation="CAPTURE", amount=order.customer_payable_amount,
            status="UNKNOWN", idempotency_key=uuid4().hex, next_attempt_at=now - timedelta(minutes=1),
            lease_until=now + timedelta(minutes=1), attempts=2, last_error="Private provider response is never returned")
        PaymentTransaction.objects.create(order=order, operation="REFUND", amount=0, status="FAILED", idempotency_key=uuid4().hex)
        receipt = Receipt.objects.create(order=order, receipt_snapshot={}, email_attempts=2,
            last_email_error="Private recipient address is never returned", next_email_at=now + timedelta(minutes=1))
        data = self.admin.get("/api/v1/owner/technical/summary/").json()
        self.assertEqual(data["backlog"]["details"]["payments"]["pending"], 1)
        self.assertEqual(data["backlog"]["details"]["payments"]["due"], 0)
        self.assertEqual(data["backlog"]["details"]["payments"]["unknown"], 1)
        self.assertEqual(data["backlog"]["details"]["payments"]["retrying"], 1)
        self.assertIsNotNone(data["backlog"]["details"]["payments"]["oldest_pending_at"])
        self.assertEqual(data["backlog"]["details"]["refunds"]["failed"], 1)
        self.assertEqual(data["backlog"]["refunds"], 1)
        self.assertEqual(data["backlog"]["details"]["receipts"]["due"], 0)
        self.assertEqual(data["backlog"]["details"]["receipts"]["failed"], 1)
        self.assertIsNone(data["worker"]["last_heartbeat_at"])
        self.assertIsNone(data["backlog"]["details"]["refunds"]["oldest_pending_at"])
        self.assertNotIn("Private", json.dumps(data))
        self.assertNotIn(self.user.email, json.dumps(data))
        PaymentTransaction.objects.filter(pk=payment.pk).update(lease_until=None)
        Receipt.objects.filter(pk=receipt.pk).update(next_email_at=now - timedelta(minutes=1))
        data = self.admin.get("/api/v1/owner/technical/summary/").json()
        self.assertEqual(data["backlog"]["details"]["payments"]["due"], 1)
        self.assertEqual(data["backlog"]["details"]["receipts"]["due"], 1)

    def test_empty_metrics_are_missing_observations_and_bounded_results_disclose_truncation(self):
        path = "/api/v1/owner/technical/metrics/?window_minutes=10080&metric=page_view"
        self.assertEqual(self.admin.get(path).json()["items"], [])
        now = timezone.now().replace(second=0, microsecond=0)
        MetricBucket.objects.bulk_create([MetricBucket(minute=now - timedelta(minutes=i), metric="page_view", app="hub", route="catalogue", unit="count", count=1, total=1, minimum=1, maximum=1, buckets={"samples": 1}) for i in range(5001)])
        data = self.admin.get(path).json()
        self.assertEqual(len(data["items"]), 5000)
        self.assertTrue(data["truncated"])
        self.assertEqual(data["items"][0]["count"], 1)
        self.assertEqual(data["items"][0]["unit"], "count")
