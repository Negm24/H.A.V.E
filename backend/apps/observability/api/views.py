import hashlib
import json
import secrets
import time
from datetime import timedelta
from types import SimpleNamespace

from django.conf import settings
from django.db import connection
from django.db.models import Min, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.authentication import BaseAuthentication, SessionAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.accounts.api.views.shared_views import CustomerSessionView
from apps.accounts.security.errors import AuthError
from apps.accounts.security.permissions import IsOwner
from apps.accounts.security.state import auth_key, get_redis_client
from apps.orders.models import Receipt, Order
from apps.payments.models import PaymentTransaction
from .. import services, worker_state
from ..metrics import APPS, BACKEND_METRICS, METRICS, OUTCOMES, RESOURCE_METRICS, ROUTES, record_metric, raise_incident, prune_if_due
from ..models import Incident, MetricBucket, ServiceActionJob
from .. import reporting

OUTPUT = inline_serializer(name="TechnicalResponse", fields={"observed_at": serializers.DateTimeField(required=False), "items": serializers.ListField(child=serializers.DictField(), required=False)})
INPUT = inline_serializer(name="TechnicalAction", fields={"action": serializers.ChoiceField(choices=["start", "stop", "restart"]), "action_id": serializers.UUIDField(), "preview_revision": serializers.CharField()})


def page_data(request, query, render):
    try:
        page = max(1, int(request.query_params.get("page", 1)))
        size = min(100, max(1, int(request.query_params.get("page_size", 25))))
    except (ValueError, TypeError):
        raise AuthError("Invalid pagination.", 400) from None
    total = query.count() if hasattr(query, "count") and not isinstance(query, list) else len(query)
    return {"items": [render(row) for row in query[(page - 1) * size:page * size]], "total": total, "page": page, "page_size": size}


def incident_data(row):
    return reporting.incident_details(row)


@extend_schema(tags=["Owner · Technical"], responses=OUTPUT)
class OwnerTechnicalView(CustomerSessionView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsOwner]


class SummaryView(OwnerTechnicalView):
    def get(self, request):
        def database_ping():
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        dependencies = {}
        for name, ping in (("database", database_ping), ("redis", lambda: get_redis_client().ping())):
            started = time.monotonic()
            try:
                ping()
                dependencies[name] = {"status": "healthy", "latency_ms": round((time.monotonic() - started) * 1000, 2)}
            except Exception:
                dependencies[name] = {"status": "unavailable", "latency_ms": None}
        row, fresh = services.host_snapshot()
        now = timezone.now()
        details = {}
        for label, operation in (("payments", "CAPTURE"), ("refunds", "REFUND")):
            all_work = PaymentTransaction.objects.filter(operation=operation)
            pending = all_work.filter(status__in=["PENDING", "UNKNOWN"])
            due = pending.filter(next_attempt_at__lte=now).filter(Q(lease_until__isnull=True) | Q(lease_until__lte=now))
            oldest = pending.aggregate(value=Min("created_at"))["value"]
            details[label] = {"pending": pending.count(), "due": due.count(), "failed": all_work.filter(status="FAILED").count(), "unknown": pending.filter(status="UNKNOWN").count(), "retrying": pending.exclude(last_error="").count(), "oldest_pending_at": oldest.isoformat() if oldest else None}
        pending_receipts = Receipt.objects.filter(email_sent_at__isnull=True)
        oldest = pending_receipts.aggregate(value=Min("issued_at"))["value"]
        details["receipts"] = {"pending": pending_receipts.count(), "due": pending_receipts.filter(Q(next_email_at__isnull=True) | Q(next_email_at__lte=now)).count(), "failed": pending_receipts.exclude(last_email_error="").count(), "oldest_pending_at": oldest.isoformat() if oldest else None}
        notices = {}
        for kind in ("expiry", "refund"):
            waiting = Order.objects.filter(**{kind + "_email_sent_at__isnull": True})
            waiting = waiting.filter(status="CANCELLED", cancellation_reason="COLLECTION_EXPIRED", paid_at__isnull=False) if kind == "expiry" else waiting.filter(total_refunded__gt=0)
            oldest = waiting.aggregate(value=Min("created_at"))["value"]
            notices[kind] = {"pending": waiting.count(), "due": waiting.filter(Q(**{kind + "_email_next_attempt_at__isnull": True}) | Q(**{kind + "_email_next_attempt_at__lte": now})).filter(Q(**{kind + "_email_lease_until__isnull": True}) | Q(**{kind + "_email_lease_until__lte": now})).count(), "failed": waiting.exclude(**{kind + "_email_last_error": ""}).count(), "oldest_pending_at": oldest.isoformat() if oldest else None}
        backlog = {key: details[key]["pending"] for key in details}
        backlog["refunds"] += details["refunds"]["failed"]
        backlog.update(details=details, notices=notices, review_orders=Order.objects.filter(status="REVIEW_REQUIRED").count())
        backlog.update(reporting.backlog_snapshot())
        return Response({"observed_at": now.isoformat(), "services": services.service_rows(), "dependencies": dependencies, "worker": worker_state.snapshot(), "agent": {"status": "connected" if fresh else "stale" if row else "not_connected", "last_seen_at": row.observed_at.isoformat() if row else None}, "backlog": backlog, "incidents_open": Incident.objects.exclude(status="RESOLVED").count()})


