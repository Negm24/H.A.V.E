"""Owner dashboards derive business truth from durable financial records."""
from collections import defaultdict
from datetime import timedelta, datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo
from django.db.models import Sum, Count, Q
from django.utils import timezone
from apps.accounts.security.errors import AuthError
from apps.payments.models import PaymentTransaction
from apps.orders.models import Order, OrderProduct
from apps.terminals.models import Terminal, TerminalStock
from apps.operations.api.readers import serialize

CAIRO = ZoneInfo("Africa/Cairo")
ZERO = Decimal("0.00")


def period_bounds(period):
    now = timezone.now().astimezone(CAIRO)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    starts = {"today": today, "week": today-timedelta(days=(today.weekday()-5)%7),
              "month": today.replace(day=1), "year": today.replace(month=1, day=1)}
    if period == "all":
        first = PaymentTransaction.objects.order_by("created_at").values_list("created_at", flat=True).first()
        start = first.astimezone(CAIRO).replace(hour=0, minute=0, second=0, microsecond=0) if first else today
    elif period in starts:
        start = starts[period]
    else:
        raise AuthError("Choose today, week, month, year, or all.", 400)
    return start, now


def money(value):
    return format(value or ZERO, ".2f")


def business(period="month"):
    start, end = period_bounds(period)
    captures = PaymentTransaction.objects.filter(operation="CAPTURE", status="SUCCEEDED", completed_at__gte=start, completed_at__lte=end)
    refunds = PaymentTransaction.objects.filter(operation="REFUND", status="SUCCEEDED", completed_at__gte=start, completed_at__lte=end)
    gross = captures.aggregate(value=Sum("amount"))["value"] or ZERO
    refunded = refunds.aggregate(value=Sum("amount"))["value"] or ZERO
    unit = "hour" if period == "today" else "day" if period in {"week", "month"} else "year" if period == "all" and end.year-start.year > 3 else "month"
    formats = {"hour": "%Y-%m-%d %H:00", "day": "%Y-%m-%d", "month": "%Y-%m", "year": "%Y"}
    revenue = defaultdict(lambda: ZERO)
    bucket_ranges = {}
    heat = defaultdict(int)
    cursor = start.replace(minute=0, second=0, microsecond=0) if unit == "hour" else start.replace(day=1) if unit == "month" else start.replace(month=1, day=1) if unit == "year" else start
    while cursor <= end:
        label = cursor.strftime(formats[unit])
        bucket_start = cursor
        revenue[label] = ZERO
        if unit == "hour":
            cursor = (cursor.astimezone(ZoneInfo("UTC")) + timedelta(hours=1)).astimezone(CAIRO)
        elif unit == "day":
            cursor += timedelta(days=1)
        elif unit == "month":
            cursor = cursor.replace(year=cursor.year+1, month=1) if cursor.month == 12 else cursor.replace(month=cursor.month+1)
        else:
            cursor = cursor.replace(year=cursor.year+1)
        bucket_ranges[label] = {"start": bucket_start.isoformat(), "end": min(cursor - timedelta(microseconds=1), end).isoformat()}
    for paid_at, amount in captures.values_list("completed_at", "amount"):
        local = paid_at.astimezone(CAIRO)
        revenue[local.strftime(formats[unit])] += amount
        heat[(local.weekday(), local.hour)] += 1
    def distribution(operation):
        rows = {r["status"]: r for r in PaymentTransaction.objects.filter(operation=operation, created_at__gte=start, created_at__lte=end).values("status").annotate(count=Count("pk"), amount=Sum("amount"))}
        total = sum(row["count"] for row in rows.values())
        return [{"status": status, "count": rows.get(status, {}).get("count", 0), "amount": money(rows.get(status, {}).get("amount")),
                 "percentage": round(rows.get(status, {}).get("count", 0)/total*100, 2) if total else 0} for status in PaymentTransaction.Status.values]
    products, categories, channels, kiosks = {}, {}, {}, {}
    paid_orders = Order.objects.filter(payments__in=captures).distinct()
    category_fallback_used = False
    for line in OrderProduct.objects.filter(order__in=paid_orders).select_related("order__terminal", "product__category"):
        category_name = line.category_name_snapshot or line.product.category.name_en
        category_fallback_used = category_fallback_used or not bool(line.category_name_snapshot)
        for mapping, key, label in ((products, line.product_id, line.product_name_en_snapshot),
                (categories, category_name, category_name)):
            row = mapping.setdefault(key, {"id": key, "label": label, "quantity": 0, "amount": ZERO})
            row["quantity"] += line.quantity_requested
            row["amount"] += line.line_total
    for payment in captures.select_related("order__terminal"):
        for mapping, key, label in ((channels, payment.order.channel, payment.order.channel), (kiosks, payment.order.terminal_id, payment.order.terminal.display_name)):
            row = mapping.setdefault(key, {"id": key, "label": label, "count": 0, "amount": ZERO})
            row["count"] += 1
            row["amount"] += payment.amount
            if mapping is kiosks:
                row["address"] = payment.order.terminal.address_en
    def ranked(mapping):
        return [row | {"amount": money(row["amount"])} for row in sorted(mapping.values(), key=lambda r: r["amount"], reverse=True)]
    count = captures.count()
    previous = None
    if period != "all":
        prior = PaymentTransaction.objects.filter(operation="CAPTURE", status="SUCCEEDED", completed_at__gte=start-(end-start), completed_at__lt=start)
        prior_count = prior.count()
        if prior_count:
            previous = money(prior.aggregate(value=Sum("amount"))["value"]/prior_count)
    return {"observed_at": end.isoformat(), "period": period, "timezone": "Africa/Cairo", "start": start.isoformat(), "end": end.isoformat(),
            "bucket_unit": unit, "gross_received": money(gross), "confirmed_refunds": money(refunded), "net_received": money(gross-refunded),
            "revenue": [{"label": label, "amount": money(amount), **bucket_ranges[label]} for label, amount in sorted(revenue.items())],
            "payments": distribution("CAPTURE"), "refunds": distribution("REFUND"),
            "analytics": {"products": ranked(products), "categories": ranked(categories), "channels": ranked(channels), "kiosks": ranked(kiosks),
                "category_uses_current_catalogue": category_fallback_used,
                "average_order_value": money(gross/count) if count else None, "previous_average_order_value": previous,
                "heatmap": [{"day": day, "hour": hour, "count": heat[(day,hour)]} for day in range(7) for hour in range(24)]},
            "time_basis": {"revenue": "Transaction confirmation date", "payments": "Transaction initiation date", "refunds": "Transaction initiation date"},
            "currency": "EGP", "coverage": {"source": "Durable recorded transactions", "successful_captures_without_confirmation_date": PaymentTransaction.objects.filter(operation="CAPTURE", status="SUCCEEDED", completed_at__isnull=True).count()}}


