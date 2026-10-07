from uuid import uuid4
import json
import math
import secrets
import time

from django.conf import settings

from apps.accounts.models import User
from apps.accounts.security.errors import AuthError
from apps.accounts.security.permissions import eligible_customer
from apps.accounts.security.tokens import token_hash
from apps.terminals.security.state import execute_transition


def operate(terminal, mode, raw_token="", *, user=None):
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
        update = dict(user_id=user.pk, token_hash=token_hash(new_token))
    result = execute_transition(terminal, mode, now, raw_token, update)
    if not result:
        raise AuthError("Terminal session expired, replaced or invalid. Start a new session.")
    return json.loads(result), new_token


def session_user(state):
    if not state["user_id"]:
        return None
    user = User.objects.select_related("customer").filter(pk=state["user_id"], account_type="CUSTOMER").first()
    if not eligible_customer(user):
        raise AuthError("Customer access is no longer available.")
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
