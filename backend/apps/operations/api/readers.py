from django.db.models import Q
from django.utils import timezone
from apps.accounts.models import Doctor, User
from apps.accounts.api.serializers.owner_serializers import DoctorApplicationOutputSerializer
from apps.catalogue.models import Category, Product, ProductBatch
from apps.terminals.models import Terminal, TerminalSlot, TerminalStock
from apps.orders.models import Order, Receipt
from apps.orders.api.views.shared_views import _data
from apps.operations.models import ActivityEntry
from apps.operations.api.serializers import CategorySerializer, ProductSerializer, BatchSerializer, SlotSerializer, KioskSerializer
from apps.operations.services.records import stock_data
from apps.terminals.services.heartbeat import last_seen_many


MODELS = {"doctors": Doctor, "customers": User, "orders": Order, "categories": Category,
          "products": Product, "batches": ProductBatch, "slots": TerminalSlot, "stock": TerminalStock,
          "kiosks": Terminal, "activity": ActivityEntry}
SERIALIZERS = {"categories": CategorySerializer, "products": ProductSerializer, "batches": BatchSerializer,
               "slots": SlotSerializer, "kiosks": KioskSerializer}


def payment_review_filter():
    return (Q(payment_uncertain=True) | Q(status="REVIEW_REQUIRED")
            | Q(payments__status="UNKNOWN")
            | Q(payments__operation="REFUND", payments__status="FAILED"))


def account_data(user):
    row = {field: getattr(user, field) for field in (
        "id", "account_type", "first_name", "last_name", "phone_number", "email", "is_disabled", "created_at")}
    row["date_of_birth"] = user.customer.date_of_birth if user.account_type == "CUSTOMER" else None
    row["paid_pending_collections"] = [
        {"id": str(o.pk), "order_number": o.order_number, "terminal_serial": o.terminal_id,
         "collection_deadline": o.collection_deadline, "total_paid": format(o.total_paid, ".2f")}
        for o in Order.objects.filter(customer_id=user.pk, paid_at__isnull=False,
            collection_required=True, status="PENDING", collection_deadline__gt=timezone.now())]
    return row


def serialize(resource, row):
    if resource == "kiosks":
        from apps.operations.services.presence import indicators
        return dict(SERIALIZERS[resource](row).data) | indicators(row)
    if resource == "doctors":
        result = dict(DoctorApplicationOutputSerializer(row).data)
        result.update(is_disabled=row.user.is_disabled, account_type="DOCTOR", application_submitted_at=row.application_submitted_at)
        return result
    if resource == "customers":
        return account_data(row)
    if resource == "orders":
        result = _data(row)
        transactions = list(row.payments.values("operation", "status", "amount", "created_at", "completed_at"))
        reasons = []
        if row.payment_uncertain:
            reasons.append("Payment outcome uncertain")
        if row.status == "REVIEW_REQUIRED":
            reasons.append("Order requires review")
        for payment in transactions:
            if payment["status"] == "UNKNOWN" or payment["operation"] == "REFUND" and payment["status"] == "FAILED":
                reasons.append(f'{payment["operation"].title()} outcome {payment["status"].lower()}')
        return result | {"transactions": transactions, "attention_reasons": reasons}
    if resource == "stock":
        return stock_data(row)
    if resource == "activity":
        return {"id": row.pk, "actor_id": row.actor_id, "action": row.action, "target_type": row.target_type,
                "target_id": row.target_id, "outcome": row.outcome, "metadata": row.metadata, "created_at": row.created_at}
    return dict(SERIALIZERS[resource](row).data)


