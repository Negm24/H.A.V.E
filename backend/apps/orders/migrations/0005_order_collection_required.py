from django.db import migrations, models


def backfill_hub_collection(apps, schema_editor):
    apps.get_model("orders", "Order").objects.filter(channel="HUB").update(collection_required=True)


class Migration(migrations.Migration):
    dependencies = [("orders", "0004_order_cart_cleanup_completed_at")]
    operations = [
        migrations.AddField(model_name="order", name="collection_required", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="order", name="cart_preserved", field=models.BooleanField(default=False)),
        migrations.RunPython(backfill_hub_collection, migrations.RunPython.noop),
    ]
