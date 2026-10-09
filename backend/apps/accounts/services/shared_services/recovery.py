"""Shared proof and persistence operations; callers fix the account role."""
from datetime import timedelta
import logging

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User, RefreshToken
from apps.accounts.security.challenges import (
    challenge_key, consume_recovery_proof, enforce_limit, issue_recovery_code,
    read_recovery_proof, verify_recovery_code,
)
from apps.accounts.security.errors import AuthError
from apps.accounts.security.state import clear_login_failures, get_redis_client
from apps.accounts.security.validation import validate_pin, validate_password
from .notifications import require_sms_delivery, send_verification_sms

logger = logging.getLogger(__name__)


def eligible_for_recovery(user):
    if not user or not user.is_active:
        return False
    if user.account_type == "CUSTOMER":
        return bool(user.phone_verified_at)
    if user.account_type == "OWNER":
        return user.is_staff
    return user.account_type == "DOCTOR"


def request_recovery(*, account_type, phone_number, source):
    require_sms_delivery()
    enforce_limit("recovery-send", source, 20, 600)
    user = User.objects.select_related(account_type.lower()).filter(
        account_type=account_type, phone_number=phone_number,
    ).first()
    eligible = eligible_for_recovery(user)
    payload = {
        "user_id": user.pk if eligible else None,
        "phone_number": phone_number,
        "credential_version": user.credential_profile.credential_changed_at.isoformat() if eligible else None,
    }
    challenge_id, code = issue_recovery_code(account_type, phone_number, payload)
    if eligible:
        try:
            send_verification_sms(purpose=f"{account_type} RECOVERY",
                                  challenge_id=challenge_id, phone_number=phone_number, code=code)
        except (OSError, AuthError):
            get_redis_client().delete(challenge_key(account_type, challenge_id))
            logger.warning("Recovery SMS delivery failed; challenge invalidated.")
    return {
        "challenge_id": challenge_id, "expires_in": settings.RECOVERY_CODE_SECONDS,
        "resend_after": settings.RECOVERY_RESEND_SECONDS,
        "detail": "If this account is eligible, a verification code will be sent.",
    }


def verify_recovery(*, account_type, phone_number, challenge_id, code, source):
    enforce_limit("recovery-verify", source, 60, 300)
    token = verify_recovery_code(account_type, phone_number, str(challenge_id), code)
    return {"reset_token": token, "expires_in": settings.RECOVERY_PROOF_SECONDS}


def complete_recovery(*, account_type, reset_token, new_credential, source):
    enforce_limit("recovery-complete", source, 60, 300)
    key, proof = read_recovery_proof(account_type, reset_token)
    with transaction.atomic():
        user = User.objects.select_for_update().filter(
            pk=proof["user_id"], account_type=account_type,
        ).first()
        if (not eligible_for_recovery(user) or user.phone_number != proof["phone_number"]
                or user.credential_profile.credential_changed_at.isoformat() != proof["credential_version"]):
            raise AuthError("This reset is no longer valid. Request a new code.", 400)
        if account_type == "CUSTOMER":
            validate_pin(new_credential)
            field = "pin_hash"
        else:
            validate_password(new_credential, user=user)
            field = "password_hash"
        hashed = make_password(new_credential)
        # Consume first: a database failure requires a fresh code, never reused proof.
        consume_recovery_proof(account_type, key, user.phone_number, reset_token)
        profile = user.credential_profile
        setattr(profile, field, hashed)
        profile.credential_changed_at = max(
            timezone.now(), profile.credential_changed_at + timedelta(microseconds=1),
        )
        profile.save(update_fields=[field, "credential_changed_at"])
        RefreshToken.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())
        clear_login_failures(account_type, user.phone_number)
    return {"detail": "Credential updated. Sign in again."}
