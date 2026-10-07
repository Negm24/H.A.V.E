from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.identifiers import generate_user_id
from apps.accounts.models import User, Doctor
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

    password_hash = make_password(password)

    try:
        with transaction.atomic():
            user.id = generate_user_id(
                User.AccountType.DOCTOR,
                phone_number,
            )
            user.phone_verified_at = timezone.now()
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

        raise

    return user
