"""Approved doctors' explicitly editable profile fields and verified phone changes."""
from datetime import timedelta
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import Doctor, RefreshToken, User
from apps.accounts.security import challenges
from apps.accounts.security.errors import AuthError
from apps.accounts.security.permissions import eligible_doctor
from apps.accounts.security.state import get_redis_client
from apps.accounts.security.validation import normalize_phone_number
from apps.accounts.services.shared_services.notifications import require_sms_delivery, send_verification_sms


PHONE_PURPOSE = "DOCTOR_PHONE_CHANGE"
EDITABLE = frozenset({"specialty", "specialty_ar", "clinic_name", "clinic_name_ar", "clinic_address", "clinic_address_ar"})


def _lock_doctor(user, session_family=None):
    """Use the account/session lock order; reject requests authenticated before revocation."""
    current = User.objects.select_for_update().get(pk=user.pk)
    doctor = Doctor.objects.select_for_update().get(pk=user.pk)
    doctor.user = current
    current.doctor = doctor
    if not eligible_doctor(current):
        raise AuthError("An active approved doctor account is required.", 403)
    if doctor.credential_changed_at != user.doctor.credential_changed_at:
        raise AuthError("Session expired. Sign in again.")
    if session_family is not None and not RefreshToken.objects.filter(
        user=current, client_app="ADVISOR", session_family_id=session_family,
        revoked_at__isnull=True, replaced_by__isnull=True, expires_at__gt=timezone.now(),
    ).exists():
        raise AuthError("Session expired. Sign in again.")
    return current, doctor


@transaction.atomic
def update_profile(user, values, *, session_family=None):
    if set(values) - EDITABLE:
        raise AuthError("Identity and qualification details cannot be edited.", 400)
    current, doctor = _lock_doctor(user, session_family)
    for key in EDITABLE:
        if key in values:
            setattr(doctor, key, values[key].strip())
    if not all(getattr(doctor, key).strip() for key in ("clinic_name", "clinic_name_ar", "clinic_address", "clinic_address_ar")):
        raise AuthError("Enter the clinic name and address in Arabic and English.", 400)
    doctor.save(update_fields=list(EDITABLE))
    return current


def _ensure_available(user, phone):
    if phone == user.phone_number:
        raise AuthError("Enter a different phone number.", 400)
    if User.objects.filter(account_type=User.AccountType.DOCTOR, phone_number=phone).exclude(pk=user.pk).exists():
        raise AuthError("This phone number is unavailable.", 409)


@transaction.atomic
def request_phone_change(user, *, phone_number, source, session_family=None):
    current, doctor = _lock_doctor(user, session_family)
    phone = normalize_phone_number(phone_number)
    _ensure_available(current, phone)
    challenges.enforce_limit("doctor-phone-send", str(user.pk), 5, 3600)
    challenges.enforce_limit("doctor-phone-source", source, 20, 600)
    require_sms_delivery()
    challenge_id, code = challenges.issue_recovery_code(PHONE_PURPOSE, phone, {
        "user_id": str(user.pk), "old_phone": current.phone_number,
        "credential_version": doctor.credential_changed_at.isoformat(),
    })
    try:
        send_verification_sms(purpose="DOCTOR PHONE CHANGE", challenge_id=challenge_id, phone_number=phone, code=code)
    except (OSError, AuthError):
        get_redis_client().delete(challenges.challenge_key(PHONE_PURPOSE, challenge_id))
        raise AuthError("SMS delivery failed. Try again after the resend delay.", 503) from None
    return {"challenge_id": challenge_id, "expires_in": settings.RECOVERY_CODE_SECONDS, "resend_after": settings.RECOVERY_RESEND_SECONDS}


def verify_phone_change(user, *, phone_number, challenge_id, code, source, session_family=None):
    phone = normalize_phone_number(phone_number)
    challenges.enforce_limit("doctor-phone-verify", str(user.pk), 15, 300)
    challenges.enforce_limit("doctor-phone-verify-source", source, 60, 300)
    raw = challenges.verify_recovery_code(PHONE_PURPOSE, phone, str(challenge_id), code)
    key, payload = challenges.read_recovery_proof(PHONE_PURPOSE, raw)
    try:
        with transaction.atomic():
            current, doctor = _lock_doctor(user, session_family)
            if (payload.get("user_id") != str(user.pk)
                    or payload.get("old_phone") != current.phone_number
                    or payload.get("credential_version") != doctor.credential_changed_at.isoformat()):
                raise AuthError("This verification belongs to a different account or expired session.", 400)
            _ensure_available(current, phone)
            challenges.consume_recovery_proof(PHONE_PURPOSE, key, phone, raw)
            now = timezone.now()
            current.phone_number, current.phone_verified_at = phone, now
            current.save(update_fields=["phone_number", "phone_verified_at"])
            doctor.credential_changed_at = max(now, doctor.credential_changed_at + timedelta(microseconds=1))
            doctor.save(update_fields=["credential_changed_at"])
            RefreshToken.objects.filter(user=current, revoked_at__isnull=True).update(revoked_at=now)
    except IntegrityError:
        raise AuthError("This phone number is unavailable. Request a new verification code.", 409) from None
    return {"detail": "Phone number updated. Sign in again."}
