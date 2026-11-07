"""Read models and producer-owned, bounded operational history."""
from collections import defaultdict
from datetime import timedelta
import math
from urllib.parse import urlencode

from django.db.models import Min, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.accounts.security.errors import AuthError
from .models import Incident, MetricBucket, Observation, ServiceActionJob


def window(value, default=60, at=None):
    try:
        minutes = int(value or default)
    except (ValueError, TypeError):
        raise AuthError("Invalid time window.", 400) from None
    if not 1 <= minutes <= 10080:
        raise AuthError("Time window must be between 1 and 10080 minutes.", 400)
    until = timezone.now()
    if at:
        try:
            parsed = parse_datetime(at)
        except ValueError:
            parsed = None
        if parsed is None or timezone.is_naive(parsed) or parsed > until or parsed < until - timedelta(days=7):
            raise AuthError("Observation time must be a timezone-aware timestamp within retained history.", 400)
        until = parsed
    return until - timedelta(minutes=minutes), until


def percentile(rows, fraction):
    """Merge disjoint histogram intervals without claiming exact raw values."""
    counts = defaultdict(int)
    total = 0
    unit = None
    for row in rows:
        unit = row.unit
        total += row.count
        for bound, count in row.buckets.items():
            counts[bound] += count
    result = {"count": total, "lower": None, "upper": None, "unit": unit, "estimated": True}
    if not total:
        return result
    rank, seen, lower = math.ceil(total * fraction), 0, 0
    from .metrics import BOUNDS
    limits = BOUNDS if unit == "ms" else (0.1, 0.25, 0.5, 1, 5, 10)
    for bound in [str(value) for value in limits] + ["overflow"]:
        seen += counts.get(bound, 0)
        if seen >= rank:
            return result | {"lower": lower, "upper": None if bound == "overflow" else float(bound)}
        if bound != "overflow":
            lower = float(bound)
    return result


def coverage(since, until, rows):
    first = rows.aggregate(value=Min("minute"))["value"]
    return {"first_observed_at": first.isoformat() if first else None, "retention_days": 7,
            "from": since.isoformat(), "to": until.isoformat(), "gaps_are_missing_observations": True}


def backlog_snapshot():
    from apps.orders.models import Order, Receipt
    from apps.payments.models import PaymentTransaction
    now = timezone.now()
    payments = PaymentTransaction.objects.filter(status__in=["PENDING", "UNKNOWN"], next_attempt_at__lte=now).filter(Q(lease_until__isnull=True) | Q(lease_until__lte=now))
    receipts = Receipt.objects.filter(email_sent_at__isnull=True).filter(Q(next_email_at__isnull=True) | Q(next_email_at__lte=now))
    candidates = [payments.aggregate(value=Min("next_attempt_at"))["value"], receipts.aggregate(value=Min("next_email_at"))["value"]]
    # A receipt without an explicit retry time is due from its issuance.
    candidates.append(receipts.filter(next_email_at__isnull=True).aggregate(value=Min("issued_at"))["value"])
    due_count = payments.count() + receipts.count()
    for kind in ("expiry", "refund"):
        notices = Order.objects.filter(**{kind + "_email_sent_at__isnull": True})
        notices = notices.filter(status="CANCELLED", cancellation_reason="COLLECTION_EXPIRED", paid_at__isnull=False) if kind == "expiry" else notices.filter(total_refunded__gt=0)
        notices = notices.filter(Q(**{kind + "_email_next_attempt_at__isnull": True}) | Q(**{kind + "_email_next_attempt_at__lte": now})).filter(Q(**{kind + "_email_lease_until__isnull": True}) | Q(**{kind + "_email_lease_until__lte": now}))
        due_count += notices.count()
        candidates.extend([notices.aggregate(value=Min(kind + "_email_next_attempt_at"))["value"], notices.filter(**{kind + "_email_next_attempt_at__isnull": True}).aggregate(value=Min("cancelled_at" if kind == "expiry" else "created_at"))["value"]])
    oldest = min((value for value in candidates if value), default=None)
    return {"due": due_count, "oldest_due_at": oldest.isoformat() if oldest else None,
            "oldest_due_seconds": max(0, (now - oldest).total_seconds()) if oldest else None}


