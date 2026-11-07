import hashlib
import json
import math
import time
from datetime import timedelta
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone
from apps.accounts.security.errors import AuthError
from apps.accounts.security.state import auth_key, get_redis_client

from .metrics import record_metric, prune_if_due, raise_incident, resolve_incident
from .models import HostState, ServiceActionJob

MANAGED = {"hub", "kiosk", "advisor", "order-worker"}
SERVICES = MANAGED | {"backend", "db", "redis", "admin"}
ACTIONS = {"start", "stop", "restart"}
STATES = {"running", "stopped", "exited", "restarting", "starting", "dead", "created", "not_found", "unknown"}


def activity(actor, action, target, outcome, metadata=None, target_type="service"):
    from apps.operations.audit import record_activity
    record_activity(actor=actor, action=action, target_type=target_type, target_id=target, outcome=outcome, metadata=metadata or {})


def host_snapshot():
    row = HostState.objects.filter(pk="local").first()
    fresh = bool(row and (timezone.now() - row.observed_at).total_seconds() < 20)
    return row, fresh


def service_rows():
    row, fresh = host_snapshot()
    known = {item["service"]: item for item in (row.payload.get("containers", []) if row else [])}
    result = []
    for name in sorted(SERVICES):
        item = known.get(name, {})
        state = item.get("state", "unknown") if fresh else "unknown"
        actions = (["stop", "restart"] if state == "running" else ["start"] if state in ("stopped", "exited", "created") else []) if name in MANAGED else []
        last_action = ServiceActionJob.objects.filter(service=name).order_by("-created_at").first()
        result.append({"service": name, "state": state, "health": item.get("health", "unknown") if fresh else "unknown", "observed_at": row.observed_at.isoformat() if row else None, "stale": not fresh, "manageable": name in MANAGED, "allowed_actions": actions, "last_action": job_data(last_action) if last_action else None})
    return result


def preview(service, action):
    if not isinstance(service, str) or not isinstance(action, str) or service not in SERVICES or action not in ACTIONS:
        raise AuthError("Unsupported service or action.", 400)
    current = next(item for item in service_rows() if item["service"] == service)
    reason = None
    if service not in MANAGED:
        reason = "This core service is protected."
    elif current["stale"]:
        reason = "The host agent is unavailable or its measurements are stale."
    elif action not in current["allowed_actions"]:
        reason = "The action is not available in the current service state."
    elif ServiceActionJob.objects.filter(service=service, status__in=["RUNNING", "UNKNOWN"]).exists():
        reason = "A previous action is still running or its outcome is uncertain. Wait for agent reconciliation."
    elif action != "start" and service == "order-worker":
        from .worker_state import snapshot
        if snapshot().get("state") not in {"running", "idle"}:
            reason = "Fresh worker progress is required before cooperative Stop or Restart."
    elif action != "start" and service == "kiosk":
        from apps.operations.services.kiosks import kiosk_service_blocker
        reason = kiosk_service_blocker()
    revision = hashlib.sha256(json.dumps([service, action, current["state"], current["health"], reason]).encode()).hexdigest()
    return {"service": service, "action": action, "eligible": reason is None, "blocking_reason": reason, "preview_revision": revision, "observed_at": timezone.now().isoformat()}


def job_data(job):
    return {"id": str(job.pk), "service": job.service, "action": job.action, "status": job.status, "result": job.result, "error": job.error, "created_at": job.created_at.isoformat(), "updated_at": job.updated_at.isoformat()}


