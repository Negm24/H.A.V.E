from django.contrib.auth.hashers import check_password

from apps.accounts.models import User
from apps.accounts.security.authentication import dummy_pin_hash
from apps.accounts.security.errors import AuthError
from apps.accounts.security.permissions import eligible_customer
from apps.accounts.security.state import (
    enforce_customer_login_limit, get_login_lockout_seconds,
    record_failed_login, clear_login_failures,
)


def authenticate_customer(*, phone_number, pin, source, terminal_serial=None):
    enforce_customer_login_limit("source", source)
    if terminal_serial:
        enforce_customer_login_limit("terminal", terminal_serial)
    if get_login_lockout_seconds("CUSTOMER", phone_number):
        raise AuthError("Unable to sign in. Check your credentials or try again later.")
    user = User.objects.select_related("customer").filter(
        account_type="CUSTOMER", phone_number=phone_number,
    ).first()
    valid = user.check_password(pin) if user else check_password(pin, dummy_pin_hash())
    if not valid or not eligible_customer(user):
        record_failed_login("CUSTOMER", phone_number)
        raise AuthError("Unable to sign in. Check your credentials or try again later.")
    clear_login_failures("CUSTOMER", phone_number)
    return user