def fleet(period="month"):
    now = timezone.now()
    start, end = period_bounds(period)
    waiting = Order.objects.filter(paid_at__isnull=False, collection_required=True, status="PENDING", collection_deadline__gt=now)
    nearest = waiting.order_by("collection_deadline").values_list("collection_deadline", flat=True).first()
    expiry = defaultdict(int)
    today = now.astimezone(CAIRO).date()
    for stock in TerminalStock.objects.filter(quantity_on_hand__gt=0).select_related("batch", "terminal_slot__terminal"):
        days = (stock.batch.expiry_date-today).days
        bucket = "Expired" if days < 0 else "0–7 days" if days <= 7 else "8–30 days" if days <= 30 else "31–90 days" if days <= 90 else None
        if bucket:
            expiry[(stock.terminal_slot.terminal_id, stock.terminal_slot.terminal.display_name, bucket)] += stock.quantity_on_hand
    collected = Order.objects.filter(collection_required=True, paid_at__isnull=False, status="COMPLETED", completed_at__gte=start, completed_at__lte=end).count()
    expired = Order.objects.filter(collection_required=True, paid_at__isnull=False, cancellation_reason="COLLECTION_EXPIRED", cancelled_at__gte=start, cancelled_at__lte=end).count()
    return {"observed_at": now.isoformat(), "period": period, "start": start.isoformat(), "end": end.isoformat(),
        "machines": [serialize("kiosks", terminal) for terminal in Terminal.objects.order_by("display_name")],
        "waiting_collections": {"count": waiting.count(), "amount": money(waiting.aggregate(total=Sum("total_paid"))["total"]), "nearest_deadline": nearest},
        "expiring_stock": [{"terminal_serial": serial, "label": label, "bucket": bucket, "quantity": quantity} for (serial,label,bucket),quantity in expiry.items()],
        "collection_outcomes": {"collected": collected, "expired": expired}}
