"""Durable payment attempts. Never repeat an uncertain provider mutation."""
from datetime import timedelta
from decimal import Decimal
import secrets
from urllib.parse import urlencode

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.accounts.security.tokens import token_hash
from apps.orders.models import Order
from apps.orders.services.errors import CheckoutConflict
from apps.orders.services.order_services import mark_paid, fulfil_order, cancel_order
from apps.payments.models import PaymentTransaction
from apps.payments.security.return_authorization import (
    require_checkout_session, require_terminal_session, terminal_session_active,
)
from apps.terminals.models import Terminal
from . import kashier_services as provider


def start_checkout(order, *, simulator_id=""):
    provider.checkout_base_url(order.channel)
    public = provider.checkout_base_url("HUB")
    if simulator_id and (len(simulator_id) != 32 or any(c not in "0123456789abcdef" for c in simulator_id)):
        raise AuthError("Invalid Terminal simulator selector.", 400)
    raw_ticket = secrets.token_urlsafe(32) if order.channel == "TERMINAL" else ""
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.status != "PENDING" or order.paid_at or order.expires_at <= timezone.now():
            raise AuthError("This checkout has ended. Review Order History before starting another purchase.", 409)
        if order.channel == "TERMINAL":
            # Keep Order -> Terminal -> Payment, matching fulfilment's lock
            # ordering. Session start/end take Terminal -> Payment only.
            terminal = Terminal.objects.select_for_update().get(pk=order.terminal_id)
            require_checkout_session(order, terminal)
        payment, created = PaymentTransaction.objects.get_or_create(order=order, operation="CAPTURE",
            defaults={"amount": order.customer_payable_amount, "idempotency_key": f"capture:{order.pk}"})
        if payment.checkout_url:
            # The original HTTP response may have been lost before its cookie
            # reached the Terminal. Reissue only this authorized order scope;
            # never create another provider session or revive an expired view.
            if raw_ticket and not payment.return_started_at and not payment.return_ended_at:
                payment.return_token_hash = token_hash(raw_ticket)
                payment.save(update_fields=["return_token_hash"])
                return payment, raw_ticket
            return payment, None
        if not created:
            raise CheckoutConflict("This payment is being checked. Do not start another payment.", "PAYMENT_CHECKING", order.pk)
        payment.return_token_hash = token_hash(raw_ticket) if raw_ticket else ""
        payment.return_credential_hash = order.terminal.device_credential_hash
        payment.simulator_id = simulator_id
        payment.return_app = order.channel
        payment.return_terminal_session_id = order.terminal_session_id
        payment.attempts = 1
        payment.lease_until = timezone.now() + timedelta(seconds=60)
        payment.next_attempt_at = timezone.now() + timedelta(seconds=20)
        payment.save()
        order.payment_uncertain = True
        order.save(update_fields=["payment_uncertain"])
    # A standard-port provider return is separate from the authorised app
    # destination. In particular, Kashier need not accept Kiosk's dev :8443.
    return_url = f"{public}/api/v1/payments/return/{order.pk}/"
    try:
        session_id, checkout_url = provider.create_session(order, return_url)
    except provider.ProviderUnavailable as exc:
        with transaction.atomic():
            locked = Order.objects.select_for_update().get(pk=order.pk)
            payment = PaymentTransaction.objects.select_for_update().get(pk=payment.pk)
            payment.status = "FAILED" if exc.definitive else "UNKNOWN"
            payment.last_error = "Provider rejected configuration." if exc.definitive else "Session creation outcome unknown; reconciliation required."
            payment.lease_until = None
            payment.save()
            if exc.definitive:
                locked.payment_uncertain = False
                locked.save(update_fields=["payment_uncertain"])
                cancel_order(order.pk, "PAYMENT_FAILED", definitive_unpaid=True)
        raise
    with transaction.atomic():
        Order.objects.select_for_update().get(pk=order.pk)
        payment = PaymentTransaction.objects.select_for_update().get(pk=payment.pk)
        payment.session_id, payment.checkout_url = session_id, checkout_url
        payment.lease_until = None
        payment.save()
    return payment, raw_ticket


