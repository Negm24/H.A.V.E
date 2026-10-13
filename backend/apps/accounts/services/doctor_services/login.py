"""Advisor sign-in: password first, then an authenticator code.

Approval is checked after the password, so only the account holder learns
whether an application is pending or rejected. Account failure history is
cleared only after the whole sign-in succeeds; otherwise a known password
would reset the lockout that bounds authenticator-code guessing.
"""
from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Doctor, User
from apps.accounts.security import mfa
from apps.accounts.security.authentication import get_dummy_password_hash
from apps.accounts.security.challenges import enforce_limit
from apps.accounts.security.errors import AuthError
from apps.accounts.security.tokens import identifier_hash
from apps.accounts.security.state import (
    clear_login_failures, get_login_lockout_seconds, record_failed_login,
)
from .advisor_sessions import start_advisor_session

GENERIC_FAILURE = "Unable to sign in. Check your credentials or try again later."


def authenticate_doctor(*, phone_number, password, source):
    enforce_limit("doctor-login", source, 60, 300)
    if get_login_lockout_seconds("DOCTOR", phone_number):
        raise AuthError(GENERIC_FAILURE)
    user = User.objects.select_related("doctor").filter(
        account_type="DOCTOR", phone_number=phone_number,
    ).first()
    if user is None:
        # A rejected application has no plaintext phone; it is found by its keyed hash (FR-82c).
        user = User.objects.select_related("doctor").filter(
            account_type="DOCTOR", doctor__approval_status=Doctor.ApprovalStatus.REJECTED,
            doctor__phone_hash=identifier_hash("phone", phone_number),
        ).first()
    valid = user.check_password(password) if user else check_password(password, get_dummy_password_hash())
    if not valid or not user.is_active:
        record_failed_login("DOCTOR", phone_number)
        raise AuthError(GENERIC_FAILURE)
    return user


def begin_doctor_login(*, phone_number, password, remember_me, source):
    user = authenticate_doctor(phone_number=phone_number, password=password, source=source)
    doctor = user.doctor
    if doctor.approval_status == Doctor.ApprovalStatus.PENDING:
        clear_login_failures("DOCTOR", phone_number)
        return {"status": "WAITING_FOR_APPROVAL",
                "detail": "Your application is waiting for approval. Try again after it is reviewed."}
    if doctor.approval_status == Doctor.ApprovalStatus.REJECTED:
        clear_login_failures("DOCTOR", phone_number)
        # The number of rejections is deliberately not returned (FR-82c).
        return {"status": "REJECTED", "detail": "Your application was not approved.",
                "rejection_reason": doctor.rejection_reason or "",
                "can_reapply": doctor.rejection_count < settings.DOCTOR_MAX_REJECTIONS}

    version = doctor.credential_changed_at.isoformat()
    if doctor.mfa_enrolled_at:
        token = mfa.issue_challenge(user, remember_me=remember_me, credential_version=version)
        return {"status": "MFA_REQUIRED", "mfa_token": token,
                "expires_in": settings.MFA_CHALLENGE_SECONDS,
                "detail": "Enter the 6-digit code from your authenticator app."}

    secret = mfa.new_totp_secret()
    token = mfa.issue_challenge(user, remember_me=remember_me, credential_version=version,
                                pending_secret=mfa.encrypt_secret(secret))
    return {"status": "MFA_ENROLLMENT_REQUIRED", "mfa_token": token,
            "expires_in": settings.MFA_CHALLENGE_SECONDS,
            "secret": secret, "otpauth_uri": mfa.provisioning_uri(secret, user),
            "detail": "Add this account to your authenticator app, then enter its 6-digit code."}


def complete_doctor_login(*, mfa_token, code, source, previous_token, user_agent):
    enforce_limit("doctor-mfa", source, 60, 300)
    payload, attempts = mfa.attempt_challenge(mfa_token)
    user = User.objects.select_related("doctor").filter(pk=payload["user_id"], account_type="DOCTOR").first()
    if user is None:
        mfa.discard_challenge(mfa_token)
        raise AuthError("Sign-in expired. Enter your password again.")
    if get_login_lockout_seconds("DOCTOR", user.phone_number):
        mfa.discard_challenge(mfa_token)
        raise AuthError(GENERIC_FAILURE)

    enrolling = payload["pending_secret"] is not None
    encrypted = payload["pending_secret"] if enrolling else user.doctor.mfa_secret_encrypted
    if not encrypted:
        mfa.discard_challenge(mfa_token)
        raise AuthError("Sign-in expired. Enter your password again.")
    step = mfa.matching_time_step(mfa.decrypt_secret(encrypted), code)
    if step is None:
        record_failed_login("DOCTOR", user.phone_number)
        if attempts >= settings.MFA_MAX_ATTEMPTS:
            mfa.discard_challenge(mfa_token)
        raise AuthError("Incorrect authentication code.")

    mfa.consume_challenge(mfa_token, user.pk, step)
    if enrolling:
        _store_enrollment(user.pk, encrypted, payload["credential_version"])
        user.refresh_from_db()
        user.doctor.refresh_from_db()
    clear_login_failures("DOCTOR", user.phone_number)
    return start_advisor_session(
        user, verified_version=payload["credential_version"], remember_me=payload["remember_me"],
        previous_token=previous_token, user_agent=user_agent, ip_address=source,
    )


def _store_enrollment(user_id, encrypted, credential_version):
    with transaction.atomic():
        doctor = Doctor.objects.select_for_update().select_related("user").get(pk=user_id)
        if (doctor.approval_status != Doctor.ApprovalStatus.APPROVED or doctor.mfa_enrolled_at
                or not doctor.user.is_active
                or doctor.credential_changed_at.isoformat() != credential_version):
            raise AuthError("Sign-in expired. Enter your password again.")
        doctor.mfa_secret_encrypted = encrypted
        doctor.mfa_enrolled_at = timezone.now()
        doctor.save(update_fields=["mfa_secret_encrypted", "mfa_enrolled_at"])

