"""Durable receipt delivery, retried by the payment maintenance worker."""
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from django.template.loader import render_to_string

from apps.orders.models import Receipt


def deliver_receipt(receipt_id):
    # Claim a short lease before SMTP; never hold a database lock over the network.
    with transaction.atomic():
        receipt = Receipt.objects.select_for_update(of=("self",)).select_related("order").get(pk=receipt_id)
        now = timezone.now()
        if receipt.email_sent_at or receipt.next_email_at and receipt.next_email_at > now:
            return bool(receipt.email_sent_at)
        receipt.email_attempts += 1
        receipt.next_email_at = now + timedelta(minutes=5)
        receipt.save(update_fields=["email_attempts", "next_email_at"])
        snapshot = receipt.receipt_snapshot
        address = receipt.order.email_receipt_to
        number = receipt.receipt_number
        language = receipt.order.language
    message = render_to_string(f"orders/receipt_{language}.txt", {"receipt_number": number, "receipt": snapshot})
    try:
        sent = send_mail(f"H.A.V.E test receipt {number}", message, settings.DEFAULT_FROM_EMAIL, [address], fail_silently=False)
        if sent != 1:
            raise RuntimeError("Email delivery was not accepted.")
    except Exception:
        # SMTP exceptions may contain private configuration or recipient data.
        Receipt.objects.filter(pk=receipt_id).update(last_email_error="Receipt email delivery failed; retry scheduled.")
        return False
    Receipt.objects.filter(pk=receipt_id, email_sent_at__isnull=True).update(
        email_sent_at=timezone.now(), last_email_error="", next_email_at=None)
    return True
