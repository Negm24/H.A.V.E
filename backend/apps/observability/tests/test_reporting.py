from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.tests.helpers import SessionFixtures
from apps.observability import metrics, reporting, services
from apps.observability.models import Incident, MetricBucket, Observation


@override_settings(MIDDLEWARE=[], PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ReportingTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.owner = create_owner_account(first_name="Metrics", last_name="Owner", phone_number="01112345678", email="metrics-owner@example.test", password="Orchid-River-Sample-4826!")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def test_merged_percentiles_use_weighted_counts_and_overflow_is_explicit(self):
        rows = [SimpleNamespace(count=2, unit="ms", buckets={"100": 1, "200": 1}), SimpleNamespace(count=18, unit="ms", buckets={"500": 17, "overflow": 1})]
        self.assertEqual(reporting.percentile(rows, .75), {"count": 20, "lower": 200.0, "upper": 500.0, "unit": "ms", "estimated": True})
        self.assertIsNone(reporting.percentile(rows, 1)["upper"])
        self.assertIsNone(reporting.percentile([], .95)["lower"])

    def test_usage_event_comparison_and_series_are_aggregated_without_unique_user_claims(self):
        now = timezone.now()
        Observation.objects.bulk_create([Observation(minute=(now - timedelta(minutes=index)).replace(second=0, microsecond=0), kind="service", target="backend") for index in range(61, 121)])
        for minute, count in [(now - timedelta(minutes=5), 4), (now - timedelta(minutes=65), 2)]:
            MetricBucket.objects.create(minute=minute, metric="feature.search", app="hub", route="catalogue", unit="count", count=count, total=count)
        data = reporting.usage_data(now - timedelta(hours=1), now, app="hub", feature="search")
        item = next(row for row in data["items"] if row["feature"] == "search")
        self.assertEqual((item["count"], item["previous_count"], item["change_percent"]), (4, 2, 100))
        self.assertEqual(sum(row["count"] for row in data["series"]), 4)
        self.assertIsNone(next(row for row in data["items"] if row["feature"] == "browse")["change_percent"])

    def test_history_is_collected_by_producer_once_per_minute_and_retains_observation_gaps(self):
        sample = {"service": "hub", "state": "running", "health": "unknown", "observed_at": timezone.now().isoformat()}
        with patch.object(services, "service_rows", return_value=[sample]):
            reporting.capture_history()
            reporting.capture_history()
        self.assertEqual(Observation.objects.filter(kind="service", target="hub").count(), 1)
        now = timezone.now()
        data = reporting.history_data(now - timedelta(minutes=60), now, service="hub")
        self.assertEqual(len(data["items"]), 1)
        self.assertTrue(data["coverage"]["gaps_are_missing_observations"])
        old = Observation.objects.create(minute=now - timedelta(days=8), kind="service", target="hub")
        metrics.prune()
        self.assertFalse(Observation.objects.filter(pk=old.pk).exists())

    def test_incidents_retain_trigger_screen_and_count_timeline_without_inventing_cause(self):
        incident = metrics.raise_incident("frontend_error", "A frontend operation failed.", "app", "hub:cart")
        metrics.raise_incident("frontend_error", "A frontend operation failed.", "app", "hub:cart")
        incident.refresh_from_db()
        data = reporting.incident_details(incident)
        self.assertEqual(data["where"]["screen"], "cart")
        self.assertEqual(data["cause"], "Cause not established")
        self.assertEqual(sum(item["count"] for item in data["timeline"]), 2)
        self.assertIn("service=hub", data["destination"]["href"])

    def test_owner_endpoints_return_real_data_and_deny_other_roles(self):
        for path in ["system/?window_minutes=60", "history/?window_minutes=60", "usage/?app=hub&feature=search"]:
            response = self.client.get("/api/v1/owner/technical/" + path)
            self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.get("/api/v1/owner/technical/history/?service=arbitrary").status_code, 400)
        self.assertEqual(self.client.get("/api/v1/owner/technical/history/?at=2026-13-32T00:00:00Z").status_code, 400)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get("/api/v1/owner/technical/system/").status_code, [401, 403])
