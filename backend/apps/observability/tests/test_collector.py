from queue import Queue
from datetime import timedelta
import threading
from unittest.mock import patch

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, TransactionTestCase
from django.db import connections
from django.conf import settings
from django.utils import timezone

from apps.observability import collector, metrics
from apps.observability.middleware import TelemetryMiddleware
from apps.observability.models import HostState, Incident, MetricBucket
from apps.operations.models import ActivityEntry


class CollectorTests(SimpleTestCase):
    def test_shopping_response_and_outcome_do_not_wait_for_a_blocked_metric_sink(self):
        blocked, release = threading.Event(), threading.Event()
        queue = Queue(maxsize=4)
        def sink(item):
            blocked.set()
            release.wait(timeout=3)
        # A real consumer is deliberately blocked. Customer code can still
        # return, and a post-commit outcome can enqueue without awaiting it.
        with patch.object(collector, "_queue", queue), patch.object(collector, "_worker", None), patch.object(collector, "_persist", sink):
            collector.enqueue_metric("page_view", "hub", "other", 1)
            self.assertTrue(blocked.wait(timeout=1))
            try:
                response = TelemetryMiddleware(lambda request: HttpResponse("paid", status=200))(RequestFactory().post("/api/v1/hub/orders/checkout/"))
                metrics.record_outcome("payment.succeeded")
                self.assertEqual(response.content, b"paid")
                self.assertFalse(release.is_set())
                self.assertEqual(queue.qsize(), 2)
            finally:
                release.set()
                queue.join()
                queue.put(None)
                collector._worker.join(timeout=1)

    def test_full_collector_drops_metrics_without_waiting_or_growing(self):
        queue = Queue(maxsize=2)
        with patch.object(collector, "_queue", queue), patch.object(collector, "_ensure_worker"):
            for _ in range(100): collector.enqueue_metric("page_view", "hub", "other", 1)
        self.assertEqual(queue.qsize(), 2)

    def test_queued_samples_cannot_cross_database_configuration_lifecycles(self):
        item = ("metric", ("page_view", "hub", "other", 1, None), "a_previous_test_database")
        with patch.object(connections, "close_all") as close, patch("apps.observability.metrics.record_metric") as persist:
            collector._persist(item)
        persist.assert_not_called()
        close.assert_not_called()

    def test_background_marker_suppresses_only_scheduled_gets_and_never_changes_the_response(self):
        factory = RequestFactory()
        response = HttpResponse("authoritative-result", status=503)
        middleware = TelemetryMiddleware(lambda request: response)
        with patch("apps.observability.middleware.enqueue_metric") as metric, patch("apps.observability.middleware.enqueue_incident"):
            for path in ("hub/catalogue/products/", "hub/cart/", "hub/orders/", "hub/orders/terminals/"):
                self.assertIs(middleware(factory.get("/api/v1/" + path, HTTP_X_HAVE_BACKGROUND="1")), response)
            middleware(factory.get("/api/v1/auth/csrf/"))
            metric.assert_not_called()
            middleware(factory.get("/api/v1/hub/orders/"))
            self.assertEqual(metric.call_count, 2)
            middleware(factory.get("/api/v1/hub/orders/", HTTP_X_HAVE_BACKGROUND="2"))
            self.assertEqual(metric.call_count, 4)
            self.assertIs(middleware(factory.post("/api/v1/hub/orders/checkout/", HTTP_X_HAVE_BACKGROUND="1")), response)
            self.assertEqual(metric.call_count, 6)


class CollectorRetentionTests(TransactionTestCase):
    def test_backend_sink_enforces_retention_without_host_or_browser_and_throttles_housekeeping(self):
        self.assertTrue(collector.wait_for_idle(timeout=10))
        self.assertFalse(HostState.objects.exists())
        now = timezone.now()
        expired = MetricBucket.objects.create(minute=now - timedelta(days=8), metric="page_view", app="hub", route="other", unit="count")
        resolved = Incident.objects.create(code="old_resolved", summary="Generic failure", status="RESOLVED", resolved_at=now - timedelta(days=31))
        unresolved = Incident.objects.create(code="old_unresolved", summary="Generic failure", first_seen_at=now - timedelta(days=40))
        activity = ActivityEntry.objects.create(action="service.restart", target_type="service", target_id="advisor")
        item = ("metric", ("api_request_ms", "hub", "catalogue", 100, "ms"), str(settings.DATABASES["default"]["NAME"]))
        with patch.object(metrics, "_next_prune", 0), patch.object(metrics.time, "monotonic", return_value=1000) as clock, patch.object(metrics, "prune", wraps=metrics.prune) as housekeeping:
            collector._persist(item)
            collector._persist(item)
            self.assertEqual(housekeeping.call_count, 1)
            clock.return_value = 1061
            collector._persist(item)
            self.assertEqual(housekeeping.call_count, 2)
        self.assertFalse(MetricBucket.objects.filter(pk=expired.pk).exists())
        self.assertFalse(Incident.objects.filter(pk=resolved.pk).exists())
        self.assertTrue(Incident.objects.filter(pk=unresolved.pk).exists())
        self.assertTrue(ActivityEntry.objects.filter(pk=activity.pk).exists())
        self.assertEqual(MetricBucket.objects.get(metric="api_request_ms", app="hub", route="catalogue").count, 3)
