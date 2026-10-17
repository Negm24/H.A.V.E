from collections import Counter

from django.db.models import F, Sum
from django.utils import timezone

from apps.catalogue.models import Product
from apps.terminals.models import TerminalSlot, TerminalStock


def terminal_products(terminal=None):
    """Assigned products remain discoverable even when every batch is exhausted."""
    filters = {"is_active": True, "category__is_active": True,
               "terminal_slots__is_enabled": True, "terminal_slots__terminal__is_disabled": False}
    if terminal is not None:
        filters["terminal_slots__terminal"] = terminal
    products = Product.objects.select_related("category").filter(**filters)
    return products.distinct().order_by("id")


def availability(terminal=None):
    # Defensive read: direct SQL/admin mistakes must never make invalid stock sellable.
    slots = TerminalSlot.objects.filter(is_enabled=True, terminal__is_disabled=False)
    if terminal is not None:
        slots = slots.filter(terminal=terminal)
    valid_slots = slots.annotate(
        total=Sum("stock__quantity_on_hand"),
    ).filter(total__lte=F("capacity")).values("pk")
    rows = TerminalStock.objects.filter(
        terminal_slot_id__in=valid_slots, batch__expiry_date__gte=timezone.localdate(),
        batch__product_id=F("terminal_slot__product_id"),
    ).values("id", "terminal_slot__product_id", "quantity_on_hand")
    # A deadline alone does not release stock: an uncertain payment must be
    # reconciled before its reservation is explicitly released by Orders.
    from apps.orders.models import StockReservation
    reserved = dict(StockReservation.objects.filter(
        status=StockReservation.Status.ACTIVE,
        order_product__terminal_stock_id__in=rows.values("id"),
    ).values("order_product__terminal_stock_id").annotate(quantity=Sum("quantity"))
        .values_list("order_product__terminal_stock_id", "quantity"))
    totals = Counter()
    for row in rows:
        totals[row["terminal_slot__product_id"]] += max(0, row["quantity_on_hand"] - reserved.get(row["id"], 0))
    return dict(totals)


def product_data(product, stock):
    quantity = stock.get(product.pk, 0)
    return {
        "id": product.pk, "sku": product.sku, "category_id": product.category_id,
        "name_en": product.name_en, "name_ar": product.name_ar,
        "active_ingredient": product.active_ingredient, "strength": product.strength,
        "dosage_form": product.dosage_form, "pack_description": product.pack_description,
        "usage_instructions_en": product.usage_instructions_en, "usage_instructions_ar": product.usage_instructions_ar,
        "warnings_en": product.warnings_en, "warnings_ar": product.warnings_ar,
        "symptom_tags": product.symptom_tags, "price": format(product.price, ".2f"),
        "currency": "EGP", "requires_prescription": product.requires_prescription,
        "max_quantity_per_order": product.max_quantity_per_order, "stock_quantity": quantity,
        "quantity_limit": 0 if product.requires_prescription else min(quantity, product.max_quantity_per_order) if product.max_quantity_per_order is not None else quantity,
        "image_url": None,
    }


def list_products(terminal=None):
    stock = availability(terminal)
    return [product_data(product, stock) for product in terminal_products(terminal)]


def list_categories(terminal=None):
    products = list(terminal_products(terminal))
    counts = Counter(product.category_id for product in products)
    categories = {product.category_id: product.category for product in products}
    return [{"id": pk, "name_en": categories[pk].name_en, "name_ar": categories[pk].name_ar,
             "product_count": count, "image_url": None} for pk, count in sorted(counts.items())]
