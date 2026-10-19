"""Explicit, single-use return to the same live Terminal session after payment."""
import json
import math
import secrets
import time

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.accounts.security.state import get_redis_client
from apps.orders.models import Order
from apps.payments.security.return_authorization import return_payment, terminal_session_active
from apps.terminals.models import Terminal
from apps.terminals.security.state import session_key, payment_return_transition
from apps.terminals.services.session_services import session_user, session_response


def can_continue(payment, terminal):
    return bool(payment.order.paid_at and payment.order.status == "COMPLETED"
        and terminal_session_active(terminal, payment.return_terminal_session_id or payment.order.terminal_session_id,
            payment.order.customer_id))


@transaction.atomic
def finish_return(request, order_id, terminal, *, continue_session=False):
    # Match the established Order -> Terminal -> Payment lock direction.
    if not Order.objects.select_for_update().filter(pk=order_id, terminal=terminal).first():
        raise AuthError("This payment result is no longer available.")
    terminal = Terminal.objects.select_for_update().get(pk=terminal.pk)
    payment = return_payment(request, order_id, terminal, allow_expired=not continue_session)
    identifier = payment.return_terminal_session_id or payment.order.terminal_session_id
    response, user = None, None
    if continue_session:
        if not can_continue(payment, terminal):
            raise AuthError("The original session ended. Sign in again; payment is not affected.", 409)
        raw = get_redis_client().get(session_key(terminal.pk))
        state = json.loads(raw) if raw else None
        if state is None:
            raise AuthError("The original session ended. Sign in again.", 409)
        user = session_user(state)  # Recheck account state and PIN credential version.
        token = secrets.token_urlsafe(32)
        state = payment_return_transition(terminal, session_id=identifier, user_id=payment.order.customer_id,
            credential_version=state.get("credential_version"), new_token=token)
        if state is None:
            raise AuthError("The original session ended or was replaced. Sign in again.", 409)
        response = session_response(state, token) | {"language": payment.order.language,
            "session_expires_in": max(0, math.floor(settings.TERMINAL_MAX_SECONDS - (time.time() - state["started_at"])))}
    else:
        payment_return_transition(terminal, session_id=identifier, user_id=payment.order.customer_id,
            credential_version="")
    payment.return_ended_at = timezone.now()
    payment.return_token_hash = ""
    payment.save(update_fields=["return_ended_at", "return_token_hash"])
    return response, user
