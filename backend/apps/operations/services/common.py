from django.core.exceptions import PermissionDenied
from apps.accounts.security.errors import AuthError


def require_owner(actor):
    if not actor or not actor.is_authenticated or actor.account_type != "OWNER" or not actor.is_active or not actor.is_staff:
        raise PermissionDenied("An active Owner session is required.")


def require_revision(instance, value):
    if isinstance(value, bool) or not isinstance(value, int) or instance.revision != value:
        raise AuthError("This record changed. Refresh it and review your changes.", 409)


def reason_text(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 1000:
        raise AuthError("Enter a reason of at most 1000 characters.", 400)
    return value.strip()