class HistoryView(OwnerTechnicalView):
    def get(self, request):
        since, until = reporting.window(request.query_params.get("window_minutes"), at=request.query_params.get("at"))
        service = request.query_params.get("service")
        machine = request.query_params.get("machine")
        if service and service not in services.SERVICES:
            raise AuthError("Unknown service.", 400)
        kind = request.query_params.get("kind", "service")
        if kind not in {"service", "machine"}:
            raise AuthError("Unknown history kind.", 400)
        return Response(reporting.history_data(since, until, service, machine, kind))


class UsageView(OwnerTechnicalView):
    def get(self, request):
        since, until = reporting.window(request.query_params.get("window_minutes"), 1440)
        return Response(reporting.usage_data(since, until, request.query_params.get("app"), request.query_params.get("feature")))


class SystemView(OwnerTechnicalView):
    def get(self, request):
        since, until = reporting.window(request.query_params.get("window_minutes"), at=request.query_params.get("at"))
        return Response(reporting.system_data(since, until))


class MetricsView(OwnerTechnicalView):
    def get(self, request):
        try:
            minutes = min(10080, max(1, int(request.query_params.get("window_minutes", 15))))
        except ValueError:
            raise AuthError("Invalid time window.", 400) from None
        until = timezone.now()
        since = until - timedelta(minutes=minutes)
        rows = MetricBucket.objects.filter(minute__gte=since).order_by("minute")
        app, metric = request.query_params.get("app"), request.query_params.get("metric")
        if app:
            if app not in APPS | {"resources", "backend"}: raise AuthError("Unknown app.", 400)
            rows = rows.filter(app=app)
        if metric:
            if metric not in set(METRICS) | OUTCOMES | RESOURCE_METRICS | BACKEND_METRICS:
                raise AuthError("Unknown metric.", 400)
            rows = rows.filter(metric=metric)
        result = [{"metric": row.metric, "app": row.app, "route": row.route, "unit": row.unit, "count": row.count, "sum": row.total, "min": row.minimum, "max": row.maximum, "buckets": row.buckets, "minute": row.minute.isoformat()} for row in rows[:5000]]
        return Response({"observed_at": until.isoformat(), "items": result, "range": {"from": since.isoformat(), "to": until.isoformat()}, "truncated": rows.count() > 5000})