def capture_history():
    """Called by host ingestion. At most one sample per source per minute."""
    from . import services, worker_state
    from apps.terminals.models import Terminal
    from apps.accounts.security.state import get_redis_client
    from apps.terminals.services.heartbeat import heartbeat_key
    from apps.terminals.services.maintenance import live_session
    now = timezone.now()
    minute = now.replace(second=0, microsecond=0)
    if Observation.objects.filter(minute=minute, kind="service").exists():
        return
    worker, backlog = worker_state.snapshot(), backlog_snapshot()
    for item in services.service_rows():
        if item["service"] == "order-worker":
            item.update(worker=worker, backlog=backlog)
        Observation.objects.get_or_create(minute=minute, kind="service", target=item["service"], defaults={"payload": item})
    terminals = list(Terminal.objects.order_by("pk"))
    try:
        heartbeats = get_redis_client().mget([heartbeat_key(terminal.pk) for terminal in terminals]) if terminals else []
        heartbeat_available = True
    except Exception:
        heartbeats, heartbeat_available = [None] * len(terminals), False
    for terminal, seen in zip(terminals, heartbeats):
        if isinstance(seen, bytes):
            seen = seen.decode()
        stamp = parse_datetime(seen) if seen else None
        state = ("Online" if stamp and (now - stamp).total_seconds() <= 45 else "Last seen" if stamp else "No report yet") if heartbeat_available else "Unknown"
        payload = {"observed_at": now.isoformat(), "last_seen_at": seen, "state": state, "session_active": live_session(terminal),
                   "maintenance": terminal.maintenance_enabled, "disabled": terminal.is_disabled}
        Observation.objects.get_or_create(minute=minute, kind="machine", target=terminal.pk, defaults={"payload": payload})


