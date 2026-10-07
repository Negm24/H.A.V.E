from datetime import date, datetime
import phonenumbers
import re

from django.contrib.auth.password_validation import (
    validate_password as django_validate_password,
)
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils import timezone


def validate_pin(value):
    if not isinstance(value, str) or re.fullmatch(r"[0-9]{4}", value) is None:
        raise ValidationError(
            "PIN must contain exactly four digits.",
            code="invalid_pin",
        )

    repeated_digits = len(set(value)) == 1

    ascending_sequence = value in "0123456789012"
    descending_sequence = value in "9876543210987"

    common_patterns = {
        "1212",
        "1010",
        "2580",
        "0852",
        "6969",
    }

    if (
        repeated_digits
        or ascending_sequence
        or descending_sequence
        or value in common_patterns
    ):
        raise ValidationError(
            "Choose a PIN without repeated digits, sequences or common patterns.",
            code="weak_pin",
        )

    return value


def normalize_phone_number(value):
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(
            "Enter a valid Egyptian mobile number.",
            code="invalid_phone",
        )

    try:
        number = phonenumbers.parse(value.strip(), "EG")
    except phonenumbers.NumberParseException:
        raise ValidationError(
            "Enter a valid Egyptian mobile number.",
            code="invalid_phone",
        ) from None

    normalized = phonenumbers.format_number(
        number,
        phonenumbers.PhoneNumberFormat.E164,
    )

    if (
        number.extension
        or not phonenumbers.is_valid_number(number)
        or re.fullmatch(r"\+201[0125][0-9]{8}", normalized) is None
    ):
        raise ValidationError(
            "Enter a valid Egyptian mobile number.",
            code="invalid_phone",
        )

    return normalized


def validate_name(value):
    if not isinstance(value, str):
        raise ValidationError(
            "Enter a name using Latin letters.",
            code="invalid_name",
        )

    normalized = " ".join(value.split())

    if re.fullmatch(r"[A-Za-z][A-Za-z '-]{0,31}", normalized) is None:
        raise ValidationError(
            "Names must contain 1–32 characters using Latin letters, "
            "spaces, apostrophes or hyphens.",
            code="invalid_name",
        )

    return normalized


def normalize_email(value):
    if not isinstance(value, str):
        raise ValidationError(
            "Enter a valid email address.",
            code="invalid_email",
        )

    normalized = value.strip().lower()

    validate_email(normalized)

    if len(normalized) > 128:
        raise ValidationError(
            f"You entered {len(normalized)} characters. Email must not exceed 128 characters.",
            code="invalid_email",
        )

    return normalized


def validate_date_of_birth(value):
    if isinstance(value, datetime) or not isinstance(value, date):
        raise ValidationError(
            "Date of birth must be a date.",
            code="invalid_date_of_birth",
        )

    if value > timezone.localdate():
        raise ValidationError(
            "Date of birth cannot be in the future.",
            code="future_date_of_birth",
        )

    return value


def validate_password(value, user=None):
    if not isinstance(value, str):
        raise ValidationError(
            "Password must be text.",
            code="invalid_password",
        )

    if len(value) > 128:
        raise ValidationError(
            "Password must not exceed 128 characters.",
            code="password_too_long",
        )

    django_validate_password(value, user=user)

    return value


def validate_required_text(value, *, field_name, max_length):
    if not isinstance(value, str):
        raise ValidationError(
            f"{field_name} must be text.",
            code="invalid_text",
        )

    normalized = value.strip()

    if not normalized:
        raise ValidationError(
            f"{field_name} is required.",
            code="required",
        )

    if len(normalized) > max_length:
        raise ValidationError(
            f"{field_name} must not exceed {max_length} characters.",
            code="max_length",
        )

    return normalized
