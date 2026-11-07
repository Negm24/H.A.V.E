from uuid import uuid4
import json
import math
import secrets
import time

from django.conf import settings
from django.db import transaction

from apps.accounts.models import User
from apps.accounts.security.errors import AuthError
from apps.accounts.security.permissions import eligible_customer
from apps.accounts.security.tokens import token_hash
from apps.terminals.security.state import execute_transition
from apps.terminals.models import Terminal


def operate(terminal, mode, raw_token="", *, user=None, qr_proof=None):
    if mode in {"start", "activity"}:
        # The service boundary owns this lock as well as HTTP callers. This
        # serializes any session creation/renewal against maintenance and host
        # service claims, including recovery workers and future callers.
        with transaction.atomic():
            current = Terminal.objects.select_for_update().get(pk=terminal.pk)
            return _operate(current, mode, raw_token, user=user)
    if mode != "login":
        return _operate(terminal, mode, raw_token, user=user)
    if not eligible_customer(user):
        raise AuthError()
    verified_version = getattr(user, "_authenticated_credential_version",
                               user.customer.credential_changed_at.isoformat())
    with transaction.atomic():
        current = User.objects.select_for_update().get(pk=user.pk)
        if (not eligible_customer(current)
                or current.customer.credential_changed_at.isoformat() != verified_version):
            raise AuthError("Credentials changed. Sign in again.")
        current_terminal = Terminal.objects.select_for_update().get(pk=terminal.pk)
        return _operate(current_terminal, mode, raw_token, user=current, qr_proof=qr_proof)


def _operate(terminal, mode, raw_token="", *, user=None, qr_proof=None):
    if mode != "end":
        from .maintenance import require_customer_access
        require_customer_access(terminal)
    now = time.time()
    new_token = secrets.token_urlsafe(32) if mode in ("start", "login") else None
    update = {}
    if mode == "start":
        update = dict(session_id=str(uuid4()), terminal_serial=terminal.pk,
                      credential_hash=terminal.device_credential_hash,
                      user_id=None, token_hash=token_hash(new_token), started_at=now, last_activity_at=now)
    elif mode == "login":
        if not eligible_customer(user):
            raise AuthError()
        update = dict(user_id=user.pk, token_hash=token_hash(new_token),
                      credential_version=user.customer.credential_changed_at.isoformat())
    result = execute_transition(terminal, mode, now, raw_token, update, qr_proof=qr_proof)
    if not result:
        raise AuthError("Terminal session expired, replaced or invalid. Start a new session.")
    return json.loads(result), new_token


def session_user(state):
    if not state["user_id"]:
        return None
    user = User.objects.select_related("customer").filter(pk=state["user_id"], account_type="CUSTOMER").first()
    if not eligible_customer(user):
        raise AuthError("Customer access is no longer available.")
    if state.get("credential_version") != user.customer.credential_changed_at.isoformat():
        raise AuthError("Credentials changed. Sign in again.")
    return user


def session_response(state, token=None):
    remaining = min(
        settings.TERMINAL_IDLE_SECONDS - (time.time() - state["last_activity_at"]),
        settings.TERMINAL_MAX_SECONDS - (time.time() - state["started_at"]),
    )
    result = {"session_id": state["session_id"], "idle_expires_in": max(0, math.ceil(remaining))}
    if token:
        result.update(session_token=token, token_type="Bearer")
    # Deliberately do not expose the fixed maximum as a user-facing countdown.
    return result