def _claim(payment_id, *, force=False):
    # Claim work durably; provider I/O happens after this transaction commits.
    with transaction.atomic():
        order_id = PaymentTransaction.objects.values_list("order_id", flat=True).get(pk=payment_id)
        Order.objects.select_for_update().get(pk=order_id)
        payment = PaymentTransaction.objects.select_for_update().select_related("order").get(pk=payment_id)
        now = timezone.now()
        if payment.lease_until and payment.lease_until > now:
            return None
        if payment.status == "SUCCEEDED" or (payment.status == "FAILED" and not force):
            return None
        payment.lease_until = now + timedelta(seconds=60)
        payment.next_attempt_at = now + timedelta(seconds=30)
        payment.attempts += 1
        payment.save(update_fields=["lease_until", "next_attempt_at", "attempts"])
        return payment


def reconcile(payment_id, *, force=False):
    payment = _claim(payment_id, force=force)
    if payment is None:
        return
    try:
        result = provider.verify_order(payment.order, payment.session_id)
        # Closing is safe only after checking whether the provider captured.
        # A timeout remains UNKNOWN with allocations held for reconciliation.
        if (result["state"] == "UNKNOWN" and payment.session_id
                and payment.order.expires_at <= timezone.now() and payment.order.status != "CANCELLED"):
            provider.abandon_session(payment.session_id)
            result = provider.verify_order(payment.order, payment.session_id)
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=payment.order_id)
            current = PaymentTransaction.objects.select_for_update().get(pk=payment.pk)
            if current.status == "SUCCEEDED" or (current.status == "FAILED" and not force) or current.attempts != payment.attempts:
                return
            current.lease_until = None
            current.last_error = ""
            if not current.session_id and result.get("session_id"):
                current.session_id = result["session_id"]
                current.checkout_url = result["checkout_url"]
            if result["state"] == "PAID":
                current.status = "SUCCEEDED"
                current.provider_reference = result["provider_reference"]
                current.completed_at = timezone.now()
                current.save()
                mark_paid(order.pk, current.amount)
            elif result["state"] == "FAILED":
                current.status = "FAILED"
                current.completed_at = timezone.now()
                current.save()
                cancel_order(order.pk, "CHECKOUT_EXPIRED" if order.expires_at <= timezone.now() else "PAYMENT_FAILED", definitive_unpaid=True)
            else:
                current.status = "UNKNOWN"
                if order.expires_at <= timezone.now():
                    current.last_error = "Expired checkout payment outcome unknown; reconciliation required."
                    order.status = "REVIEW_REQUIRED"
                    order.save(update_fields=["status"])
                current.save()
        # Mock hardware is still a separate idempotent domain operation.
        order.refresh_from_db()
        if order.paid_at and order.status == "CANCELLED":
            request_refund(order)
        elif order.paid_at and not order.collection_required and order.status == "PENDING":
            fulfil_paid_terminal(order.pk)
        return result
    except (provider.ProviderUnavailable, AuthError):
        PaymentTransaction.objects.filter(pk=payment.pk, attempts=payment.attempts).exclude(status__in=["SUCCEEDED", "FAILED"]).update(
            lease_until=None, last_error="Provider reconciliation or fulfilment requires review.")
        return None


def _require_collection_locked(order):
    """Safe collection fallback; only explicit unpaid Kiosk resume can undo it."""
    if order.collection_required or order.status in ("COMPLETED", "CANCELLED"):
        return
    order.collection_required = True
    if order.paid_at and order.status != "CANCELLED":
        order.collection_deadline = order.paid_at + timedelta(seconds=getattr(settings, "ORDER_COLLECTION_SECONDS", 86400))
        from apps.orders.models import StockReservation
        StockReservation.objects.filter(order_product__order=order, status="ACTIVE").update(expires_at=order.collection_deadline)
    order.save(update_fields=["collection_required", "collection_deadline"])
    if order.paid_at:
        from apps.orders.services.order_services import _receipt
        _receipt(order)


def fulfil_paid_terminal(order_id):
    """Only the latest explicitly authorised live Kiosk session may dispense."""
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        if order.collection_required or order.status != "PENDING" or not order.paid_at:
            return order
        terminal = Terminal.objects.select_for_update().get(pk=order.terminal_id)
        capture = order.payments.filter(operation="CAPTURE").first()
        bound_session = (capture.return_terminal_session_id if capture else None) or order.terminal_session_id
        app = (capture.return_app if capture else "") or order.channel
        if app != "TERMINAL" or not terminal_session_active(terminal, bound_session, order.customer_id):
            if order.customer_id:
                _require_collection_locked(order)
            else:
                order.status = "REVIEW_REQUIRED"
                order.save(update_fields=["status"])
            return order
        return fulfil_order(order.pk)


