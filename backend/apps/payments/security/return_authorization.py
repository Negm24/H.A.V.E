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
    PaymentTransaction.objects.filter(order__terminal=terminal, operation="CAPTURE",
        return_ended_at__isnull=True).exclude(return_token_hash="").update(return_ended_at=timezone.now())


def terminal_session_active(terminal, session_id, customer_id):
    """Read liveness without touching either authentication deadline."""
    raw = get_redis_client().get(session_key(terminal.pk))
    try:
        state = json.loads(raw) if raw else None
        now = time.time()
        return bool(not terminal.is_disabled and session_id and isinstance(state, dict)
            and state.get("session_id") == str(session_id)
            and state.get("credential_hash") == terminal.device_credential_hash
            and state.get("user_id") == customer_id
            and now - state["started_at"] < settings.TERMINAL_MAX_SECONDS
            and now - state["last_activity_at"] < settings.TERMINAL_IDLE_SECONDS)
    except (TypeError, ValueError, KeyError):
        return False


def require_terminal_session(terminal, session_id, customer_id):
    if not terminal_session_active(terminal, session_id, customer_id):
        raise AuthError("The Terminal session ended or was replaced. Sign in again to continue this purchase.", 401)


def require_checkout_session(order, terminal):
    """Check while holding Terminal's row lock, before issuing any new ticket.

    Session start/end take that same lock. A previously issued receipt ticket
    deliberately does not depend on Redis afterwards, so ordinary auth expiry
    cannot hide the outcome of an already-started payment.
    """
    if not terminal_session_active(terminal, order.terminal_session_id, order.customer_id):
        raise AuthError("The original Terminal session ended or was replaced. Start a new purchase.", 401)


@transaction.atomic
def return_payment(request, order_id, terminal, *, allow_expired=False):
    payment = PaymentTransaction.objects.select_for_update(of=("self",)).select_related("order").filter(order_id=order_id, operation="CAPTURE",
        order__terminal=terminal).first()
    raw = request.COOKIES.get(cookie_name(order_id), "")
    now = timezone.now()
    if (payment is None or (payment.return_app or payment.order.channel) != "TERMINAL"
            or not raw or payment.return_ended_at or payment.created_at + timedelta(minutes=30) <= now
            or payment.return_credential_hash != terminal.device_credential_hash
            or not constant_time_compare(token_hash(raw), payment.return_token_hash)):
        raise AuthError("This payment result is no longer available. Start over.", 401)
    if payment.return_started_at is None:
        PaymentTransaction.objects.filter(pk=payment.pk, return_started_at__isnull=True).update(return_started_at=now)
        payment.refresh_from_db()
    if not allow_expired and payment.return_started_at + timedelta(seconds=60) <= now:
        raise AuthError("The receipt screen expired. Start over.", 401)
    return payment
