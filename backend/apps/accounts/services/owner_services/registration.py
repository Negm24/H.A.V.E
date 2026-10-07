from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.accounts.identifiers import generate_user_id
from apps.accounts.models import User, Owner
from apps.accounts.security.validation import normalize_email, normalize_phone_number, validate_name, validate_password


def create_owner_account(
    *,
    first_name,
    last_name,
    phone_number,
    email,
    password,
):
    first_name = validate_name(first_name)
    last_name = validate_name(last_name)
    phone_number = normalize_phone_number(phone_number)
    email = normalize_email(email)

    user = User(
        account_type=User.AccountType.OWNER,
        first_name=first_name,
        last_name=last_name,
        phone_number=phone_number,
        email=email,
        phone_country_code="EG",
        is_staff=True,
    )

    password = validate_password(password, user=user)
    password_hash = make_password(password)

    try:
        with transaction.atomic():
            user.id = generate_user_id(
                User.AccountType.OWNER,
                phone_number,
            )
            user.save(force_insert=True)

            Owner.objects.create(
                user=user,
                password_hash=password_hash,
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
                "An owner account already uses this phone number "
                "or email address.",
                code="account_conflict",
            ) from None

        raise

    return user
