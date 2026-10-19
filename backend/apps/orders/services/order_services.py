"""Durable purchases and stock allocation; no provider/network calls under locks.

All lifecycle transitions lock Order -> Terminal -> slots -> stock. New orders
lock Terminal -> slots -> stock before they exist. ACTIVE reservations continue
to block stock until an explicit outcome, even when a provider is unreachable.
"""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from hashlib import sha256
import json
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.catalogue.models import Product, ProductBatch
from apps.orders.models import Order, OrderProduct, Receipt, StockReservation
from apps.orders.services.printing_services import print_receipt_stub
from apps.terminals.models import Terminal, TerminalSlot, TerminalStock


def _money(value):
    return format(value, ".2f")


def _items(items):
    if not isinstance(items, dict) or not items:
        raise AuthError("Add products to the cart before checkout.", 400)
    result = {}
    for key, quantity in items.items():
        try:
            product_id = int(key)
        except (TypeError, ValueError):
            raise AuthError("Invalid checkout product.", 400) from None
        if (isinstance(key, bool) or str(product_id) != str(key) or product_id <= 0
                or isinstance(quantity, bool) or not isinstance(quantity, int)
                or not 0 < quantity <= 2147483647):
            raise AuthError("Product quantities must be positive whole numbers.", 400)
        result[product_id] = quantity
    return result


