"""Shared pricing and operations; callers determine auth and stock scope."""
from datetime import datetime, timezone
from decimal import Decimal

from apps.accounts.security.errors import AuthError
from apps.catalogue.models import Product
from apps.catalogue.services.catalogue_services import availability, product_data, terminal_products
from apps.carts.security.state import transition


def _date(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat() if value is not None else None


def cart_data(terminal, cart, *, comparison_required=False, adoption_notice=None):
    quantities = cart.get("items") or {}
    products = {p.pk: p for p in Product.objects.select_related("category").filter(pk__in=quantities)}
    assigned = set(terminal_products(terminal).values_list("pk", flat=True))
    stock = availability(terminal)
    lines, total = [], Decimal("0.00")
    for key, quantity in sorted(quantities.items(), key=lambda item: int(item[0])):
        product = products.get(int(key))
        if product is None:
            lines.append({"product_id": int(key), "product": None, "quantity": quantity,
                          "unit_price": "0.00", "line_total": "0.00", "issues": ["unavailable"]})
            continue
        data, issues = product_data(product, stock), []
        if product.pk not in assigned:
            issues.append("unavailable")
            data["quantity_limit"] = 0
        if product.requires_prescription:
            issues.append("prescription_required")
        if quantity > stock.get(product.pk, 0):
            issues.append("stock_changed")
        if product.max_quantity_per_order is not None and quantity > product.max_quantity_per_order:
            issues.append("quantity_limit")
        amount = product.price * quantity
        total += amount
        lines.append({"product_id": product.pk, "product": data, "quantity": quantity,
                      "unit_price": format(product.price, ".2f"), "line_total": format(amount, ".2f"), "issues": issues})
    return {
        "items": lines, "total_quantity": sum(quantities.values()), "subtotal": format(total, ".2f"),
        "total": format(total, ".2f"), "currency": "EGP", "has_issues": any(line["issues"] for line in lines),
        "version": cart.get("version", "empty"), "created_at": _date(cart.get("created_at")),
        "updated_at": _date(cart.get("updated_at")), "expires_at": _date(cart.get("expires_at")),
        "comparison_required": comparison_required, "adoption_notice": adoption_notice,
    }


def _project(result, terminal, user_id):
    return cart_data(terminal, result["saved"] if user_id else result["guest"],
                     comparison_required=result["required"], adoption_notice=result["adoption_notice"])


def get_cart(*, user_id=None, terminal=None, raw_token=""):
    result = transition("read", user_id=user_id, terminal=terminal, raw_token=raw_token)
    return _project(result, terminal, user_id)


def change_cart(*, expected_version, user_id=None, terminal=None, raw_token="", product_id=None, quantity=0, clear=False):
    context = dict(user_id=user_id, terminal=terminal, raw_token=raw_token)
    before = transition("read", **context)
    if before["required"]:
        raise AuthError("Choose your saved cart or current guest cart before changing items.", status=409)
    current = before["saved"] if user_id else before["guest"]
    if current.get("version", "empty") != expected_version:
        raise AuthError("The cart changed elsewhere. Reload it and repeat your choice.", status=409)
    # Reductions/removals always work even if an existing line became unavailable.
    previous = (current.get("items") or {}).get(str(product_id), 0)
    if not clear and quantity > previous:
        product = terminal_products(terminal).filter(pk=product_id).first()
        if product is None:
            raise AuthError("This product is unavailable in the current catalogue.", status=400)
        if quantity > product_data(product, availability(terminal))["quantity_limit"]:
            raise AuthError("Quantity exceeds current stock, the order limit, or prescription eligibility.", status=400)
    after = transition("clear" if clear else "set", **context, expected_version=expected_version,
                       product_id=str(product_id), quantity=quantity)
    return _project(after, terminal, user_id)
