from datetime import timedelta
import ipaddress
import secrets

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import RefreshToken, User
from apps.accounts.security.errors import AuthError
from apps.accounts.security.permissions import eligible_customer
from apps.accounts.security.tokens import token_hash, create_hub_access, decode_hub_access


def _family(row):
    return RefreshToken.objects.filter(user_id=row.user_id, client_app="HUB", session_family_id=row.session_family_id)


def _revoke(row):
    _family(row).filter(revoked_at__isnull=True).update(revoked_at=timezone.now())


def _lookup(raw):
    if not raw or len(raw) > 200:
        return None
    return RefreshToken.objects.filter(token_hash=token_hash(raw), client_app="HUB").first()


def _new_row(user, *, remember_me, expires_at, user_agent, ip_address, family=None):
    raw = secrets.token_urlsafe(32)
    try:
        ip_address = str(ipaddress.ip_address(ip_address))
    except ValueError:
        ip_address = None
    fields = dict(user=user, client_app="HUB", token_hash=token_hash(raw),
                  remember_me=remember_me, expires_at=expires_at,
                  user_agent=user_agent[:512], ip_address=ip_address)
    if family:
        fields["session_family_id"] = family
    return RefreshToken.objects.create(**fields), raw


def start_hub_session(user, *, remember_me, previous_token, user_agent, ip_address):
    old = _lookup(previous_token)
    # Ordered locks prevent a deadlock if two browsers switch accounts in reverse.
    ids = sorted({user.pk} | ({old.user_id} if old else set()))
    with transaction.atomic():
        locked = {u.pk: u for u in User.objects.select_for_update().filter(pk__in=ids).order_by("pk")}
        user = locked[user.pk]
        if not eligible_customer(user):
            raise AuthError()
        if old:
            _revoke(old)
        row, raw = _new_row(
            user, remember_me=remember_me,
            expires_at=timezone.now() + timedelta(days=7 if remember_me else 1),
            user_agent=user_agent, ip_address=ip_address,
        )
        access = create_hub_access(row)
    return user, row, raw, access


def refresh_hub_session(raw, *, user_agent, ip_address):
    row = _lookup(raw)
    if not row:
        raise AuthError("Invalid refresh session. Sign in again.")
    result = None
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=row.user_id)
        row.refresh_from_db()
        if row.revoked_at or row.replaced_by_id or row.expires_at <= timezone.now() or not eligible_customer(user):
            _revoke(row)
        else:
            replacement, secret = _new_row(
                user, remember_me=row.remember_me, expires_at=row.expires_at,
                family=row.session_family_id, user_agent=user_agent, ip_address=ip_address,
            )
            row.revoked_at = timezone.now()
            row.replaced_by = replacement
            row.save(update_fields=["revoked_at", "replaced_by"])
            result = (user, replacement, secret, create_hub_access(replacement))
    # Raise outside the transaction: replay revocation must remain committed.
    if result is None:
        raise AuthError("Invalid refresh session. Sign in again.")
    return result


def end_hub_session(raw):
    row = _lookup(raw)
    if row:
        with transaction.atomic():
            User.objects.select_for_update().get(pk=row.user_id)
            _revoke(row)


def authenticate_hub_access(raw):
    payload, family = decode_hub_access(raw)
    user = User.objects.select_related("customer").filter(pk=payload["sub"], account_type="CUSTOMER").first()
    if not eligible_customer(user) or not RefreshToken.objects.filter(
        user=user, client_app="HUB", session_family_id=family,
        revoked_at__isnull=True, replaced_by__isnull=True, expires_at__gt=timezone.now(),
    ).exists():
        raise AuthError("Session expired or revoked. Sign in again.")
    return user
