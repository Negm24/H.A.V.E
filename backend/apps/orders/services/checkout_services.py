"""Application-level cart -> durable order coordination."""
from collections import defaultdict
from django.db import transaction
from apps.accounts.security.errors import AuthError
from apps.carts.security.state import transition
from apps.carts.services.cart_services import cart_data
from apps.orders.models import Order
from apps.orders.services.order_services import reserve_order
from apps.payments.services import kashier_services


def checkout_order(*, user, terminal, raw_token, session_id, data, channel):
    kashier_services.configuration()
    customer = user.customer if user.is_authenticated else None
    email = data.get("email") or (user.email if customer else "")
    print_requested = data["print_requested"] if customer else True
    key = str(data["idempotency_key"])
    # Return an existing attempt only to its original principal. reserve_order
    # normally checks the full fingerprint; the cart may have changed after pay.
    existing = Order.objects.filter(idempotency_key=key).first()
    if existing:
        if (existing.customer_id != (customer.pk if customer else None) or existing.terminal_id != terminal.pk
                or existing.channel != channel or (not customer and str(existing.terminal_session_id) != str(session_id))
                or existing.cart_version != data["cart_version"] or existing.email_receipt_to != email
                or existing.language != data["language"] or existing.print_requested != print_requested):
            raise AuthError("Checkout key belongs to a different purchase.", 409)
        return existing
    if channel == "TERMINAL" and customer and not kashier_services.saved_cards(customer):
        raise AuthError("Save a card during a Hub purchase before paying as a signed-in Terminal customer.", 400)
    context = dict(user_id=user.pk if customer else None, terminal=terminal, raw_token=raw_token)
    cart = transition("read", **context)["saved"]
    if cart.get("version", "empty") != data["cart_version"]:
        raise AuthError("The cart changed. Reload it before checkout.", 409)
    return reserve_order(terminal=terminal, customer=customer, items=cart.get("items") or {},
        cart_version=data["cart_version"], email=email, language=data["language"], print_requested=print_requested,
        channel=channel, idempotency_key=key, terminal_session_id=session_id)


def reorder(order, *, user_id, terminal, raw_token, expected_version, replace_existing):
    context = dict(user_id=user_id, terminal=terminal, raw_token=raw_token)
    before = transition("read", **context)["saved"]
    if before.get("version", "empty") != expected_version:
        raise AuthError("The cart changed. Reload it before reordering.", 409)
    if before.get("items") and not replace_existing:
        raise AuthError("Confirm replacement of the current nonempty cart.", 409)
    items = defaultdict(int)
    for line in order.items.all():
        items[str(line.product_id)] += line.quantity_requested
    projection = cart_data(terminal, {"items": dict(items)})
    if projection["has_issues"]:
        raise AuthError("Some original products or quantities are unavailable. Review current stock; nothing was substituted or added.", 409)
    result = transition("replace", **context, expected_version=expected_version, items=dict(items))
    return cart_data(terminal, result["saved"])
