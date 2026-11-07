from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("observability", "0001_initial")]
    operations = [
        migrations.RemoveConstraint(model_name="serviceactionjob", name="observability_one_live_service_job"),
        migrations.AddConstraint(model_name="serviceactionjob", constraint=models.UniqueConstraint(fields=("service",), condition=models.Q(status__in=["QUEUED", "RUNNING", "UNKNOWN"]), name="observability_one_live_service_job")),
    ]
