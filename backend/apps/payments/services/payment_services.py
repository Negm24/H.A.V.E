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
from apps.orders.services.order_services import mark_paid, fulfil_order, cancel_order
from apps.payments.models import PaymentTransaction
from apps.payments.security.return_authorization import require_checkout_session
from apps.terminals.models import Terminal
from . import kashier_services as provider


def start_checkout(order, *, simulator_id=""):
    provider.configuration()
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
            raise AuthError("This payment is being checked. Open Order History; do not start another payment.", 409)
        payment.return_token_hash = token_hash(raw_ticket) if raw_ticket else ""
        payment.return_credential_hash = order.terminal.device_credential_hash
        payment.simulator_id = simulator_id
        payment.attempts = 1
        payment.lease_until = timezone.now() + timedelta(seconds=60)
        payment.next_attempt_at = timezone.now() + timedelta(seconds=20)
        payment.save()
        order.payment_uncertain = True
        order.save(update_fields=["payment_uncertain"])
    public = settings.PAYMENTS_PUBLIC_BASE_URL
    if order.channel == "HUB":
        return_url = f"{public}/orders/{order.pk}?payment=return"
    else:
        return_url = "http://localhost:5173/payment-return?" + urlencode({"order_id": str(order.pk), "terminal": simulator_id})
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


def _claim(payment_id):
    # Claim work durably; provider I/O happens after this transaction commits.
    with transaction.atomic():
        order_id = PaymentTransaction.objects.values_list("order_id", flat=True).get(pk=payment_id)
        Order.objects.select_for_update().get(pk=order_id)
        payment = PaymentTransaction.objects.select_for_update().select_related("order").get(pk=payment_id)
        now = timezone.now()
        if payment.lease_until and payment.lease_until > now:
            return None
        if payment.status in ("SUCCEEDED", "FAILED"):
            return None
        payment.lease_until = now + timedelta(seconds=60)
        payment.next_attempt_at = now + timedelta(seconds=30)
        payment.attempts += 1
        payment.save(update_fields=["lease_until", "next_attempt_at", "attempts"])
        return payment


def reconcile(payment_id):
    payment = _claim(payment_id)
    if payment is None:
        return
    try:
        result = provider.verify_order(payment.order, payment.session_id)
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=payment.order_id)
            current = PaymentTransaction.objects.select_for_update().get(pk=payment.pk)
            if current.status in ("SUCCEEDED", "FAILED") or current.attempts != payment.attempts:
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
                cancel_order(order.pk, "PAYMENT_FAILED", definitive_unpaid=True)
            else:
                current.status = "UNKNOWN"
                if not current.session_id and order.expires_at <= timezone.now():
                    current.last_error = "Session creation outcome unknown. Owner must recover its Kashier session ID and reconcile."
                    order.status = "REVIEW_REQUIRED"
                    order.save(update_fields=["status"])
                current.save()
        # Mock hardware is still a separate idempotent domain operation.
        order.refresh_from_db()
        if order.paid_at and order.channel == "TERMINAL" and order.status == "PENDING":
            fulfil_order(order.pk)
    except (provider.ProviderUnavailable, AuthError):
        PaymentTransaction.objects.filter(pk=payment.pk, attempts=payment.attempts).exclude(status__in=["SUCCEEDED", "FAILED"]).update(
            lease_until=None, last_error="Provider reconciliation or fulfilment requires review.")


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
        if capture and capture.session_id:
            provider.abandon_session(capture.session_id)
            reconcile(capture.pk)
            order.refresh_from_db()
    if order.status == "COMPLETED":
        raise AuthError("A completed order cannot be cancelled.", 409)
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
