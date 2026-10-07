from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.identifiers import generate_user_id
from apps.accounts.models import Customer, User
from apps.accounts.security.validation import normalize_email, normalize_phone_number, validate_date_of_birth, validate_name, validate_pin


def create_customer_account(
    *,
    first_name,
    last_name,
    phone_number,
    email,
    date_of_birth,
    pin,
):
    first_name = validate_name(first_name)
    last_name = validate_name(last_name)
    phone_number = normalize_phone_number(phone_number)
    email = normalize_email(email)
    date_of_birth = validate_date_of_birth(date_of_birth)
    pin = validate_pin(pin)

    pin_hash = make_password(pin)

    return _create_customer_from_validated_data(
        first_name=first_name, last_name=last_name, phone_number=phone_number,
        email=email, date_of_birth=date_of_birth, pin_hash=pin_hash,
    )


def _create_customer_from_validated_data(
    *, first_name, last_name, phone_number, email, date_of_birth, pin_hash,
):
    """Internal persistence step; callers validate inputs and establish phone proof."""
    with transaction.atomic():
        try:
            with transaction.atomic():
                user = User.objects.create(
                    id=generate_user_id(
                        User.AccountType.CUSTOMER,
                        phone_number,
                    ),
                    account_type=User.AccountType.CUSTOMER,
                    first_name=first_name,
                    last_name=last_name,
                    phone_number=phone_number,
                    email=email,
                    phone_country_code="EG",
                    phone_verified_at=timezone.now(),
                )

                Customer.objects.create(
                    user=user,
                    date_of_birth=date_of_birth,
                    pin_hash=pin_hash,
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
                    "A customer account already uses this phone number "
                    "or email address.",
                    code="account_conflict",
                ) from None

            raise

        return user
