from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("observability", "0002_serialize_uncertain_actions")]
    operations = [
        migrations.CreateModel(name="Observation", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("minute", models.DateTimeField(db_index=True)),
            ("kind", models.CharField(max_length=16)),
            ("target", models.CharField(max_length=100)),
            ("payload", models.JSONField(default=dict)),
        ], options={"db_table": "observability_observations", "constraints": [models.UniqueConstraint(fields=("minute", "kind", "target"), name="observability_observation_unique")]}),
    ]
