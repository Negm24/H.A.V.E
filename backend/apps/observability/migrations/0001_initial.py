import uuid
import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name="MetricBucket", fields=[("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True, verbose_name="ID")), ("minute", models.DateTimeField(db_index=True)), ("metric", models.CharField(max_length=48)), ("app", models.CharField(max_length=20)), ("route", models.CharField(max_length=40)), ("unit", models.CharField(max_length=20)), ("count", models.PositiveIntegerField(default=0)), ("total", models.FloatField(default=0)), ("minimum", models.FloatField(default=0)), ("maximum", models.FloatField(default=0)), ("buckets", models.JSONField(default=dict))], options={"db_table": "observability_metric_buckets"}),
        migrations.AddConstraint(model_name="metricbucket", constraint=models.UniqueConstraint(fields=("minute", "metric", "app", "route"), name="observability_bucket_unique")),
        migrations.CreateModel(name="Incident", fields=[("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)), ("code", models.CharField(max_length=60)), ("severity", models.CharField(max_length=12, default="ERROR")), ("status", models.CharField(max_length=16, default="OPEN", choices=[("OPEN", "OPEN"), ("ACKNOWLEDGED", "ACKNOWLEDGED"), ("RESOLVED", "RESOLVED")])), ("summary", models.CharField(max_length=240)), ("target_type", models.CharField(max_length=30, default="app")), ("target_id", models.CharField(max_length=80, blank=True)), ("first_seen_at", models.DateTimeField(default=django.utils.timezone.now)), ("last_seen_at", models.DateTimeField(default=django.utils.timezone.now)), ("resolved_at", models.DateTimeField(null=True, blank=True)), ("occurrences", models.PositiveIntegerField(default=1))], options={"db_table": "observability_incidents"}),
        migrations.AddConstraint(model_name="incident", constraint=models.UniqueConstraint(fields=("code", "target_type", "target_id"), name="observability_incident_identity")),
        migrations.CreateModel(name="HostState", fields=[("id", models.CharField(primary_key=True, max_length=32, default="local", serialize=False)), ("observed_at", models.DateTimeField(default=django.utils.timezone.now)), ("payload", models.JSONField(default=dict))], options={"db_table": "observability_host_state"}),
        migrations.CreateModel(name="ServiceActionJob", fields=[("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)), ("service", models.CharField(max_length=20)), ("action", models.CharField(max_length=10)), ("preview_revision", models.CharField(max_length=64)), ("status", models.CharField(max_length=12, default="QUEUED", db_index=True, choices=[("QUEUED", "Queued"), ("RUNNING", "Running"), ("SUCCEEDED", "Succeeded"), ("FAILED", "Failed"), ("UNKNOWN", "Unknown")])), ("created_at", models.DateTimeField(default=django.utils.timezone.now)), ("updated_at", models.DateTimeField(auto_now=True)), ("expires_at", models.DateTimeField()), ("claimed_at", models.DateTimeField(null=True, blank=True)), ("result", models.JSONField(default=dict)), ("error", models.CharField(max_length=240, blank=True)), ("actor", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL))], options={"db_table": "observability_service_actions"}),
        migrations.AddConstraint(model_name="serviceactionjob", constraint=models.UniqueConstraint(fields=("service",), condition=models.Q(status__in=["QUEUED", "RUNNING"]), name="observability_one_live_service_job")),
    ]