class ResourcesView(OwnerTechnicalView):
    def get(self, request):
        try:
            minutes = min(10080, max(1, int(request.query_params.get("window_minutes", 15))))
        except ValueError:
            raise AuthError("Invalid time window.", 400) from None
        since, until = reporting.window(minutes, at=request.query_params.get("at"))
        row, fresh = services.host_snapshot()
        samples = []
        if minutes <= 15:
            try:
                raw = get_redis_client().zrangebyscore(auth_key("observability:resources"), since.timestamp(), until.timestamp())
                samples = [json.loads(value) for value in raw][-180:]
            except Exception:
                if row and since <= row.observed_at <= until: samples = [row.payload]
        else:
            grouped = {}
            for bucket in MetricBucket.objects.filter(app="resources", minute__gte=since, minute__lte=until).order_by("minute"):
                stamp = bucket.minute.isoformat()
                sample = grouped.setdefault(stamp, {"timestamp": stamp, "host": {}, "container_map": {}})
                target = sample["host"] if bucket.route == "host" else sample["container_map"].setdefault(bucket.route, {"service": bucket.route})
                target[bucket.metric.removeprefix("resource.")] = bucket.total / bucket.count if bucket.count else None
            # Long ranges use a bounded view, never invent missing observations.
            values = list(grouped.values())
            step = max(1, (len(values) + 999) // 1000)
            for sample in values[::step]:
                sample["containers"] = list(sample.pop("container_map").values())
                for item in sample["containers"]:
                    item["memory_bytes"] = item.pop("memory_used_bytes", None)
                    item["memory_limit_bytes"] = item.pop("memory_total_bytes", None)
                samples.append(sample)
        return Response({"observed_at": row.observed_at.isoformat() if row else None, "unit": "percent", "freshness": "live" if fresh else "stale" if row else "missing", "samples": samples})


class IncidentsView(OwnerTechnicalView):
    def get(self, request):
        rows = Incident.objects.order_by("-last_seen_at")
        status = request.query_params.get("status")
        if status:
            if status not in {"OPEN", "ACKNOWLEDGED", "RESOLVED"}: raise AuthError("Invalid incident status.", 400)
            rows = rows.filter(status=status)
        return Response(page_data(request, rows, incident_data))


class IncidentView(OwnerTechnicalView):
    @extend_schema(operation_id="owner_technical_incident_detail")
    def get(self, request, incident_id):
        row = Incident.objects.filter(pk=incident_id).first()
        if row is None:
            raise AuthError("Incident not found.", 404)
        return Response(incident_data(row))

    @extend_schema(request=inline_serializer(name="IncidentAcknowledgment", fields={"status": serializers.ChoiceField(choices=["ACKNOWLEDGED"])}), responses=OUTPUT)
    def patch(self, request, incident_id):
        if request.data != {"status": "ACKNOWLEDGED"}: raise AuthError("Only incident acknowledgment is allowed.", 400)
        row = Incident.objects.filter(pk=incident_id).first()
        if row is None: raise AuthError("Incident not found.", 404)
        if row.status != "RESOLVED":
            row.status = "ACKNOWLEDGED"
            row.save(update_fields=["status"])
            services.activity(request.user, "incident.acknowledge", str(row.pk), "SUCCEEDED", target_type="incident")
        return Response(incident_data(row))


class ServicesView(OwnerTechnicalView):
    def get(self, request):
        return Response(page_data(request, services.service_rows(), lambda row: row))


class ServicePreviewView(OwnerTechnicalView):
    def get(self, request, service):
        return Response(services.preview(service, request.query_params.get("action", "restart")))


class ServiceActionsView(OwnerTechnicalView):
    @extend_schema(request=INPUT, responses=OUTPUT)
    def post(self, request, service):
        if not isinstance(request.data, dict) or set(request.data) != {"action", "action_id", "preview_revision"}: raise AuthError("Invalid service action fields.", 400)
        job = services.create_job(actor=request.user, service=service, **request.data)
        return Response(services.job_data(job), status=202)


class ServiceActionView(OwnerTechnicalView):
    def get(self, request, job_id):
        services.expire_jobs()
        job = ServiceActionJob.objects.filter(pk=job_id).first()
        if job is None: raise AuthError("Action not found.", 404)
        return Response(services.job_data(job))


class TelemetryIngestView(CustomerSessionView):
    @extend_schema(tags=["Telemetry"], request=inline_serializer(name="AnonymousTelemetryBatch", fields={"app": serializers.ChoiceField(choices=sorted(APPS)), "events": serializers.ListField(child=serializers.DictField(), max_length=20)}), responses=OUTPUT)
    def post(self, request):
        raw_size = len(request.body)
        data = request.data
        if raw_size > 16384 or not isinstance(data, dict) or set(data) != {"app", "events"} or not isinstance(data["app"], str) or data["app"] not in APPS or not isinstance(data["events"], list) or not 1 <= len(data["events"]) <= 20:
            raise AuthError("Invalid anonymous metric batch.", 400)
        origins = set(getattr(settings, "TELEMETRY_ALLOWED_ORIGINS", [])) | set(getattr(settings, "DEVELOPMENT_PUBLIC_ORIGINS", [])) | {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5173, 5174, 5175, 5176)}
        if request.headers.get("Origin") not in origins:
            raise AuthError("Untrusted telemetry origin.", 403)
        for event in data["events"]:
            if not isinstance(event, dict) or set(event) != {"metric", "route", "value"} or not isinstance(event["metric"], str) or not isinstance(event["route"], str) or event["metric"] not in METRICS or event["route"] not in ROUTES or type(event["value"]) not in (int, float) or not 0 <= event["value"] <= 120000 or METRICS[event["metric"]] == "count" and event["value"] != 1:
                raise AuthError("Invalid anonymous metric fields.", 400)
        # A bounded ephemeral source budget, never a stored visitor identity.
        try:
            client = get_redis_client()
            key = auth_key("observability:ingest:" + hashlib.sha256((request.META.get("REMOTE_ADDR") or "unknown").encode()).hexdigest() + ":" + str(int(time.time() // 60)))
            count = client.incr(key)
            if count == 1: client.expire(key, 120)
            if count > 120: raise AuthError("Telemetry limit reached.", 429, retry_after=60)
        except AuthError:
            raise
        except Exception:
            return Response({"accepted": False}, status=202)
        try:
            prune_if_due()
            for event in data["events"]:
                record_metric(event["metric"], data["app"], event["route"], event["value"])
                if event["metric"] == "frontend_error": raise_incident("frontend_error", "A frontend operation failed.", "app", data["app"] + ":" + event["route"])
        except Exception:
            return Response({"accepted": False}, status=202)
        return Response({"accepted": True}, status=202)


class HostAgentAuthentication(BaseAuthentication):
    def authenticate(self, request):
        expected = getattr(settings, "HOST_AGENT_TOKEN", "")
        header = request.headers.get("Authorization", "")
        supplied = header.removeprefix("Bearer ")
        if len(expected) < 32 or not header.startswith("Bearer ") or len(header) > 512 or not secrets.compare_digest(hashlib.sha256(supplied.encode()).digest(), hashlib.sha256(expected.encode()).digest()):
            raise AuthenticationFailed("Host agent authentication failed.")
        return SimpleNamespace(is_authenticated=True, pk="local-agent"), None

    def authenticate_header(self, request):
        return "Bearer"


@extend_schema(tags=["Internal · Host agent"], responses=OUTPUT)
class HostAgentView(CustomerSessionView):
    authentication_classes = [HostAgentAuthentication]
    permission_classes = [AllowAny]


class HostHeartbeatView(HostAgentView):
    @extend_schema(request=inline_serializer(name="HostHeartbeat", fields={"host": serializers.DictField(), "containers": serializers.ListField(child=serializers.DictField())}), responses=OUTPUT)
    def post(self, request):
        return Response(services.accept_heartbeat(request.data))


class HostClaimView(HostAgentView):
    @extend_schema(request=inline_serializer(name="HostAgentClaimInput", fields={"claim_new": serializers.BooleanField(required=False, default=True)}), responses=OUTPUT)
    def post(self, request):
        if not isinstance(request.data, dict) or set(request.data) - {"claim_new"} or "claim_new" in request.data and not isinstance(request.data["claim_new"], bool):
            raise AuthError("Invalid claim fields.", 400)
        # Include already claimed jobs to recover a claim response lost before
        # the exclusive agent could journal its intent. Never re-queue them.
        services.expire_jobs()
        unresolved = services.unresolved_jobs()
        return Response({"job": services.claim_job() if request.data.get("claim_new", True) else None, "unresolved": unresolved})


class HostResultView(HostAgentView):
    @extend_schema(request=inline_serializer(name="HostActionResult", fields={"status": serializers.CharField(), "result_code": serializers.CharField()}), responses=OUTPUT)
    def post(self, request, job_id):
        if not isinstance(request.data, dict) or set(request.data) != {"status", "result_code"}: raise AuthError("Invalid action outcome fields.", 400)
        try:
            job = services.finish_job(job_id, **request.data)
        except ServiceActionJob.DoesNotExist:
            raise AuthError("Action not found.", 404) from None
        return Response(services.job_data(job))