def resume_checkout(order, *, user_id, app, terminal=None, session_id=None, simulator_id=""):
    """Re-authorise one existing attempt, never POST another provider session."""
    if app not in ("HUB", "TERMINAL"):
        raise AuthError("Invalid checkout application.", 400)
    provider.checkout_base_url(app)
    if simulator_id and (len(simulator_id) != 32 or any(c not in "0123456789abcdef" for c in simulator_id)):
        raise AuthError("Invalid Terminal simulator selector.", 400)
    with transaction.atomic():
        locked = Order.objects.select_for_update(of=("self",)).select_related("customer__user").get(pk=order.pk)
        if locked.customer_id:
            if user_id != locked.customer_id:
                raise AuthError("This checkout does not belong to this customer.", 403)
        elif app != "TERMINAL" or user_id is not None or str(session_id) != str(locked.terminal_session_id):
            raise AuthError("Guest checkout belongs to its original Terminal session.", 403)
        if app == "TERMINAL":
            if terminal is None or terminal.pk != locked.terminal_id:
                raise AuthError("Continue this checkout at its selected Terminal.", 403)
            current_terminal = Terminal.objects.select_for_update().get(pk=terminal.pk)
            require_terminal_session(current_terminal, session_id, user_id)
        if locked.customer_id and app == "HUB":
            _require_collection_locked(locked)
        capture = PaymentTransaction.objects.filter(order=locked, operation="CAPTURE").first()
        if capture is None:
            raise AuthError("This checkout has no recoverable payment attempt. Cancel it before starting again.", 409)
    if app == "TERMINAL" and not locked.paid_at and locked.status == "PENDING" and locked.expires_at > timezone.now():
        if locked.customer_id and not provider.saved_cards(locked.customer):
            raise AuthError("Save a card during a Hub purchase before paying as a signed-in Terminal customer.", 400)
        # Explicit Continue payment at the assigned physical machine authorises
        # immediate fulfilment in THIS live session, regardless of original app.
        # Commit the binding before verification/callback can mark payment paid.
        with transaction.atomic():
            current = Order.objects.select_for_update().get(pk=locked.pk)
            machine = Terminal.objects.select_for_update().get(pk=current.terminal_id)
            require_terminal_session(machine, session_id, user_id)
            payment = PaymentTransaction.objects.select_for_update().get(pk=capture.pk)
            if not current.paid_at and current.status == "PENDING" and current.expires_at > timezone.now():
                current.collection_required = False
                current.collection_deadline = None
                current.save(update_fields=["collection_required", "collection_deadline"])
                payment.return_app = "TERMINAL"
                payment.return_terminal_session_id = session_id
                payment.save(update_fields=["return_app", "return_terminal_session_id"])
    # Owner checks and collection conversion commit BEFORE provider I/O, so a
    # concurrent callback cannot cause unattended dispensing on remote resume.
    if not locked.paid_at and locked.status != "CANCELLED":
        verified = reconcile(capture.pk, force=True)
        if verified is None:
            capture.refresh_from_db()
            if capture.status != "SUCCEEDED" and locked.expires_at > timezone.now():
                raise AuthError("Payment status is being checked. Try Order History again shortly; do not start another payment.", 503)
    locked.refresh_from_db()
    capture.refresh_from_db()
    if locked.paid_at or locked.status != "PENDING" or locked.expires_at <= timezone.now():
        return capture, None
    if not capture.checkout_url or not provider.valid_checkout_url(capture.checkout_url):
        return capture, None
    if Terminal.objects.get(pk=locked.terminal_id).is_disabled:
        raise AuthError("This Terminal is disabled. Cancel this unpaid checkout or wait until it is available.", 409)
    raw_ticket = secrets.token_urlsafe(32) if app == "TERMINAL" else None
    with transaction.atomic():
        locked = Order.objects.select_for_update().get(pk=locked.pk)
        current_terminal = Terminal.objects.select_for_update().get(pk=locked.terminal_id)
        if app == "TERMINAL":
            require_terminal_session(current_terminal, session_id, user_id)
        capture = PaymentTransaction.objects.select_for_update().get(pk=capture.pk)
        if locked.paid_at or locked.status != "PENDING" or locked.expires_at <= timezone.now() or capture.status in ("SUCCEEDED", "FAILED"):
            return capture, None
        if current_terminal.is_disabled:
            raise AuthError("This Terminal is disabled. Cancel this unpaid checkout or wait until it is available.", 409)
        capture.return_app = app
        capture.return_terminal_session_id = session_id if app == "TERMINAL" else None
        capture.return_token_hash = token_hash(raw_ticket) if raw_ticket else ""
        capture.return_credential_hash = current_terminal.device_credential_hash if app == "TERMINAL" else ""
        capture.return_started_at = None
        capture.return_ended_at = None if app == "TERMINAL" else timezone.now()
        capture.simulator_id = simulator_id if app == "TERMINAL" else ""
        capture.save(update_fields=["return_app", "return_terminal_session_id", "return_token_hash", "return_credential_hash",
            "return_started_at", "return_ended_at", "simulator_id"])
    return capture, raw_ticket


