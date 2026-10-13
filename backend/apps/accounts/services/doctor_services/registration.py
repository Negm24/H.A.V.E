from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.identifiers import generate_user_id
from apps.accounts.models import User, Doctor
from apps.accounts.security.tokens import identifier_hash
from apps.accounts.security.validation import normalize_email, normalize_phone_number, validate_name, validate_password, validate_required_text


def create_doctor_account(
    *,
    first_name,
    last_name,
    phone_number,
    email,
    password,
    professional_license_number,
    specialty,
    clinic_name,
    clinic_address,
):
    first_name = validate_name(first_name)
    last_name = validate_name(last_name)
    phone_number = normalize_phone_number(phone_number)
    email = normalize_email(email)

    user = User(
        account_type=User.AccountType.DOCTOR,
        first_name=first_name,
        last_name=last_name,
        phone_number=phone_number,
        email=email,
        phone_country_code="EG",
    )

    password = validate_password(password, user=user)

    professional_license_number = validate_required_text(
        professional_license_number,
        field_name="Professional license number",
        max_length=100,
    )

    specialty = validate_required_text(
        specialty,
        field_name="Specialty",
        max_length=100,
    )

    clinic_name = validate_required_text(
        clinic_name,
        field_name="Clinic name",
        max_length=200,
    )

    clinic_address = validate_required_text(
        clinic_address,
        field_name="Clinic address",
        max_length=1000,
    )

    return _create_doctor_from_validated_data(
        first_name=first_name, last_name=last_name, phone_number=phone_number, email=email,
        password_hash=make_password(password),
        professional_license_number=professional_license_number, specialty=specialty,
        clinic_name=clinic_name, clinic_address=clinic_address,
    )


def _create_doctor_from_validated_data(
    *, first_name, last_name, phone_number, email, password_hash,
    professional_license_number, specialty, clinic_name, clinic_address, email_verified=False,
):
    """Internal persistence step; callers validate inputs and establish phone proof."""
    user = User(
        account_type=User.AccountType.DOCTOR,
        first_name=first_name,
        last_name=last_name,
        phone_number=phone_number,
        email=email,
        phone_country_code="EG",
    )

    try:
        with transaction.atomic():
            user.id = generate_user_id(
                User.AccountType.DOCTOR,
                phone_number,
            )
            user.phone_verified_at = timezone.now()
            user.email_verified_at = timezone.now() if email_verified else None
            user.save(force_insert=True)

            Doctor.objects.create(
                user=user,
                password_hash=password_hash,
                professional_license_number=professional_license_number,
                specialty=specialty,
                clinic_name=clinic_name,
                clinic_address=clinic_address,
                approval_status=Doctor.ApprovalStatus.PENDING,
            )

    except IntegrityError as exc:
        _raise_conflict(exc)

    return user


def find_rejected_applicant(*, phone_number, email):
    """The rejected application whose keyed phone or email hash matches (FR-82f)."""
    return (Doctor.objects
            .filter(approval_status=Doctor.ApprovalStatus.REJECTED)
            .filter(Q(phone_hash=identifier_hash("phone", phone_number))
                    | Q(email_hash=identifier_hash("email", email)))
            .order_by("-rejection_count").first())


def _reopen_rejected_doctor(
    doctor_id, *, first_name, last_name, phone_number, email, password_hash,
    professional_license_number, specialty, clinic_name, clinic_address,
):
    """Re-signup of a rejected applicant: same rows and ID, personal data restored, PENDING again."""
    now = timezone.now()
    try:
        with transaction.atomic():
            # User before Doctor: the same lock order as the review and session code.
            user = User.objects.select_for_update().get(pk=doctor_id)
            doctor = Doctor.objects.select_for_update().get(pk=doctor_id)
            if (doctor.approval_status != Doctor.ApprovalStatus.REJECTED
                    or doctor.rejection_count >= settings.DOCTOR_MAX_REJECTIONS):
                raise ValidationError("This application cannot be reopened.", code="not_reopenable")

            user.first_name, user.last_name = first_name, last_name
            user.phone_number, user.email = phone_number, email
            user.phone_verified_at = user.email_verified_at = now
            user.save(update_fields=["first_name", "last_name", "phone_number", "email",
                                     "phone_verified_at", "email_verified_at"])

            doctor.password_hash = password_hash
            doctor.credential_changed_at = now
            doctor.professional_license_number = professional_license_number
            doctor.specialty, doctor.clinic_name, doctor.clinic_address = specialty, clinic_name, clinic_address
            doctor.approval_status = Doctor.ApprovalStatus.PENDING
            doctor.phone_hash = doctor.email_hash = None
            doctor.save(update_fields=[
                "password_hash", "credential_changed_at", "professional_license_number", "specialty",
                "clinic_name", "clinic_address", "approval_status", "phone_hash", "email_hash",
            ])
    except IntegrityError as exc:
        _raise_conflict(exc)
    return user


def _raise_conflict(exc):
    diagnostics = getattr(exc.__cause__, "diag", None)
    constraint_name = getattr(
        diagnostics,
        "constraint_name",
        None,
    )

    duplicate_constraints = {
        "users_account_type_phone_unique",
        "users_account_type_email_unique",
    }

    if constraint_name in duplicate_constraints:
        raise ValidationError(
            "A doctor account already uses this phone number "
            "or email address.",
            code="account_conflict",
        ) from None

    if constraint_name == "doctors_license_number_unique":
        raise ValidationError(
            "A doctor account already uses this professional license number.",
            code="license_conflict",
        ) from None

    raise exc
