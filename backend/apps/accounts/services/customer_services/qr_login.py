"""Terminal displays a code; an authenticated Hub customer scans and confirms."""
import secrets
from uuid import UUID, uuid4

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User, RefreshToken
from apps.accounts.security.challenges import enforce_limit
from apps.accounts.security.errors import AuthError
from apps.accounts.security.permissions import eligible_customer
from apps.accounts.security.qr_state import qr_key, read_qr, transition
from apps.accounts.security.state import get_redis_client
from apps.accounts.security.tokens import token_hash, decode_hub_access
from apps.accounts.services.customer_services.hub_sessions import authenticate_hub_access
from apps.terminals.models import Terminal
from apps.terminals.services.session_services import operate, session_response


def _device(qr):
    device = Terminal.objects.filter(pk=qr["terminal_serial"], is_disabled=False).first()
    if not device or device.device_credential_hash != qr["credential_hash"]:
        raise AuthError("Terminal is no longer available.", 400)
    return device


def _family_valid(user, family_id):
    return eligible_customer(user) and RefreshToken.objects.filter(
        user=user, client_app="HUB", session_family_id=family_id,
        revoked_at__isnull=True, replaced_by__isnull=True, expires_at__gt=timezone.now(),
    ).exists()


def _hub_identity(access_token):
    user = authenticate_hub_access(access_token)
    _, family = decode_hub_access(access_token)
    return user, str(family)


def _require_approval_owner(qr, user, family):
    if qr.get("user_id") != user.pk or qr.get("family_id") != family:
        raise AuthError("This QR request belongs to another session.", 403)
    if (not _family_valid(user, family)
            or qr.get("credential_version") != user.customer.credential_changed_at.isoformat()):
        raise AuthError("This QR request is no longer valid.", 400)


def _status(challenge_id, qr, *, include_terminal=False):
    result = {"challenge_id": str(challenge_id), "status": qr["status"],
              "expires_in": max(0, get_redis_client().ttl(qr_key(challenge_id)))}
    if include_terminal:
        device = _device(qr)
        result["terminal"] = {
            "serial_number": device.pk, "display_name": device.display_name,
            "address_en": device.address_en, "address_ar": device.address_ar,
        }
    return result


def create_qr(*, terminal, guest_token, source):
    enforce_limit("qr-create-device", terminal.pk, 10, 300)
    enforce_limit("qr-create-source", source, 20, 300)
    state, _ = operate(terminal, "read", guest_token)
    if state["user_id"]:
        raise AuthError("Start a guest session before requesting QR login.", 400)
    challenge_id = str(uuid4())
    payload = f"{challenge_id}.{secrets.token_urlsafe(32)}"
    qr = dict(challenge_id=challenge_id, terminal_serial=terminal.pk,
              session_id=state["session_id"], credential_hash=terminal.device_credential_hash,
              guest_token_hash=token_hash(guest_token), qr_hash=token_hash(payload),
              status="waiting_for_scan")
    qr = transition(challenge_id, terminal.pk, "create", qr)
    return _status(challenge_id, qr) | {"qr_payload": payload}


def scan_qr(*, qr_payload, access_token, source):
    user, family = _hub_identity(access_token)
    enforce_limit("qr-action-source", source, 60, 300)
    enforce_limit("qr-action-user", user.pk, 60, 300)
    try:
        challenge_id = str(UUID(qr_payload.split(".", 1)[0]))
    except ValueError:
        raise AuthError("Invalid QR code.", 400) from None
    _, qr = read_qr(challenge_id)
    device = _device(qr)
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        if not _family_valid(user, family):
            raise AuthError("Hub session ended. Sign in again.")
        qr = transition(challenge_id, device.pk, "claim", {
            "qr_hash": token_hash(qr_payload), "user_id": user.pk, "family_id": family,
            "credential_version": user.customer.credential_changed_at.isoformat(),
        })
    return _status(challenge_id, qr, include_terminal=True)


def hub_qr_status(*, challenge_id, access_token):
    user, family = _hub_identity(access_token)
    enforce_limit("qr-poll-hub", family, 60, 60)
    _, qr = read_qr(challenge_id)
    _require_approval_owner(qr, user, family)
    device = _device(qr)
    qr = transition(challenge_id, device.pk, "read")
    return _status(challenge_id, qr, include_terminal=True)


def confirm_qr(*, challenge_id, approve, access_token, source):
    user, family = _hub_identity(access_token)
    enforce_limit("qr-action-source", source, 60, 300)
    enforce_limit("qr-action-user", user.pk, 60, 300)
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        _, qr = read_qr(challenge_id)
        _require_approval_owner(qr, user, family)
        device = _device(qr)
        qr = transition(challenge_id, device.pk, "confirm", {
            "user_id": user.pk, "family_id": family, "approve": approve,
        })
    return _status(challenge_id, qr, include_terminal=True)


def _terminal_challenge(terminal, session_id, challenge_id):
    raw, qr = read_qr(challenge_id)
    if qr["terminal_serial"] != terminal.pk or qr["session_id"] != session_id:
        raise AuthError("This QR request belongs to another terminal session.", 403)
    _device(qr)
    transition(challenge_id, terminal.pk, "read")
    return raw, qr


def terminal_qr_status(*, terminal, session_id, challenge_id):
    enforce_limit("qr-poll-terminal", session_id, 60, 60)
    _, qr = _terminal_challenge(terminal, session_id, challenge_id)
    if qr.get("user_id"):
        user = User.objects.filter(pk=qr["user_id"], account_type="CUSTOMER").first()
        if (not _family_valid(user, qr["family_id"])
                or user.customer.credential_changed_at.isoformat() != qr["credential_version"]):
            raise AuthError("QR login is no longer valid.", 400)
    return _status(challenge_id, qr)


def complete_qr(*, terminal, session_id, guest_token, challenge_id, source):
    enforce_limit("qr-action-source", source, 60, 300)
    enforce_limit("qr-action-device", terminal.pk, 60, 300)
    raw, qr = _terminal_challenge(terminal, session_id, challenge_id)
    if qr["status"] != "approved":
        raise AuthError("QR login is not approved or has already been used.", 400)
    with transaction.atomic():
        user = User.objects.select_for_update().filter(
            pk=qr["user_id"], account_type="CUSTOMER",
        ).first()
        if (not _family_valid(user, qr["family_id"])
                or user.customer.credential_changed_at.isoformat() != qr["credential_version"]):
            raise AuthError("QR login is no longer valid.", 400)
        # Redis consumes approval and rotates the guest token in ONE atomic script.
        state, token = operate(terminal, "login", guest_token, user=user,
                               qr_proof=(qr_key(challenge_id), raw))
    return user, session_response(state, token)
