"""Database-backed personal-app refresh sessions shared by Hub and Advisor.

Callers fix the client app and the account eligibility rule; PostgreSQL stays
authoritative for expiry, rotation, replay detection and revocation.
"""
from datetime import timedelta
import ipaddress
import secrets

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import RefreshToken, User
from apps.accounts.security.errors import AuthError
from apps.accounts.security.tokens import create_access, decode_access, token_hash


def _family(row):
    return RefreshToken.objects.filter(user_id=row.user_id, client_app=row.client_app,
                                       session_family_id=row.session_family_id)


def _revoke(row):
    _family(row).filter(revoked_at__isnull=True).update(revoked_at=timezone.now())


def _lookup(raw, client_app):
    if not raw or len(raw) > 200:
        return None
    return RefreshToken.objects.filter(token_hash=token_hash(raw), client_app=client_app).first()


def _new_row(user, *, client_app, remember_me, expires_at, user_agent, ip_address, family=None):
    raw = secrets.token_urlsafe(32)
    try:
        ip_address = str(ipaddress.ip_address(ip_address))
    except ValueError:
        ip_address = None
    fields = dict(user=user, client_app=client_app, token_hash=token_hash(raw),
                  remember_me=remember_me, expires_at=expires_at,
                  user_agent=user_agent[:512], ip_address=ip_address)
    if family:
        fields["session_family_id"] = family
    return RefreshToken.objects.create(**fields), raw


def start_session(user, *, client_app, eligible, verified_version, remember_me,
                  previous_token, user_agent, ip_address):
    old = _lookup(previous_token, client_app)
    # Ordered locks prevent a deadlock if two browsers switch accounts in reverse.
    ids = sorted({user.pk} | ({old.user_id} if old else set()))
    with transaction.atomic():
        locked = {u.pk: u for u in User.objects.select_for_update().filter(pk__in=ids).order_by("pk")}
        user = locked[user.pk]
        if not eligible(user):
            raise AuthError()
        if user.credential_profile.credential_changed_at.isoformat() != verified_version:
            raise AuthError("Credentials changed. Sign in again.")
        if old:
            _revoke(old)
        row, raw = _new_row(
            user, client_app=client_app, remember_me=remember_me,
            expires_at=timezone.now() + timedelta(days=7 if remember_me else 1),
            user_agent=user_agent, ip_address=ip_address,
        )
        access = create_access(row)
    return user, row, raw, access


def refresh_session(raw, *, client_app, eligible, user_agent, ip_address):
    row = _lookup(raw, client_app)
    if not row:
        raise AuthError("Invalid refresh session. Sign in again.")
    result = None
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=row.user_id)
        row.refresh_from_db()
        if row.revoked_at or row.replaced_by_id or row.expires_at <= timezone.now() or not eligible(user):
            _revoke(row)
        else:
            replacement, secret = _new_row(
                user, client_app=client_app, remember_me=row.remember_me, expires_at=row.expires_at,
                family=row.session_family_id, user_agent=user_agent, ip_address=ip_address,
            )
            row.revoked_at = timezone.now()
            row.replaced_by = replacement
            row.save(update_fields=["revoked_at", "replaced_by"])
            result = (user, replacement, secret, create_access(replacement))
    # Raise outside the transaction: replay revocation must remain committed.
    if result is None:
        raise AuthError("Invalid refresh session. Sign in again.")
    return result


def end_session(raw, *, client_app):
    row = _lookup(raw, client_app)
    if row:
        with transaction.atomic():
            User.objects.select_for_update().get(pk=row.user_id)
            _revoke(row)


def authenticate_access(raw, *, client_app, account_type, eligible):
    payload, family = decode_access(raw, client_app)
    user = User.objects.select_related(account_type.lower()).filter(
        pk=payload["sub"], account_type=account_type,
    ).first()
    if not eligible(user) or not RefreshToken.objects.filter(
        user=user, client_app=client_app, session_family_id=family,
        revoked_at__isnull=True, replaced_by__isnull=True, expires_at__gt=timezone.now(),
    ).exists():
        raise AuthError("Session expired or revoked. Sign in again.")
    return user
