"""Separate collection/payment indicators and a combined profile attention count."""
from django.db.models import Count
from django.utils import timezone

from apps.orders.models import Order


def collection_summary(customer_id, terminal=None):
    rows = list(Order.objects.filter(customer_id=customer_id, status=Order.Status.PENDING,
        paid_at__isnull=False, collection_required=True, collection_deadline__gt=timezone.now())
        .values("terminal_id", "terminal__display_name").annotate(count=Count("pk")).order_by("terminal_id"))
    places = [{"serial_number": row["terminal_id"], "display_name": row["terminal__display_name"], "count": row["count"]}
              for row in rows]
    total = sum(row["count"] for row in rows)
    here = next((row["count"] for row in rows if terminal and row["terminal_id"] == terminal.pk), 0)
    awaiting_payment = Order.objects.filter(customer_id=customer_id, status=Order.Status.PENDING,
        paid_at__isnull=True, expires_at__gt=timezone.now(), payments__operation="CAPTURE",
        payments__status__in=["PENDING", "UNKNOWN"], payments__checkout_url__gt="").distinct().count()
    return {"awaiting_collection_count": total, "at_terminal_count": here,
            "elsewhere_count": total - here, "collection_terminals": places,
            "awaiting_payment_count": awaiting_payment, "attention_count": total + awaiting_payment}
