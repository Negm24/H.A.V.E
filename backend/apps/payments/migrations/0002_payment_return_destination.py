from django.db import migrations, models


def backfill_return_destination(apps, schema_editor):
    Payment = apps.get_model("payments", "PaymentTransaction")
    Payment.objects.filter(order__channel="HUB").update(return_app="HUB")
    # Existing scoped result cookies and original hosted return URLs remain valid.
    Payment.objects.filter(order__channel="TERMINAL").update(return_app="TERMINAL")
    for payment in Payment.objects.filter(operation="CAPTURE", return_app="TERMINAL").select_related("order").iterator():
        Payment.objects.filter(pk=payment.pk).update(return_terminal_session_id=payment.order.terminal_session_id)


class Migration(migrations.Migration):
    dependencies = [("payments", "0001_initial"), ("orders", "0005_order_collection_required")]
    operations = [
        migrations.AddField(model_name="paymenttransaction", name="return_app",
            field=models.CharField(blank=True, choices=[("HUB", "Hub"), ("TERMINAL", "Terminal")], max_length=8)),
        migrations.AddField(model_name="paymenttransaction", name="return_terminal_session_id",
            field=models.UUIDField(blank=True, null=True)),
        migrations.RunPython(backfill_return_destination, migrations.RunPython.noop),
    ]
