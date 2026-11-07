from uuid import uuid4

from django.conf import settings
from django.db import models
from django.utils import timezone


class MetricBucket(models.Model):
    minute = models.DateTimeField(db_index=True)
    metric = models.CharField(max_length=48)
    app = models.CharField(max_length=20)
    route = models.CharField(max_length=40)
    unit = models.CharField(max_length=20)
    count = models.PositiveIntegerField(default=0)
    total = models.FloatField(default=0)
    minimum = models.FloatField(default=0)
    maximum = models.FloatField(default=0)
    buckets = models.JSONField(default=dict)

    class Meta:
        db_table = "observability_metric_buckets"
        constraints = [models.UniqueConstraint(fields=["minute", "metric", "app", "route"], name="observability_bucket_unique")]


class Incident(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    code = models.CharField(max_length=60)
    severity = models.CharField(max_length=12, default="ERROR")
    status = models.CharField(max_length=16, default="OPEN", choices=[(v, v) for v in ("OPEN", "ACKNOWLEDGED", "RESOLVED")])
    summary = models.CharField(max_length=240)
    target_type = models.CharField(max_length=30, default="app")
    target_id = models.CharField(max_length=80, blank=True)
    first_seen_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField(default=timezone.now)
    resolved_at = models.DateTimeField(null=True, blank=True)
    occurrences = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "observability_incidents"
        constraints = [models.UniqueConstraint(fields=["code", "target_type", "target_id"], name="observability_incident_identity")]


class HostState(models.Model):
    id = models.CharField(primary_key=True, max_length=32, default="local")
    observed_at = models.DateTimeField(default=timezone.now)
    payload = models.JSONField(default=dict)

    class Meta:
        db_table = "observability_host_state"


class Observation(models.Model):
    """Bounded minute evidence recorded by producers, independently of Owner reads."""
    minute = models.DateTimeField(db_index=True)
    kind = models.CharField(max_length=16)
    target = models.CharField(max_length=100)
    payload = models.JSONField(default=dict)

    class Meta:
        db_table = "observability_observations"
        constraints = [models.UniqueConstraint(fields=["minute", "kind", "target"], name="observability_observation_unique")]


class ServiceActionJob(models.Model):
    class Status(models.TextChoices):
        QUEUED = "QUEUED"
        RUNNING = "RUNNING"
        SUCCEEDED = "SUCCEEDED"
        FAILED = "FAILED"
        UNKNOWN = "UNKNOWN"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    service = models.CharField(max_length=20)
    action = models.CharField(max_length=10)
    preview_revision = models.CharField(max_length=64)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED, db_index=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField()
    claimed_at = models.DateTimeField(null=True, blank=True)
    result = models.JSONField(default=dict)
    error = models.CharField(max_length=240, blank=True)

    class Meta:
        db_table = "observability_service_actions"
        constraints = [models.UniqueConstraint(fields=["service"], condition=models.Q(status__in=["QUEUED", "RUNNING", "UNKNOWN"]), name="observability_one_live_service_job")]
