from functools import lru_cache
import secrets

from django.contrib.auth.backends import BaseBackend
from django.contrib.auth.hashers import check_password, make_password
from django.core.exceptions import ValidationError
from redis.exceptions import RedisError
from rest_framework.authentication import BaseAuthentication, get_authorization_header

from .errors import AuthError
from apps.accounts.models import User
from apps.accounts.security.state import (
    allow_login_attempt_from_source,
    clear_login_failures,
    get_login_lockout_seconds,
    record_failed_login,
)
from apps.accounts.security.validation import normalize_phone_number
from apps.accounts.services.customer_services.hub_sessions import authenticate_hub_access


# The purpose of this method is to create a dummy password when a login attempt has a not found user phone number to equalize timing difference between a not found user and a found user
# Known owner → Check against the owner's hash, Unknown owner → Check against a dummy hash → always reject
# This reduces an obvious timing difference. Why? That timing difference could help someone guess which phone numbers belong to owners.
@lru_cache(maxsize=1)
def get_dummy_password_hash():
    return make_password(secrets.token_urlsafe(32))

class OwnerBackend(BaseBackend):
    def authenticate(
        self,
        request,
        username=None,
        password=None,
        **kwargs,
    ):
        if not username or not password:
            return None

        try:
            phone_number = normalize_phone_number(username)
        except ValidationError:
            return None

        account_type = User.AccountType.OWNER

        source = (
            request.META.get("REMOTE_ADDR") or "unknown"
            if request is not None
            else "internal"
        )

        try:
            if not allow_login_attempt_from_source(source):
                return None

            remaining = get_login_lockout_seconds(
                account_type,
                phone_number,
            )

            if remaining > 0:
                return None

            user = User.objects.filter(
                account_type=account_type,
                phone_number=phone_number,
            ).first()

            if user is None:
                check_password(
                    password,
                    get_dummy_password_hash(),
                )
                record_failed_login(account_type, phone_number)
                return None

            password_matches = user.check_password(password)

            if (
                not password_matches
                or not user.is_active
                or not user.is_staff
            ):
                record_failed_login(account_type, phone_number)
                return None

            clear_login_failures(account_type, phone_number)

            return user

        except RedisError:
            return None

    def get_user(self, user_id):
        return User.objects.filter(
            pk=user_id,
            account_type=User.AccountType.OWNER,
            is_disabled=False,
            is_staff=True,
        ).first()


def bearer_token(request):
    parts = get_authorization_header(request).split()
    if len(parts) != 2 or parts[0].lower() != b"bearer" or len(parts[1]) > 4096:
        raise AuthError("A valid Bearer token is required.")
    try:
        return parts[1].decode("ascii")
    except UnicodeDecodeError:
        raise AuthError("A valid Bearer token is required.") from None


class HubAuthentication(BaseAuthentication):
    def authenticate(self, request):
        return authenticate_hub_access(bearer_token(request)), None

    def authenticate_header(self, request):
        return "Bearer"


@lru_cache(maxsize=1)
def dummy_pin_hash():
    return make_password(secrets.token_urlsafe(32))
