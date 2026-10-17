"""Expiring collection/refund notices with durable leases and retry backoff."""
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from apps.orders.models import Order


def _message(order, kind):
    reference = order.order_number
    if order.language == "ar":
        if kind == "expiry":
            return (f"H.A.V.E — انتهت مهلة استلام الطلب {reference}",
                f"انتهت مهلة استلام طلبك {reference} وتم إلغاؤه.\n"
                f"جارٍ معالجة رد المبلغ بالكامل: {order.total_paid:.2f} جنيه مصري.\n"
                "سنرسل رسالة أخرى بعد تأكيد رد المبلغ من مزود الدفع.\n"
                "هذه عملية اختبار فقط؛ لم يتم خصم أموال حقيقية.")
        return (f"H.A.V.E — تأكيد رد مبلغ الطلب {reference}",
            f"أكد مزود الدفع رد المبلغ بالكامل لطلبك {reference}: {order.total_refunded:.2f} جنيه مصري.\n"
            "هذه عملية اختبار فقط؛ لم يتم رد أموال حقيقية.")
    if kind == "expiry":
        return (f"H.A.V.E — collection deadline expired: {reference}",
            f"Your collection deadline for order {reference} has passed and the order was cancelled.\n"
            f"A full refund of {order.total_paid:.2f} EGP is being processed.\n"
            "We will email you again after the payment provider confirms the refund.\n"
            "Test environment only. No real money was charged.")
    return (f"H.A.V.E — refund confirmed: {reference}",
        f"The payment provider confirmed a full refund for order {reference}: {order.total_refunded:.2f} EGP.\n"
        "Test environment only. No real money was refunded.")


def send_order_notice(order_id, kind):
    if kind not in ("expiry", "refund"):
        raise ValueError("Unknown order notice.")
    fields = {name: f"{kind}_email_{name}" for name in
        ("sent_at", "attempts", "next_attempt_at", "lease_until", "last_error")}
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        now = timezone.now()
        if getattr(order, fields["sent_at"]):
            return True
        if order.status != Order.Status.CANCELLED or not order.paid_at or not order.total_paid:
            return False
        if kind == "expiry" and order.cancellation_reason != "COLLECTION_EXPIRED":
            return False
        if kind == "refund" and order.total_refunded != order.total_paid:
            return False
        lease = getattr(order, fields["lease_until"])
        next_attempt = getattr(order, fields["next_attempt_at"])
        if lease and lease > now or next_attempt and next_attempt > now:
            return False
        attempt = getattr(order, fields["attempts"]) + 1
        setattr(order, fields["attempts"], attempt)
        setattr(order, fields["lease_until"], now + timedelta(minutes=2))
        setattr(order, fields["next_attempt_at"], now + timedelta(seconds=min(3600, 30 * 2 ** min(attempt - 1, 7))))
        order.save(update_fields=[fields["attempts"], fields["lease_until"], fields["next_attempt_at"]])
        subject, message = _message(order, kind)
        address = order.email_receipt_to
    try:
        if send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [address], fail_silently=False) != 1:
            raise RuntimeError("Email delivery was not accepted.")
    except Exception:
        Order.objects.filter(pk=order_id).update(**{
            fields["lease_until"]: None,
            fields["last_error"]: "Email delivery failed; retry scheduled.",
        })
        return False
    Order.objects.filter(pk=order_id, **{fields["sent_at"] + "__isnull": True}).update(**{
        fields["sent_at"]: timezone.now(), fields["lease_until"]: None,
        fields["next_attempt_at"]: None, fields["last_error"]: "",
    })
    return True