def _fingerprint(**values):
    return sha256(json.dumps(values, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _existing_order(key, fingerprint):
    order = Order.objects.select_for_update().filter(idempotency_key=key).first()
    if order and order.checkout_fingerprint != fingerprint:
        raise AuthError("This checkout key was already used for a different purchase.", 409)
    return order


def _locked_inventory(terminal, product_ids):
    """Use the same slot-first ordering as every inventory writer."""
    current = Terminal.objects.select_for_update().get(pk=terminal.pk)
    terminal.is_disabled = current.is_disabled
    slots = list(TerminalSlot.objects.select_for_update().filter(
        terminal=terminal, product_id__in=product_ids,
    ).order_by("pk"))
    stock_query = TerminalStock.objects.filter(terminal_slot_id__in=[slot.pk for slot in slots])
    # set_stock() takes slot -> batch -> stock; maintain that ordering here too.
    list(ProductBatch.objects.select_for_update().filter(
        pk__in=stock_query.values("batch_id"),
    ).order_by("pk"))
    stocks = list(stock_query.select_for_update().select_related("batch").order_by("pk"))
    return {slot.pk: slot for slot in slots}, stocks


def reserve_order(*, terminal, items, cart_version, email, channel, idempotency_key,
                  customer=None, language="en", print_requested=False, terminal_session_id=None,
                  prevent_duplicate_checkout=False):
    """Allocate FEFO stock and snapshot current prices, idempotently.

    The API must read the authenticated cart and verify its supplied version
    before calling; it never passes client prices or an unverified customer ID.
    """
    items = _items(items)
    email = str(email or "").strip()
    try:
        validate_email(email)
    except ValidationError:
        raise AuthError("A valid receipt email address is required.", 400) from None
    if len(email) > 254 or language not in ("en", "ar") or not isinstance(print_requested, bool):
        raise AuthError("Invalid checkout preferences.", 400)
    if (channel not in Order.Channel.values or (channel == Order.Channel.HUB and customer is None)
            or not idempotency_key or len(str(idempotency_key)) > 100
            or not cart_version or len(str(cart_version)) > 100):
        raise AuthError("Invalid checkout context.", 400)
    if customer is None and not print_requested:
        raise AuthError("Guest purchases require a printed receipt.", 400)
    fingerprint = _fingerprint(terminal=terminal.pk, customer=customer.pk if customer else None,
        items=items, cart_version=cart_version, email=email, channel=channel,
        language=language, print_requested=print_requested, terminal_session_id=terminal_session_id)
    try:
        with transaction.atomic():
            previous = _existing_order(str(idempotency_key), fingerprint)
            if previous:
                return previous
            current_terminal = Terminal.objects.select_for_update().get(pk=terminal.pk)
            if current_terminal.is_disabled:
                raise AuthError("This Terminal is disabled. Choose another Terminal.", 409)
            # A concurrent retry may have committed while we waited for Terminal.
            previous = _existing_order(str(idempotency_key), fingerprint)
            if previous:
                return previous
            if prevent_duplicate_checkout:
                # The Terminal row serializes both apps' checkout creation.
                # Never let a new idempotency key bypass an unfinished attempt.
                active = Order.objects.filter(terminal=current_terminal, customer=customer,
                    paid_at__isnull=True, status__in=[Order.Status.PENDING, Order.Status.REVIEW_REQUIRED])
                if customer is None:
                    active = active.filter(terminal_session_id=terminal_session_id)
                unfinished = active.order_by("created_at", "pk").first()
                if unfinished:
                    from apps.orders.services.errors import CheckoutConflict
                    raise CheckoutConflict("An unfinished checkout already exists. Continue or cancel it before starting another purchase.",
                        "CHECKOUT_EXISTS", unfinished.pk)
            products = {row.pk: row for row in Product.objects.select_for_update(of=("self",)).filter(
                pk__in=items, is_active=True, category__is_active=True,
            ).order_by("pk")}
            if len(products) != len(items):
                raise AuthError("One or more cart products are no longer available.", 409)
            for pk, quantity in items.items():
                product = products[pk]
                if product.requires_prescription:
                    raise AuthError("Prescription checkout is not available yet.", 400)
                if product.max_quantity_per_order is not None and quantity > product.max_quantity_per_order:
                    raise AuthError("A product exceeds its per-order quantity limit.", 400)
            slots, stock = _locked_inventory(current_terminal, items)
            batch_ids = {row.batch_id for row in stock}
            # Catalogue metadata changes cannot alter eligibility midway through allocation.
            batches = {row.pk: row for row in ProductBatch.objects.select_for_update().filter(pk__in=batch_ids).order_by("pk")}
            slot_totals = defaultdict(int)
            for row in stock:
                slot_totals[row.terminal_slot_id] += row.quantity_on_hand
            reserved = dict(StockReservation.objects.filter(status=StockReservation.Status.ACTIVE,
                order_product__terminal_stock_id__in=[row.pk for row in stock])
                .values("order_product__terminal_stock_id").annotate(total=Sum("quantity"))
                .values_list("order_product__terminal_stock_id", "total"))
            allocations = []
            today = timezone.localdate()
            for product_id, requested in sorted(items.items()):
                remaining = requested
                candidates = sorted((row for row in stock if slots[row.terminal_slot_id].product_id == product_id),
                    key=lambda row: (batches[row.batch_id].expiry_date, row.pk))
                for row in candidates:
                    slot, batch = slots[row.terminal_slot_id], batches[row.batch_id]
                    if (not slot.is_enabled or slot_totals[slot.pk] > slot.capacity
                            or batch.product_id != product_id or batch.expiry_date < today):
                        continue
                    quantity = min(remaining, max(0, row.quantity_on_hand - reserved.get(row.pk, 0)))
                    if quantity:
                        allocations.append((products[product_id], row, quantity))
                        remaining -= quantity
                    if not remaining:
                        break
                if remaining:
                    raise AuthError("The selected Terminal no longer has enough stock. Review your cart.", 409)
            subtotal = sum((products[pk].price * quantity for pk, quantity in items.items()), Decimal("0.00"))
            if not Decimal("0.00") < subtotal <= Decimal("9999999999.99"):
                raise AuthError("The checkout amount is outside the supported range.", 400)
            order = Order.objects.create(terminal=current_terminal, customer=customer, channel=channel,
                collection_required=channel == Order.Channel.HUB,
                subtotal=subtotal, customer_payable_amount=subtotal, email_receipt_to=email,
                language=language, print_requested=print_requested, idempotency_key=str(idempotency_key),
                checkout_fingerprint=fingerprint, cart_version=str(cart_version), terminal_session_id=terminal_session_id,
                expires_at=timezone.now() + timedelta(seconds=getattr(settings, "CHECKOUT_RESERVATION_SECONDS", 900)))
            for product, row, quantity in allocations:
                line = OrderProduct.objects.create(order=order, product=product, terminal_stock=row,
                    product_name_en_snapshot=product.name_en, product_name_ar_snapshot=product.name_ar,
                    pack_description_snapshot=product.pack_description, unit_price=product.price,
                    quantity_requested=quantity, line_total=product.price * quantity)
                StockReservation.objects.create(order_product=line, quantity=quantity, expires_at=order.expires_at)
            return order
    except IntegrityError:
        # A cross-Terminal retry can race on the unique checkout key. Inspect
        # only after the failed transaction has rolled back completely.
        with transaction.atomic():
            previous = _existing_order(str(idempotency_key), fingerprint)
            if previous:
                return previous
        raise


def _receipt(order):
    if Receipt.objects.filter(order=order).exists():
        return order.receipt
    now = timezone.now()
    snapshot = {
        "order_id": str(order.pk), "order_number": order.order_number,
        "customer_id": order.customer_id, "terminal_serial": order.terminal_id,
        "terminal_name": order.terminal.display_name, "channel": order.channel,
        "currency": order.currency, "subtotal": _money(order.subtotal),
        "total": _money(order.customer_payable_amount), "total_paid": _money(order.total_paid),
        "issued_at": now.isoformat(), "simulated": True, "test_payment": True,
        "fulfilment": ("SIMULATED_COMPLETED" if order.status == Order.Status.COMPLETED
            else "CANCELLED_REFUND_PENDING" if order.status == Order.Status.CANCELLED else "AWAITING_COLLECTION"),
        "collection_deadline": order.collection_deadline.isoformat() if order.collection_deadline else None,
        "printing": print_receipt_stub(order),
        "printing_note": "Printing is simulated; no physical printer was contacted.",
        "items": [{"product_id": line.product_id, "name_en": line.product_name_en_snapshot,
            "name_ar": line.product_name_ar_snapshot, "pack_description": line.pack_description_snapshot,
            "quantity": line.quantity_requested, "unit_price": _money(line.unit_price),
            "line_total": _money(line.line_total)} for line in order.items.all()],
    }
    return Receipt.objects.create(order=order, receipt_snapshot=snapshot, next_email_at=now)


@transaction.atomic
def mark_paid(order_id, amount=None):
    """Called only after Payments verifies signature, references and full amount."""
    order = Order.objects.select_for_update(of=("self",)).select_related("terminal").get(pk=order_id)
    amount = order.customer_payable_amount if amount is None else Decimal(str(amount))
    if amount != order.customer_payable_amount:
        raise AuthError("The payment amount does not match this order.", 409)
    if order.paid_at:
        return order
    now = timezone.now()
    if order.status == Order.Status.REVIEW_REQUIRED and order.payment_uncertain:
        active_lines = StockReservation.objects.filter(order_product__order=order, status="ACTIVE",
            quantity=F("order_product__quantity_requested")).values_list("order_product_id", flat=True)
        if order.items.exists() and not order.items.exclude(pk__in=active_lines).exists():
            # This was an unpaid reconciliation hold, not a stock/dispense
            # failure. Verified late notification can resume its held purchase.
            order.status = Order.Status.PENDING
    order.total_paid = amount
    order.paid_at = now
    order.payment_uncertain = False
    if order.collection_required and order.status != Order.Status.CANCELLED:
        order.collection_deadline = now + timedelta(seconds=getattr(settings, "ORDER_COLLECTION_SECONDS", 86400))
        StockReservation.objects.filter(order_product__order=order, status=StockReservation.Status.ACTIVE).update(expires_at=order.collection_deadline)
    order.save(update_fields=["total_paid", "paid_at", "payment_uncertain", "collection_deadline", "status"])
    if order.collection_required or order.status == Order.Status.CANCELLED:
        _receipt(order)
    return order


def _cancel_locked(order, reason, *, expired=False):
    if order.status in (Order.Status.COMPLETED, Order.Status.CANCELLED):
        return order
    order.status = Order.Status.CANCELLED
    order.cancellation_reason = reason
    order.cancelled_at = timezone.now()
    order.save(update_fields=["status", "cancellation_reason", "cancelled_at"])
    StockReservation.objects.filter(order_product__order=order, status=StockReservation.Status.ACTIVE).update(
        status=StockReservation.Status.EXPIRED if expired else StockReservation.Status.RELEASED)
    # quantity_on_hand was never decremented by reservation: do not increment it.
    return order


@transaction.atomic
def cancel_order(order_id, reason="CUSTOMER_CANCELLED", *, definitive_unpaid=False):
    order = Order.objects.select_for_update().get(pk=order_id)
    if order.payment_uncertain and not order.paid_at and not definitive_unpaid:
        raise AuthError("Payment is still being checked; the order cannot be cancelled yet.", 409)
    if definitive_unpaid:
        order.payment_uncertain = False
        order.save(update_fields=["payment_uncertain"])
    return _cancel_locked(order, reason)


def fulfil_order(order_id, *, terminal=None):
    """The approved test-only dispense: consume stock once, never from redirect."""
    expired = False
    problem = None
    with transaction.atomic():
        order = Order.objects.select_for_update(of=("self",)).select_related("terminal").get(pk=order_id)
        if terminal is not None and order.terminal_id != terminal.pk:
            raise AuthError("Collect this order from its selected Terminal.", 403)
        if order.status == Order.Status.COMPLETED:
            return order
        if order.status == Order.Status.CANCELLED or not order.paid_at:
            raise AuthError("Only a paid, active order can be collected.", 409)
        if order.collection_deadline and timezone.now() >= order.collection_deadline:
            _cancel_locked(order, "COLLECTION_EXPIRED", expired=True)
            expired = True
        else:
            lines = list(order.items.select_related("product").order_by("pk"))
            slots, stocks = _locked_inventory(order.terminal, {line.product_id for line in lines})
            stocks = {row.pk: row for row in stocks}
            active = {reservation.order_product_id: reservation for reservation in
                StockReservation.objects.select_for_update().filter(order_product__order=order,
                    status=StockReservation.Status.ACTIVE).order_by("pk")}
            slot_totals = defaultdict(int)
            for row in stocks.values():
                slot_totals[row.terminal_slot_id] += row.quantity_on_hand
            reserved = dict(StockReservation.objects.filter(status=StockReservation.Status.ACTIVE,
                order_product__terminal_stock_id__in=stocks).values("order_product__terminal_stock_id")
                .annotate(total=Sum("quantity")).values_list("order_product__terminal_stock_id", "total"))
            for line in lines:
                row, reservation = stocks.get(line.terminal_stock_id), active.get(line.pk)
                if (order.terminal.is_disabled or row is None or reservation is None
                        or reservation.quantity != line.quantity_requested
                        or row.quantity_on_hand < line.quantity_requested
                        or row.quantity_on_hand < reserved.get(row.pk, 0)
                        or not slots[row.terminal_slot_id].is_enabled
                        or slot_totals[row.terminal_slot_id] > slots[row.terminal_slot_id].capacity
                        or slots[row.terminal_slot_id].product_id != line.product_id
                        or row.batch.product_id != line.product_id
                        or row.batch.expiry_date < timezone.localdate()):
                    problem = "Reserved stock cannot be safely fulfilled; this order requires review."
                    break
            if problem:
                order.status = Order.Status.REVIEW_REQUIRED
                order.save(update_fields=["status"])
            else:
                now = timezone.now()
                order.status = Order.Status.DISPENSING
                order.save(update_fields=["status"])
                for line in lines:
                    TerminalStock.objects.filter(pk=line.terminal_stock_id).update(
                        quantity_on_hand=F("quantity_on_hand") - line.quantity_requested, updated_at=now)
                    line.quantity_dispensed = line.quantity_requested
                    line.dispense_status = OrderProduct.DispenseStatus.SUCCEEDED
                    line.dispense_command_id = uuid4()
                    line.dispense_confirmed_at = now
                    line.save(update_fields=["quantity_dispensed", "dispense_status", "dispense_command_id", "dispense_confirmed_at"])
                StockReservation.objects.filter(pk__in=[row.pk for row in active.values()]).update(status=StockReservation.Status.CONSUMED)
                order.status = Order.Status.COMPLETED
                order.completed_at = now
                order.save(update_fields=["status", "completed_at"])
                _receipt(order)
    # Persist deadline/review decisions even though the HTTP operation is rejected.
    if expired:
        raise AuthError("The collection deadline has passed. A refund is being processed.", 409)
    if problem:
        raise AuthError(problem, 409)
    return order


def expire_orders(*, now=None):
    """Release definitive unpaid checkouts or expired paid Hub collections.

    Payments' worker owns provider reconciliation and durable refunds. An
    uncertain or already captured payment is never assumed to have failed.
    """
    now = now or timezone.now()
    candidates = Order.objects.filter(status__in=[Order.Status.PENDING, Order.Status.REVIEW_REQUIRED]).filter(
        _expirable(now)).values_list("pk", flat=True)
    expired = []
    for order_id in list(candidates):
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order_id)
            if order.status not in (Order.Status.PENDING, Order.Status.REVIEW_REQUIRED):
                continue
            collection_expired = order.paid_at and order.collection_deadline and order.collection_deadline <= now
            checkout_expired = (order.status == Order.Status.PENDING and not order.paid_at
                and not order.payment_uncertain and order.expires_at <= now)
            if collection_expired or checkout_expired:
                _cancel_locked(order, "COLLECTION_EXPIRED" if collection_expired else "CHECKOUT_EXPIRED", expired=True)
                expired.append(order)
    return expired


def _expirable(now):
    from django.db.models import Q
    return (Q(paid_at__isnull=False, collection_deadline__lte=now)
            | Q(status=Order.Status.PENDING, paid_at__isnull=True, payment_uncertain=False, expires_at__lte=now))


def order_data(order):
    order = Order.objects.select_related("terminal").prefetch_related("items", "receipt").get(pk=order.pk)
    receipt = getattr(order, "receipt", None)
    stamp = lambda value: value.isoformat() if value else None
    payment = order.payments.filter(operation="CAPTURE").first()
    if order.paid_at:
        payment_state = "PAID"
    elif order.status == Order.Status.CANCELLED:
        payment_state = "EXPIRED" if order.cancellation_reason == "CHECKOUT_EXPIRED" else "FAILED"
    elif order.status == Order.Status.REVIEW_REQUIRED or order.expires_at <= timezone.now() or (payment and not payment.checkout_url):
        payment_state = "CHECKING_PAYMENT"
    else:
        payment_state = "AWAITING_PAYMENT"
    return {
        "id": str(order.pk), "order_number": order.order_number, "status": order.status,
        "channel": order.channel, "customer_id": order.customer_id,
        "collection_required": order.collection_required, "payment_state": payment_state,
        "cart_preserved": order.cart_preserved,
        "can_resume": bool(payment_state == "AWAITING_PAYMENT" and payment and payment.checkout_url
            and payment.status not in ("SUCCEEDED", "FAILED")),
        "terminal": {"serial_number": order.terminal_id, "display_name": order.terminal.display_name,
            "address_en": order.terminal.address_en, "address_ar": order.terminal.address_ar},
        "currency": order.currency, "subtotal": _money(order.subtotal),
        "total": _money(order.customer_payable_amount), "customer_payable_amount": _money(order.customer_payable_amount),
        "total_paid": _money(order.total_paid), "total_refunded": _money(order.total_refunded),
        "email_receipt_to": order.email_receipt_to, "language": order.language,
        "print_requested": order.print_requested, "created_at": stamp(order.created_at),
        "expires_at": stamp(order.expires_at), "paid_at": stamp(order.paid_at),
        "collection_deadline": stamp(order.collection_deadline), "completed_at": stamp(order.completed_at),
        "cancellation_reason": order.cancellation_reason, "simulated": True,
        "items": [{"id": line.pk, "product_id": line.product_id, "name_en": line.product_name_en_snapshot,
            "name_ar": line.product_name_ar_snapshot, "pack_description": line.pack_description_snapshot,
            "unit_price": _money(line.unit_price), "quantity_requested": line.quantity_requested,
            "quantity_dispensed": line.quantity_dispensed, "line_total": _money(line.line_total),
            "dispense_status": line.dispense_status} for line in order.items.all()],
        "receipt": {"id": str(receipt.pk), "receipt_number": receipt.receipt_number,
            "issued_at": stamp(receipt.issued_at), "snapshot": receipt.receipt_snapshot,
            "email_sent_at": stamp(receipt.email_sent_at)} if receipt else None,
    }
