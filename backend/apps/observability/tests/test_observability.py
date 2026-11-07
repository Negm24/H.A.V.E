from copy import deepcopy
from datetime import timedelta
import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.db import transaction
from django.http import HttpResponse
from django.test import RequestFactory, TestCase, override_settings
from django.urls import include, path
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.security.errors import AuthError
from apps.accounts.security.state import auth_key
from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.tests.helpers import SessionFixtures
from apps.operations.models import ActivityEntry
from apps.terminals.services.maintenance import require_customer_access
from apps.observability import collector, metrics, services, worker_state
from apps.observability.api.urls import internal_urlpatterns, owner_urlpatterns, public_urlpatterns
from apps.observability.middleware import TelemetryMiddleware
from apps.observability.models import HostState, Incident, MetricBucket, ServiceActionJob

urlpatterns = [
    path("api/v1/owner/technical/", include(owner_urlpatterns)),
    path("api/v1/telemetry/", include(public_urlpatterns)),
    path("internal/host-agent/", include(internal_urlpatterns)),
]
TOKEN = "test-host-agent-token-" + "x" * 32
ORIGIN = "http://localhost:5174"


@override_settings(ROOT_URLCONF=__name__, MIDDLEWARE=[], PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], HOST_AGENT_TOKEN=TOKEN)
class ObservabilityTests(SessionFixtures, TestCase):
    def setUp(self):
        self.assertTrue(collector.wait_for_idle(timeout=10))
        self.setup_sessions()
        self.owner = create_owner_account(first_name="Technical", last_name="Owner", phone_number="01112345678", email="technical-owner@example.test", password="Orchid-River-Sample-4826!")
        self.admin = APIClient()
        self.admin.force_authenticate(self.owner)
        self.agent = APIClient()
        self.agent.credentials(HTTP_AUTHORIZATION="Bearer " + TOKEN)
        self.addCleanup(worker_state.STOP_REQUESTED.clear)

    def sample(self):
        return {"host": {"cpu_percent": 12.5, "memory_percent": 50, "memory_used_bytes": 500, "memory_total_bytes": 1000}, "containers": [{"service": name, "state": "running", "health": "healthy", "cpu_percent": 1.5, "memory_bytes": 100, "memory_limit_bytes": 1000} for name in sorted(services.SERVICES)]}

    def live_host(self):
        HostState.objects.update_or_create(pk="local", defaults={"observed_at": timezone.now(), "payload": self.sample()})

    def queue(self, service="advisor", action="restart", key=None):
        check = services.preview(service, action)
        return services.create_job(actor=self.owner, service=service, action=action, action_id=key or uuid4(), preview_revision=check["preview_revision"])

    def ingest(self, body):
        return self.client.post("/api/v1/telemetry/events/", body, format="json", HTTP_ORIGIN=ORIGIN)

    def test_metrics_are_anonymous_minute_aggregates_with_counts_extrema_and_distribution(self):
        now = timezone.now()
        with patch("apps.observability.metrics.timezone.now", return_value=now):
            for value in (80, 120, 900):
                metrics.record_metric("lcp_ms", "hub", "catalogue", value)
        row = MetricBucket.objects.get(metric="lcp_ms", app="hub", route="catalogue")
        self.assertEqual((row.count, row.total, row.minimum, row.maximum), (3, 1100, 80, 900))
        self.assertEqual(row.buckets, {"100": 1, "200": 1, "1000": 1})
        self.assertEqual(row.minute.second, 0)
        self.assertEqual(metrics.route_label("/orders/private-id?phone=01012345678"), "orders")
        for bad in (float("nan"), float("inf"), -1, True):
            with self.assertRaises(ValueError): metrics.record_metric("lcp_ms", "hub", "other", bad)

    def test_ingest_rejects_raw_text_identifiers_unbounded_and_wrong_typed_labels_before_storage(self):
        safe = {"app": "hub", "events": [{"metric": "page_view", "route": "catalogue", "value": 1}]}
        invalid = [safe | {"visitor_id": "customer-id"}, safe | {"app": {}}, safe | {"events": safe["events"] * 21}]
        for changes in ({"route": "/orders/private-id"}, {"metric": "typed-sensitive-input"}, {"value": True}, {"value": 2}, {"route": {}}, {"input": "personal symptoms"}):
            invalid.append(safe | {"events": [safe["events"][0] | changes]})
        for body in invalid:
            self.assertEqual(self.ingest(body).status_code, 400)
        self.assertFalse(MetricBucket.objects.filter(metric="page_view", app="hub", route="catalogue").exists())
        self.assertEqual(self.ingest(safe).status_code, 202)
        self.assertEqual(MetricBucket.objects.get(metric="page_view", app="hub", route="catalogue").total, 1)
        self.assertEqual(self.client.post("/api/v1/telemetry/events/", safe, format="json", HTTP_ORIGIN="https://foreign.example").status_code, 403)

    def test_ingest_failure_is_disposable_and_rate_budget_is_ephemeral_isolated(self):
        body = {"app": "hub", "events": [{"metric": "frontend_error", "route": "cart", "value": 1}]}
        with patch("apps.observability.api.views.get_redis_client", side_effect=RuntimeError("private transport error")):
            result = self.ingest(body)
        self.assertEqual(result.status_code, 202)
        self.assertFalse(result.json()["accepted"])
        self.assertEqual(self.ingest(body).status_code, 202)
        row = Incident.objects.get(code="frontend_error", target_id="hub:cart")
        self.assertEqual(row.target_id, "hub:cart")
        self.assertNotIn("private transport", row.summary)
        keys = list(self.redis.scan_iter(match=self.prefix + "*observability:ingest:*"))
        self.assertEqual(len(keys), 1)
        self.assertGreater(self.redis.ttl(keys[0]), 0)
        self.redis.set(keys[0], 120, ex=120)
        self.assertEqual(self.ingest(body).status_code, 429)

    def test_host_auth_is_distinct_and_requires_explicit_bearer_scheme(self):
        for header in ("", TOKEN, "Bearer wrong", "Basic " + TOKEN):
            result = self.client.post("/internal/host-agent/heartbeat/", self.sample(), format="json", HTTP_AUTHORIZATION=header)
            self.assertEqual(result.status_code, 401)
        self.assertEqual(self.agent.post("/internal/host-agent/heartbeat/", self.sample(), format="json").status_code, 200)
        self.assertEqual(self.admin.get("/api/v1/owner/technical/resources/").json()["freshness"], "live")

    def test_resource_storage_has_age_and_count_bounds_and_rejects_private_payloads(self):
        key = auth_key("observability:resources")
        old = timezone.now().timestamp() - 1000
        self.redis.zadd(key, {json.dumps({"old": True}): old})
        self.redis.zadd(key, {json.dumps({"sequence": n}): old + 200 + n for n in range(200)})
        services.accept_heartbeat(self.sample())
        self.assertEqual(self.redis.zcard(key), 180)
        self.assertIsNone(self.redis.zscore(key, json.dumps({"old": True})))
        self.assertGreater(self.redis.ttl(key), 0)
        self.assertTrue(MetricBucket.objects.filter(app="resources", route="host", metric="resource.cpu_percent").exists())
        bad = self.sample(); bad["containers"][0]["log"] = "private service output"
        with self.assertRaises(AuthError): services.accept_heartbeat(bad)
        self.assertNotIn("private", json.dumps(HostState.objects.get().payload))
        bad = self.sample(); bad["host"]["memory_used_bytes"] = 1001
        with self.assertRaises(AuthError): services.accept_heartbeat(bad)

    def test_missing_and_stale_resources_never_become_zero_measurements(self):
        data = self.admin.get("/api/v1/owner/technical/resources/").json()
        self.assertEqual((data["freshness"], data["observed_at"], data["samples"]), ("missing", None, []))
        self.live_host()
        HostState.objects.update(observed_at=timezone.now() - timedelta(seconds=25))
        self.assertFalse(services.preview("advisor", "restart")["eligible"])
        self.assertEqual(services.service_rows()[0]["state"], "unknown")
        self.assertEqual(self.admin.get("/api/v1/owner/technical/resources/").json()["freshness"], "stale")

    def test_owner_permissions_and_core_service_allowlist(self):
        self.assertEqual(self.client.get("/api/v1/owner/technical/services/").status_code, 403)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get("/api/v1/owner/technical/services/").status_code, 403)
        self.live_host()
        for core in ("backend", "db", "redis", "admin"):
            self.assertFalse(services.preview(core, "restart")["eligible"])
            with self.assertRaises(AuthError): self.queue(core)
        for value in ("docker", "advisor;echo secret"):
            with self.assertRaises(AuthError): services.preview(value, "restart")
        with self.assertRaises(AuthError): services.preview("advisor", {})

    def test_service_job_is_idempotent_claimed_once_and_uncertainty_blocks_replay(self):
        self.live_host()
        key = uuid4(); job = self.queue(key=key)
        self.assertEqual(self.queue(key=key).pk, job.pk)
        recovery = self.agent.post("/internal/host-agent/claim/", {"claim_new": False}, format="json")
        self.assertEqual(recovery.status_code, 200)
        self.assertIsNone(recovery.json()["job"])
        self.assertEqual(self.agent.post("/internal/host-agent/claim/", {"claim_new": "false"}, format="json").status_code, 400)
        job.refresh_from_db(); self.assertEqual(job.status, "QUEUED")
        claimed = services.claim_job()
        self.assertEqual(claimed["id"], str(job.pk))
        self.assertIsNone(services.claim_job())
        self.assertEqual(self.queue(key=key).pk, job.pk)
        services.finish_job(job.pk, status="UNKNOWN", result_code="outcome_unknown")
        self.assertFalse(services.preview("advisor", "restart")["eligible"])
        with self.assertRaises(AuthError): self.queue()
        services.finish_job(job.pk, status="SUCCEEDED", result_code="confirmed")
        self.assertTrue(services.preview("advisor", "restart")["eligible"])
        self.assertEqual(Incident.objects.get(code="service_action_unknown", target_id=str(job.pk)).status, "RESOLVED")
        self.assertEqual(ActivityEntry.objects.filter(target_type="service").count(), 3)

    def test_stale_revision_expired_jobs_and_changed_eligibility_do_not_execute(self):
        self.live_host()
        with self.assertRaises(AuthError):
            services.create_job(actor=self.owner, service="advisor", action="restart", action_id=uuid4(), preview_revision="old")
        job = self.queue()
        ServiceActionJob.objects.filter(pk=job.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertIsNone(services.claim_job()); job.refresh_from_db()
        self.assertEqual(job.status, "FAILED")
        job = self.queue()
        row = HostState.objects.get(); row.payload["containers"] = []; row.save()
        self.assertIsNone(services.claim_job()); job.refresh_from_db()
        self.assertEqual(job.status, "FAILED")

    def test_kiosk_claim_rechecks_session_and_holds_new_access_until_proven_outcome(self):
        self.live_host()
        job = self.queue("kiosk")
        self.assertEqual(services.claim_job()["id"], str(job.pk))
        with transaction.atomic():
            with self.assertRaises(AuthError): require_customer_access(self.terminal)
        services.finish_job(job.pk, status="UNKNOWN", result_code="outcome_unknown")
        with self.assertRaises(AuthError): require_customer_access(self.terminal)
        services.finish_job(job.pk, status="SUCCEEDED", result_code="confirmed")
        require_customer_access(self.terminal)
        self.queue("kiosk")
        # A customer session that wins before claim must prevent the control.
        from apps.terminals.security.state import session_key
        import time
        self.redis.set(session_key(self.terminal.pk), json.dumps({"credential_hash": self.terminal.device_credential_hash, "started_at": time.time(), "last_activity_at": time.time()}), ex=600)
        self.assertIsNone(services.claim_job())
        self.assertEqual(ServiceActionJob.objects.order_by("created_at").last().status, "FAILED")

    def test_worker_observations_distinguish_heartbeat_progress_completion_and_quiesce(self):
        self.assertIsNone(worker_state.snapshot()["last_heartbeat_at"])
        worker_state.heartbeat(); worker_state.progress(counts={"reconciled": 2}, completed=True, state="idle")
        data = worker_state.snapshot()
        self.assertEqual(data["counts"], {"reconciled": 2})
        self.assertIsNotNone(data["last_heartbeat_at"])
        self.assertIsNotNone(data["last_completed_at"])
        self.live_host()
        self.assertTrue(services.preview("order-worker", "stop")["eligible"])
        self.redis.hset(auth_key(worker_state.KEY), "last_progress_at", (timezone.now() - timedelta(seconds=100)).isoformat())
        self.assertEqual(worker_state.snapshot()["state"], "stale")
        self.assertFalse(services.preview("order-worker", "stop")["eligible"])
        worker_state.request_stop()
        with self.assertRaises(worker_state.WorkerQuiescing): worker_state.check_stop()

    def test_retention_preserves_unresolved_incidents_and_durable_activity(self):
        now = timezone.now()
        old_metric = MetricBucket.objects.create(minute=now - timedelta(days=8), metric="page_view", app="hub", route="other", unit="count")
        old = metrics.raise_incident("old_failure", "Generic failure")
        Incident.objects.filter(pk=old.pk).update(first_seen_at=now - timedelta(days=40), last_seen_at=now - timedelta(days=40))
        resolved = metrics.raise_incident("resolved_failure", "Generic failure")
        Incident.objects.filter(pk=resolved.pk).update(status="RESOLVED", resolved_at=now - timedelta(days=31))
        ActivityEntry.objects.create(actor=self.owner, action="service.restart", target_type="service", target_id="advisor")
        metrics.prune()
        self.assertFalse(MetricBucket.objects.filter(pk=old_metric.pk).exists())
        self.assertTrue(Incident.objects.filter(pk=old.pk).exists())
        self.assertFalse(Incident.objects.filter(pk=resolved.pk).exists())
        self.assertEqual(ActivityEntry.objects.count(), 1)

    def test_routine_polls_do_not_create_latency_or_error_samples_and_instrumentation_cannot_break_api(self):
        factory = RequestFactory()
        middleware = TelemetryMiddleware(lambda request: HttpResponse(status=500))
        paths = ["terminals/availability/", "terminals/heartbeat/", "hub/cart/version/", "auth/customers/hub/me/", "owner/session/", "auth/customers/terminal/qr-login/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/", "owner/technical/summary/", "telemetry/events/"]
        with patch("apps.observability.middleware.enqueue_metric") as metric, patch("apps.observability.middleware.enqueue_incident") as incident:
            for path in paths: self.assertEqual(middleware(factory.get("/api/v1/" + path)).status_code, 500)
            metric.assert_not_called()
            middleware(factory.get("/api/v1/hub/orders/private-id/?phone=secret"))
            self.assertEqual(metric.call_args.args[:3], ("api_server_error", "hub", "orders"))
            self.assertNotIn("secret", str(incident.call_args))
        with patch("apps.observability.middleware.enqueue_metric", side_effect=RuntimeError("telemetry failed")):
            self.assertEqual(middleware(factory.get("/api/v1/hub/orders/")).status_code, 500)