def payment_return_destination(order_id):
    """The browser's query string has no authority over either payment or target."""
    payment = PaymentTransaction.objects.select_related("order").filter(order_id=order_id, operation="CAPTURE").first()
    if payment is None:
        raise AuthError("Unknown checkout.", 404)
    app = payment.return_app or payment.order.channel
    origin = provider.checkout_base_url(app)
    if app == "HUB":
        return f"{origin}/orders/{order_id}?payment=return"
    return origin + "/payment-return?" + urlencode({"order_id": str(order_id), "terminal": payment.simulator_id})


def request_refund(order):
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.status != "CANCELLED" or not order.paid_at or not order.total_paid:
            return None
        capture = PaymentTransaction.objects.filter(order=order, operation="CAPTURE", status="SUCCEEDED").first()
        if capture is None:
            return None
        refund, _ = PaymentTransaction.objects.get_or_create(order=order, operation="REFUND", defaults={
            "amount": order.total_paid, "related_transaction": capture, "idempotency_key": f"refund:{order.pk}"})
        return refund


def cancel_purchase(order, *, reason="CUSTOMER_CANCELLED"):
    order.refresh_from_db()
    if not order.paid_at and order.payment_uncertain:
        capture = order.payments.filter(operation="CAPTURE").first()
        if capture and not capture.session_id:
            # Recover a lost response (or prove an expired creation absent)
            # before deciding whether there is a provider session to close.
            reconcile(capture.pk, force=True)
            capture.refresh_from_db()
            order.refresh_from_db()
        if capture and capture.session_id:
            provider.abandon_session(capture.session_id)
            reconcile(capture.pk, force=True)
            order.refresh_from_db()
    if order.status == "COMPLETED":
        raise AuthError("A completed order cannot be cancelled.", 409)
    if order.payment_uncertain and not order.paid_at:
        raise CheckoutConflict("Payment verification is still pending. Cancellation is not confirmed. Do not pay again.",
            "PAYMENT_CHECKING", order.pk)
    # Still uncertain? Domain refuses cancellation and keeps reservations.
    order = cancel_order(order.pk, reason)
    request_refund(order)
    return order


def process_refund(payment_id):
    payment = _claim(payment_id)
    if payment is None:
        return
    capture = payment.related_transaction
    try:
        if payment.attempts == 1:
            # Lease/attempt is persisted before the call. A crash or timeout is
            # read/reconcile-only afterwards; never issue a second refund blindly.
            response = provider.refund(capture.provider_reference, payment.amount)
            state = {"SUCCESS": "SUCCEEDED", "FAILURE": "FAILED"}.get(response.get("status"), "UNKNOWN")
            reference = response.get("transactionId")
        else:
            state = provider.refund_state(payment.order, capture.provider_reference, payment.provider_reference, payment.amount)
            reference = payment.provider_reference
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=payment.order_id)
            current = PaymentTransaction.objects.select_for_update().get(pk=payment.pk)
            if current.status in ("SUCCEEDED", "FAILED") or current.attempts != payment.attempts:
                return
            current.status, current.lease_until = state, None
            current.provider_reference = reference or None
            current.last_error = "Refund requires owner review." if state == "FAILED" else ""
            if state in ("SUCCEEDED", "FAILED"):
                current.completed_at = timezone.now()
            current.save()
            if state == "SUCCEEDED":
                order.total_refunded = payment.amount
                order.save(update_fields=["total_refunded"])
    except provider.ProviderUnavailable:
        PaymentTransaction.objects.filter(pk=payment.pk, attempts=payment.attempts).exclude(status__in=["SUCCEEDED", "FAILED"]).update(status="UNKNOWN", lease_until=None,
            last_error="Refund outcome unknown; reconciliation required. Do not resubmit.")