def expire_jobs():
    now = timezone.now()
    with transaction.atomic():
        for job in ServiceActionJob.objects.select_for_update().select_related("actor").filter(status__in=["QUEUED", "RUNNING"]):
            if job.status == "QUEUED" and job.expires_at <= now:
                job.status, job.error = "FAILED", "The queued action expired before execution."
            elif job.status == "RUNNING" and job.claimed_at and job.claimed_at < now - timedelta(minutes=4):
                job.status, job.error = "UNKNOWN", "Execution outcome was not confirmed. Wait for host-agent reconciliation before another action."
                raise_incident("service_action_unknown", "A service action requires host-agent reconciliation.", "service_action", str(job.pk))
            else:
                continue
            job.save(update_fields=["status", "error", "updated_at"])
            activity(job.actor, "service." + job.action, job.service, job.status, {"job_id": str(job.pk), "reason_code": "execution_timeout" if job.status == "UNKNOWN" else "queue_expired"})


def create_job(*, actor, service, action, action_id, preview_revision):
    try:
        key = UUID(str(action_id))
    except (ValueError, TypeError):
        raise AuthError("A valid action ID is required.", 400) from None
    expire_jobs()
    existing = ServiceActionJob.objects.filter(pk=key).first()
    if existing:
        if existing.actor_id != actor.pk or existing.service != service or existing.action != action:
            raise AuthError("This action ID belongs to a different operation.", 409)
        return existing
    check = preview(service, action)
    if not check["eligible"]:
        raise AuthError(check["blocking_reason"], 409)
    if check["preview_revision"] != preview_revision:
        raise AuthError("Service state changed. Review the action again.", 409)
    try:
        with transaction.atomic():
            job = ServiceActionJob.objects.create(id=key, actor=actor, service=service, action=action, preview_revision=preview_revision, expires_at=timezone.now() + timedelta(seconds=30))
            activity(actor, "service." + action, service, "QUEUED", {"job_id": str(key)})
            return job
    except IntegrityError:
        existing = ServiceActionJob.objects.filter(pk=key).first()
        if existing and existing.actor_id == actor.pk and existing.service == service and existing.action == action:
            return existing
        raise AuthError("Another action is already pending for this service.", 409) from None


def claim_job():
    expire_jobs()
    with transaction.atomic():
        job = ServiceActionJob.objects.select_for_update(skip_locked=True).filter(status="QUEUED").select_related("actor").order_by("created_at").first()
        if not job:
            return None
        if job.service == "kiosk" and job.action in {"stop", "restart"}:
            # Session entry takes these same row locks before checking the job
            # guard. Either the live session wins and blocks this claim, or this
            # claim wins and prevents any new customer access.
            from apps.terminals.models import Terminal
            list(Terminal.objects.select_for_update().order_by("pk").values_list("pk", flat=True))
        check = preview(job.service, job.action)
        if not job.actor.is_active or not job.actor.is_staff or job.actor.account_type != "OWNER" or not check["eligible"] or check["preview_revision"] != job.preview_revision:
            job.status, job.error = "FAILED", "Action eligibility changed before execution."
            job.save(update_fields=["status", "error", "updated_at"])
            activity(job.actor, "service." + job.action, job.service, "FAILED", {"job_id": str(job.pk), "reason_code": "eligibility_changed"})
            return None
        job.status, job.claimed_at = "RUNNING", timezone.now()
        job.save(update_fields=["status", "claimed_at", "updated_at"])
        return job_data(job)


def unresolved_jobs():
    return [job_data(row) for row in ServiceActionJob.objects.filter(status__in=["RUNNING", "UNKNOWN"]).order_by("created_at")[:4]]