def history_data(since, until, service=None, machine=None, kind="service"):
    rows = Observation.objects.filter(minute__gte=since, minute__lte=until, kind="machine" if machine or kind == "machine" else "service").order_by("minute", "target")
    if service or machine:
        rows = rows.filter(target=machine or service)
    # Seven-day range can contain many services. Bucket into <=240 time slots per target.
    step = max(60, math.ceil((until - since).total_seconds() / 240 / 60) * 60)
    grouped = {}
    previous = {}
    for row in rows:
        group = (row.target, int(row.minute.timestamp()) // step)
        prior = previous.get(row.target)
        gap = bool(prior and (row.minute - prior).total_seconds() > 90)
        gap = gap or grouped.get(group, {}).get("gap_before", False)
        grouped[group] = {"minute": row.minute.isoformat(), "service": row.target, **row.payload,
                          "interval_seconds": step, "gap_before": gap}
        previous[row.target] = row.minute
    return {"observed_at": until.isoformat(), "range": {"from": since.isoformat(), "to": until.isoformat()},
            "items": list(grouped.values()), "coverage": coverage(since, until, rows), "sampling_interval_seconds": step}


def usage_data(since, until, app=None, feature=None):
    from .metrics import APPS, FEATURES
    if app and app not in APPS:
        raise AuthError("Unknown app.", 400)
    if feature and feature not in FEATURES:
        raise AuthError("Unknown feature.", 400)
    duration = until - since
    rows = MetricBucket.objects.filter(minute__gte=since - duration, minute__lte=until, metric__startswith="feature.")
    if app:
        rows = rows.filter(app=app)
    current = rows.filter(minute__gte=since)
    previous = rows.filter(minute__lt=since)
    current_counts = {row["metric"]: row["value"] for row in current.values("metric").annotate(value=Sum("count"))}
    previous_counts = {row["metric"]: row["value"] for row in previous.values("metric").annotate(value=Sum("count"))}
    baseline = Observation.objects.filter(kind="service", target="backend", minute__gte=since - duration, minute__lt=since)
    required_minutes = max(1, math.floor(duration.total_seconds() / 60) - 1)
    comparison_covered = baseline.count() >= required_minutes
    items = []
    for name in sorted(FEATURES):
        key = "feature." + name
        count, before = current_counts.get(key, 0), previous_counts.get(key, 0)
        items.append({"feature": name, "count": count, "previous_count": before,
                      "change_percent": round((count - before) / before * 100, 2) if before and comparison_covered else None})
    items.sort(key=lambda item: (-item["count"], item["feature"]))
    series_rows = current.filter(metric="feature." + feature) if feature else current
    step = max(60, math.ceil(duration.total_seconds() / 120 / 60) * 60)
    groups = defaultdict(int)
    for row in series_rows:
        stamp = int(row.minute.timestamp()) // step * step
        groups[(stamp, row.app, row.metric.removeprefix("feature."))] += row.count
    series = [{"minute": timezone.datetime.fromtimestamp(stamp, tz=timezone.get_current_timezone()).isoformat(), "app": name, "feature": key, "count": count} for (stamp, name, key), count in sorted(groups.items())]
    return {"observed_at": until.isoformat(), "range": {"from": since.isoformat(), "to": until.isoformat()},
            "items": items, "series": series, "coverage": coverage(since, until, rows), "comparison_covered": comparison_covered, "counts_are": "anonymous feature events"}


def system_data(since, until):
    from . import services
    row, fresh = services.host_snapshot()
    metrics = MetricBucket.objects.filter(minute__gte=since, minute__lte=until)
    api_rows = list(metrics.filter(metric="api_request_ms"))
    grouped = defaultdict(list)
    # Bound API trend to 120 points and preserve absent intervals as gaps.
    step = max(60, math.ceil((until - since).total_seconds() / 120 / 60) * 60)
    for metric in api_rows:
        grouped[int(metric.minute.timestamp()) // step * step].append(metric)
    series = [{"minute": timezone.datetime.fromtimestamp(stamp, tz=timezone.get_current_timezone()).isoformat(), "p95": percentile(values, .95)} for stamp, values in sorted(grouped.items())]
    experience = []
    readings = defaultdict(list)
    for metric in metrics.filter(metric__in=["lcp_ms", "inp_ms", "cls", "screen_load_ms"]):
        readings[(metric.app, metric.metric)].append(metric)
    for (app, name), values in sorted(readings.items()):
        measured = percentile(values, .75)
        experience.append({"app": app, "metric": name, "count": measured["count"], "p75": measured})
    return {"observed_at": until.isoformat(), "range": {"from": since.isoformat(), "to": until.isoformat()},
            "api": {"p95": percentile(api_rows, .95), "series": series, "sampling_interval_seconds": step}, "experience": experience,
            "services": services.service_rows(), "history": history_data(since, until)["items"],
            "host": row.payload.get("host") if row else None, "containers": row.payload.get("containers", []) if row else [],
            "resources_observed_at": row.observed_at.isoformat() if row else None,
            "freshness": "live" if fresh else "stale" if row else "missing", "coverage": coverage(since, until, metrics)}


def incident_details(row):
    where = {"service": None, "app": None, "screen": None}
    destination = None
    if row.target_type == "app":
        app, _, screen = row.target_id.partition(":")
        where.update(service=app, app=app, screen=screen or None)
        filters = {"tab": "health", "service": app}
        retained = row.last_seen_at >= timezone.now() - timedelta(days=7)
        if retained:
            filters["at"] = row.last_seen_at.isoformat()
        destination = {"label": "Inspect application health" if retained else "Inspect current application health", "href": "/technical?" + urlencode(filters)}
    elif row.target_type == "service_action":
        job = ServiceActionJob.objects.filter(pk=row.target_id).first()
        where["service"] = job.service if job else None
        destination = {"label": "View original service action", "href": "/technical?" + urlencode({"tab": "service-controls", "job": row.target_id})}
    trigger, impact = {
        "frontend_error": ("The browser reported an application error on this screen.", "A screen reported errors. Whether a purchase was prevented has not been established."),
        "service_action_unknown": ("The host agent did not confirm the service action outcome.", "The service action outcome is unconfirmed. Inspect the existing action before attempting another."),
    }.get(row.code, (row.summary, "Impact has not been established from retained observations."))
    occurrence_rows = Observation.objects.filter(kind="incident", target=str(row.pk)).order_by("minute")
    totals = defaultdict(int)
    span = min(7 * 86400, max(60, (row.last_seen_at - row.first_seen_at).total_seconds()))
    interval = max(60, math.ceil(span / 240 / 60) * 60)
    for item in occurrence_rows:
        stamp = int(item.minute.timestamp()) // interval * interval
        totals[stamp] += item.payload.get("count", 0)
    timeline = [{"minute": timezone.datetime.fromtimestamp(stamp, tz=timezone.get_current_timezone()).isoformat(), "count": count} for stamp, count in sorted(totals.items())]
    return {"id": str(row.pk), "code": row.code, "severity": row.severity, "status": row.status, "summary": row.summary,
            "target_type": row.target_type, "target_id": row.target_id, "first_seen_at": row.first_seen_at.isoformat(),
            "last_seen_at": row.last_seen_at.isoformat(), "occurrences": row.occurrences, "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
            "where": where, "trigger": trigger, "impact": impact, "cause": "Cause not established", "destination": destination, "timeline": timeline,
            "timeline_retention_days": 7}
