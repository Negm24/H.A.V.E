"""Bounded, anonymous metrics. Values never contain request bodies or URLs."""
import math
import time
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import Incident, MetricBucket, Observation

APPS = {"hub", "kiosk", "advisor", "admin"}
ROUTES = {"login", "signup", "recovery", "qr", "dashboard", "profile", "catalogue", "cart", "checkout", "orders", "technical", "other"}
FEATURES = {"browse", "search", "cart", "qr_login", "checkout_start", "order_history", "login_success", "collection"}
METRICS = {"page_view": "count", "screen_load_ms": "ms", "lcp_ms": "ms", "inp_ms": "ms", "cls": "score", "frontend_error": "count", "api_error": "count", "client_timeout": "count", "client_request_ms": "ms"} | {"feature." + name: "count" for name in FEATURES}
BACKEND_METRICS = {"api_request_ms", "api_server_error", "api_client_rejection", "provider_timeout"}
OUTCOMES = {"order.completed", "order.collected", "order.collection_expired", "order.cancelled", "payment.succeeded", "payment.failed", "refund.succeeded", "receipt.delivered"}
RESOURCE_METRICS = {"resource." + key for key in ("cpu_percent", "memory_percent", "memory_used_bytes", "memory_total_bytes")}
BOUNDS = (50, 100, 200, 500, 1000, 2500, 5000, 10000, 30000, 120000)
_next_prune = 0


def route_label(path):
    path = path.split("?", 1)[0].lower()
    for match, label in (("qr-login", "qr"), ("terminal-login", "qr"), ("password-reset", "recovery"), ("pin-reset", "recovery"), ("forgot", "recovery"), ("signup", "signup"), ("login", "login"), ("checkout", "checkout"), ("cart", "cart"), ("catalogue", "catalogue"), ("browse", "catalogue"), ("orders", "orders"), ("profile", "profile"), ("dashboard", "dashboard"), ("technical", "technical")):
        if match in path:
            return label
    return "other"


def app_label(path):
    return "kiosk" if "/terminals/" in path or "/terminal/" in path else "advisor" if "/doctors/" in path else "admin" if "/owners/" in path or "/owner/" in path else "hub"


def record_metric(metric, app, route, value, unit=None):
    if type(value) not in (float, int) or not math.isfinite(value) or value < 0:
        raise ValueError("Invalid metric value.")
    unit = unit or METRICS.get(metric, "count")
    minute = timezone.now().replace(second=0, microsecond=0)
    with transaction.atomic():
        row, _ = MetricBucket.objects.get_or_create(minute=minute, metric=metric, app=app, route=route, defaults={"unit": unit})
        row = MetricBucket.objects.select_for_update().get(pk=row.pk)
        row.minimum = min(row.minimum, value) if row.count else value
        row.maximum = max(row.maximum, value) if row.count else value
        row.count += 1
        row.total += value
        bounds = BOUNDS if unit == "ms" else (0.1, 0.25, 0.5, 1, 5, 10) if unit == "score" else None
        bucket = str(next((n for n in bounds if value <= n), "overflow")) if bounds else "samples"
        row.buckets[bucket] = row.buckets.get(bucket, 0) + 1
        row.save(update_fields=["count", "total", "minimum", "maximum", "buckets"])


def raise_incident(code, summary, target_type="app", target_id="", severity="ERROR"):
    with transaction.atomic():
        row, created = Incident.objects.get_or_create(code=code, target_type=target_type, target_id=target_id, defaults={"summary": summary, "severity": severity})
        if not created:
            row = Incident.objects.select_for_update().get(pk=row.pk)
            row.occurrences += 1
            row.last_seen_at = timezone.now()
            if row.status == "RESOLVED":
                row.status, row.resolved_at = "OPEN", None
            row.save(update_fields=["occurrences", "last_seen_at", "status", "resolved_at"])
        minute = timezone.now().replace(second=0, microsecond=0)
        occurrence, _ = Observation.objects.get_or_create(minute=minute, kind="incident", target=str(row.pk))
        occurrence = Observation.objects.select_for_update().get(pk=occurrence.pk)
        occurrence.payload = {"count": occurrence.payload.get("count", 0) + 1}
        occurrence.save(update_fields=["payload"])
    return row


def resolve_incident(code, target_type="app", target_id=""):
    Incident.objects.filter(code=code, target_type=target_type, target_id=target_id).exclude(status="RESOLVED").update(status="RESOLVED", resolved_at=timezone.now())


def prune():
    MetricBucket.objects.filter(minute__lt=timezone.now() - timedelta(days=7)).delete()
    Incident.objects.filter(status="RESOLVED", resolved_at__lt=timezone.now() - timedelta(days=30)).delete()
    Observation.objects.filter(minute__lt=timezone.now() - timedelta(days=7)).delete()


def prune_if_due():
    global _next_prune
    now = time.monotonic()
    if now < _next_prune:
        return
    _next_prune = now + 60
    try:
        prune()
    except Exception:
        pass


def record_outcome(name):
    """Only authoritative domain services call this after committed outcomes."""
    if name not in OUTCOMES:
        raise ValueError("Unsupported outcome metric.")
    try:
        from .collector import enqueue_metric
        enqueue_metric(name, "backend", "orders", 1)
    except Exception:
        pass


def record_provider_timeout():
    """Called only for a recognised transport timeout; never accepts error text."""
    try:
        from .collector import enqueue_metric
        enqueue_metric("provider_timeout", "backend", "checkout", 1)
    except Exception:
        pass