def finish_job(job_id, *, status, result_code):
    if not isinstance(status, str) or not isinstance(result_code, str) or status not in {"SUCCEEDED", "FAILED", "UNKNOWN"} or result_code not in {"confirmed", "docker_unavailable", "execution_failed", "outcome_unknown", "target_rejected"}:
        raise AuthError("Invalid action outcome.", 400)
    if (status == "SUCCEEDED") != (result_code == "confirmed") or status == "UNKNOWN" and result_code != "outcome_unknown":
        raise AuthError("Inconsistent action outcome.", 400)
    with transaction.atomic():
        job = ServiceActionJob.objects.select_for_update().select_related("actor").get(pk=job_id)
        if job.status not in {"RUNNING", "UNKNOWN"}:
            return job
        if job.status == status and job.result == {"code": result_code}:
            return job
        job.status, job.result = status, {"code": result_code}
        job.error = "" if status == "SUCCEEDED" else "Service action was not confirmed." if status == "UNKNOWN" else "Service action failed."
        job.save(update_fields=["status", "result", "error", "updated_at"])
        activity(job.actor, "service." + job.action, job.service, status, {"job_id": str(job.pk), "reason_code": result_code})
        if status == "UNKNOWN":
            raise_incident("service_action_unknown", "A service action requires host-agent reconciliation.", "service_action", str(job.pk))
        else:
            resolve_incident("service_action_unknown", "service_action", str(job.pk))
        return job


def _number(value, maximum=1e16, nullable=False):
    if value is None and nullable:
        return None
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum:
        raise AuthError("Invalid resource measurement.", 400)
    return value


def accept_heartbeat(data):
    if not isinstance(data, dict) or set(data) != {"host", "containers"}:
        raise AuthError("Invalid host measurement fields.", 400)
    host = data["host"]
    if not isinstance(host, dict) or set(host) != {"cpu_percent", "memory_percent", "memory_used_bytes", "memory_total_bytes"}:
        raise AuthError("Invalid host measurement fields.", 400)
    safe_host = {key: _number(value, 100 if key.endswith("percent") else 1e16, nullable=key == "cpu_percent") for key, value in host.items()}
    if safe_host["memory_used_bytes"] > safe_host["memory_total_bytes"]:
        raise AuthError("Invalid host memory measurement.", 400)
    containers = data["containers"]
    if not isinstance(containers, list) or len(containers) > len(SERVICES):
        raise AuthError("Invalid container measurements.", 400)
    safe, seen = [], set()
    for item in containers:
        if not isinstance(item, dict) or set(item) != {"service", "state", "health", "cpu_percent", "memory_bytes", "memory_limit_bytes"} or any(not isinstance(item[key], str) for key in ("service", "state", "health")) or item["service"] not in SERVICES or item["service"] in seen or item["state"] not in STATES or item["health"] not in {"healthy", "unhealthy", "starting", "unknown"}:
            raise AuthError("Invalid container measurement fields.", 400)
        seen.add(item["service"])
        safe.append({"service": item["service"], "state": item["state"], "health": item["health"], "cpu_percent": _number(item["cpu_percent"], 12800, True), "memory_bytes": _number(item["memory_bytes"], nullable=True), "memory_limit_bytes": _number(item["memory_limit_bytes"], nullable=True)})
    now = timezone.now()
    payload = {"timestamp": now.isoformat(), "host": safe_host, "containers": safe}
    HostState.objects.update_or_create(pk="local", defaults={"observed_at": now, "payload": payload})
    try:
        client = get_redis_client()
        key = auth_key("observability:resources")
        client.zadd(key, {json.dumps(payload, sort_keys=True): now.timestamp()})
        client.zremrangebyscore(key, "-inf", (now - timedelta(minutes=15)).timestamp())
        client.zremrangebyrank(key, 0, -181)
        client.expire(key, 1000)
    except Exception:
        pass
    for route, values in [("host", safe_host)] + [(item["service"], {"cpu_percent": item["cpu_percent"], "memory_used_bytes": item["memory_bytes"], "memory_total_bytes": item["memory_limit_bytes"]}) for item in safe]:
        for key, value in values.items():
            if value is not None:
                record_metric("resource." + key, "resources", route, value, "percent" if key.endswith("percent") else "bytes")
    # Housekeeping is independent of the financial worker.
    prune_if_due()
    from .reporting import capture_history
    try:
        capture_history()
    except Exception:
        # Observability never prevents resource ingestion or financial progress.
        pass
    return {"accepted": True, "observed_at": now.isoformat()}