def records(resource, filters):
    model = MODELS[resource]
    rows = model.objects.all()
    query = str(filters.get("query") or "").strip()[:200]
    status = str(filters.get("status") or "").upper()
    if resource == "customers":
        rows = rows.filter(account_type="CUSTOMER").select_related("customer")
        if query:
            rows = rows.filter(Q(pk__icontains=query) | Q(first_name__icontains=query) | Q(last_name__icontains=query)
                               | Q(phone_number__icontains=query) | Q(email__icontains=query))
        if status in {"ACTIVE", "BLOCKED", "SUSPENDED"}:
            rows = rows.filter(is_disabled=status != "ACTIVE")
    elif resource == "doctors":
        rows = rows.select_related("user")
        if status in {"PENDING", "APPROVED", "REJECTED"}:
            rows = rows.filter(approval_status=status)
        elif status in {"BLOCKED", "SUSPENDED"}:
            rows = rows.filter(approval_status="APPROVED", user__is_disabled=True)
        if query:
            rows = rows.filter(Q(user__id__icontains=query) | Q(user__first_name__icontains=query)
                | Q(user__last_name__icontains=query) | Q(user__phone_number__icontains=query)
                | Q(user__email__icontains=query) | Q(professional_license_number__icontains=query))
        return rows.order_by("application_submitted_at", "pk")
    elif resource == "orders":
        rows = rows.select_related("terminal")
        if filters.get("channel"):
            rows = rows.filter(channel=filters["channel"])
        if filters.get("product_id"):
            rows = rows.filter(items__product_id=filters["product_id"]).distinct()
        if filters.get("category"):
            category = filters["category"]
            missing_snapshot = Q(items__category_name_snapshot__isnull=True) | Q(items__category_name_snapshot="")
            condition = missing_snapshot if category == "Historical category unavailable" else (
                Q(items__category_name_snapshot=category)
                | (missing_snapshot & Q(items__product__category__name_en=category))
            )
            rows = rows.filter(condition).distinct()
        if query:
            rows = rows.filter(Q(order_number__icontains=query) | Q(customer__user__id__icontains=query))
        if status in Order.Status.values:
            rows = rows.filter(status=status)
        if status in {"PAYMENT_REVIEW", "REVIEW_PAYMENTS"}:
            rows = rows.filter(payment_review_filter()).distinct()
        if filters.get("terminal_serial"):
            rows = rows.filter(terminal_id=filters["terminal_serial"])
        attention = filters.get("financial_attention")
        if filters.get("receipt_pending"):
            rows = rows.filter(receipt__email_sent_at__isnull=True, receipt__isnull=False)
        if attention == "NEEDS_ATTENTION":
            rows = rows.filter(payment_review_filter()).distinct()
        elif attention == "PAYMENT_UNCERTAIN":
            rows = rows.filter(Q(payment_uncertain=True) | Q(payments__operation="CAPTURE", payments__status="UNKNOWN")).distinct()
        elif attention in {"REFUND_UNCERTAIN", "REFUND_FAILED"}:
            rows = rows.filter(payments__operation="REFUND", payments__status="UNKNOWN" if attention == "REFUND_UNCERTAIN" else "FAILED").distinct()
        if filters.get("period") or filters.get("start") or filters.get("date_basis"):
            from apps.operations.services.reporting import period_bounds
            start, end = period_bounds(filters.get("period", "month"))
            start, end = filters.get("start", start), filters.get("end", end)
            basis = filters.get("date_basis", "created")
            if basis in {"capture_confirmed", "refund_confirmed", "capture_initiated", "refund_initiated"}:
                from apps.payments.models import PaymentTransaction
                date_field = "completed_at" if basis.endswith("confirmed") else "created_at"
                matching = PaymentTransaction.objects.filter(operation="REFUND" if basis.startswith("refund") else "CAPTURE",
                    **{date_field+"__gte": start, date_field+"__lte": end})
                payment_status = "SUCCEEDED" if basis.endswith("confirmed") else filters.get("transaction_status")
                if payment_status:
                    matching = matching.filter(status=payment_status)
                rows = rows.filter(payments__in=matching).distinct()
            else:
                date_field = {"created": "created_at", "collection_completed": "completed_at", "collection_expired": "cancelled_at"}[basis]
                rows = rows.filter(**{date_field+"__gte": start, date_field+"__lte": end})
                if basis.startswith("collection"):
                    rows = rows.filter(collection_required=True, paid_at__isnull=False)
                    rows = rows.filter(status="COMPLETED") if basis == "collection_completed" else rows.filter(cancellation_reason="COLLECTION_EXPIRED")
        return rows.order_by("-created_at", "pk")
    elif resource == "stock":
        rows = rows.filter(terminal_slot__is_operational=True).select_related("terminal_slot", "batch__product")
        if filters.get("low_stock"):
            rows = rows.filter(quantity_on_hand__lte=5)
        if query:
            rows = rows.filter(Q(batch__product__name_en__icontains=query) | Q(batch__batch_number__icontains=query)
                               | Q(terminal_slot__slot_code__icontains=query))
        if filters.get("terminal_serial"):
            rows = rows.filter(terminal_slot__terminal_id=filters["terminal_serial"])
        if filters.get("product_id"):
            rows = rows.filter(batch__product_id=filters["product_id"])
    elif resource == "activity":
        if query:
            rows = rows.filter(Q(action__icontains=query) | Q(target_id__icontains=query) | Q(target_type__icontains=query))
        return rows.order_by("-created_at", "pk")
    else:
        if resource == "slots":
            rows = rows.filter(is_operational=True)
        fields = {"categories": ["name_en", "name_ar"], "products": ["name_en", "name_ar", "sku"],
                  "batches": ["batch_number", "product__name_en"], "slots": ["slot_code", "terminal__serial_number"],
                  "kiosks": ["serial_number", "display_name"]}[resource]
        if query:
            condition = Q()
            for field in fields:
                condition |= Q(**{field + "__icontains": query})
            rows = rows.filter(condition)
        if resource in {"categories", "products"} and "is_active" in filters:
            rows = rows.filter(is_active=filters["is_active"])
        if resource == "products" and filters.get("category_id"):
            rows = rows.filter(category_id=filters["category_id"])
        if resource in {"batches", "slots"} and filters.get("product_id"):
            rows = rows.filter(product_id=filters["product_id"])
        if resource == "slots" and filters.get("terminal_serial"):
            rows = rows.filter(terminal_id=filters["terminal_serial"])
        if resource == "kiosks" and status == "MAINTENANCE":
            rows = rows.filter(maintenance_enabled=True)
    if "is_disabled" in filters and resource in {"customers", "kiosks"}:
        rows = rows.filter(is_disabled=filters["is_disabled"])
    return rows.order_by("pk")


def page(resource, filters):
    rows = records(resource, filters)
    number, size = filters.get("page", 1), filters.get("page_size", 25)
    items = list(rows[(number - 1) * size:number * size])
    if resource == "kiosks":
        for row, seen in zip(items, last_seen_many(items)):
            row._app_last_seen_at = seen
    return {"items": [serialize(resource, row) for row in items],
            "total": rows.count(), "page": number, "page_size": size}


def overview():
    return {"pending_doctors": Doctor.objects.filter(approval_status="PENDING").count(),
            "review_payments": Order.objects.filter(payment_review_filter()).distinct().count(),
            "pending_receipts": Receipt.objects.filter(email_sent_at__isnull=True).count(),
            "low_stock": TerminalStock.objects.filter(quantity_on_hand__lte=5).count(),
            "unavailable_kiosks": Terminal.objects.filter(Q(is_disabled=True) | Q(maintenance_enabled=True)).count(),
            "observed_at": timezone.now()}
