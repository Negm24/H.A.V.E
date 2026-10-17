from datetime import timedelta
import json
import time
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from apps.accounts.security.errors import AuthError
from apps.accounts.security.tokens import token_hash
from apps.payments.models import PaymentTransaction
from apps.accounts.security.state import get_redis_client
from apps.terminals.security.state import session_key


def cookie_name(order_id):
    return "have_payment_" + str(order_id).replace("-", "")


def revoke_terminal_results(terminal):
    """A new visitor must never reopen the previous visitor's receipt URL."""
    PaymentTransaction.objects.filter(order__terminal=terminal, order__channel="TERMINAL", operation="CAPTURE",
        return_ended_at__isnull=True).exclude(return_token_hash="").update(return_ended_at=timezone.now())


def require_checkout_session(order, terminal):
    """Check while holding Terminal's row lock, before issuing any new ticket.

    Session start/end take that same lock. A previously issued receipt ticket
    deliberately does not depend on Redis afterwards, so ordinary auth expiry
    cannot hide the outcome of an already-started payment.
    """
    raw = get_redis_client().get(session_key(terminal.pk))
    try:
        state = json.loads(raw) if raw else None
        now = time.time()
        valid = (not terminal.is_disabled and order.terminal_session_id and isinstance(state, dict)
            and state.get("session_id") == str(order.terminal_session_id)
            and state.get("credential_hash") == terminal.device_credential_hash
            and state.get("user_id") == order.customer_id
            and now - state["started_at"] < settings.TERMINAL_MAX_SECONDS
            and now - state["last_activity_at"] < settings.TERMINAL_IDLE_SECONDS)
    except (TypeError, ValueError, KeyError):
        valid = False
    if not valid:
        raise AuthError("The original Terminal session ended or was replaced. Start a new purchase.", 401)


@transaction.atomic
def return_payment(request, order_id, terminal):
    payment = PaymentTransaction.objects.select_for_update(of=("self",)).select_related("order").filter(order_id=order_id, operation="CAPTURE",
        order__terminal=terminal, order__channel="TERMINAL").first()
    raw = request.COOKIES.get(cookie_name(order_id), "")
    now = timezone.now()
    if (payment is None or not raw or payment.return_ended_at or payment.created_at + timedelta(minutes=30) <= now
            or payment.return_credential_hash != terminal.device_credential_hash
            or not constant_time_compare(token_hash(raw), payment.return_token_hash)):
        raise AuthError("This payment result is no longer available. Start over.", 401)
    if payment.return_started_at is None:
        PaymentTransaction.objects.filter(pk=payment.pk, return_started_at__isnull=True).update(return_started_at=now)
        payment.refresh_from_db()
    if payment.return_started_at + timedelta(seconds=60) <= now:
        raise AuthError("The receipt screen expired. Start over.", 401)
    return payment
