from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch
import time

from django.conf import settings
from django.db import close_old_connections, DatabaseError
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from redis.exceptions import RedisError
import jwt

from apps.accounts.models import User, RefreshToken
from apps.accounts.security.errors import AuthError
from apps.accounts.security.tokens import signing_key
from apps.accounts.security.tokens import token_hash
from apps.accounts.services.customer_services.hub_sessions import refresh_hub_session, start_hub_session
from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.tests.helpers import SessionFixtures, HUB


@override_settings(TERMINAL_IDLE_SECONDS=120, TERMINAL_MAX_SECONDS=600,
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class CustomerHubTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()

    def test_hub_login_cookie_me_and_lifetimes(self):
        for remember, days in ((False, 1), (True, 7)):
            response = self.hub_login(remember_me=remember)
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.json()["expires_in"], 900)
            cookie = response.cookies[settings.HUB_REFRESH_COOKIE_NAME]
            self.assertTrue(cookie["httponly"])
            self.assertEqual(cookie["samesite"], "Strict")
            self.assertEqual(cookie["path"], settings.HUB_REFRESH_COOKIE_PATH)
            row = RefreshToken.objects.get(token_hash=token_hash(cookie.value))
            self.assertAlmostEqual((row.expires_at - row.created_at).total_seconds(), days * 86400, delta=2)
            self.assertEqual(row.client_app, "HUB")
            response = self.hub_me(response.json()["access_token"])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["date_of_birth"], "24-01-2005")
            self.assertNotIn("pin_hash", response.json())

    def test_csrf_required_for_hub_mutations(self):
        for route in ("login/", "refresh/", "logout/"):
            self.assertEqual(self.client.post(HUB + route).status_code, 403)

    def test_bad_credentials_roles_disabled_unverified(self):
        self.assertEqual(self.hub_login(pin="7392").status_code, 401)
        self.assertEqual(self.hub_login(phone_number="01112345678").status_code, 401)
        create_owner_account(first_name="Private", last_name="Owner", phone_number="01212345678",
                             email="owner-session@example.test", password="Orchid-River-Example-4826!")
        self.assertEqual(self.hub_login(phone_number="01212345678").status_code, 401)
        self.user.is_disabled = True
        self.user.save(update_fields=["is_disabled"])
        self.assertEqual(self.hub_login().status_code, 401)
        self.user.is_disabled = False
        self.user.phone_verified_at = None
        self.user.save(update_fields=["is_disabled", "phone_verified_at"])
        self.assertEqual(self.hub_login().status_code, 401)

    def test_numeric_and_malformed_pin_rejected(self):
        for pin in (4826, "123", "12345", "abcd"):
            self.assertEqual(self.hub_login(pin=pin).status_code, 400)

    def test_refresh_rotation_fixed_expiry_replay_revokes_family(self):
        login = self.hub_login()
        old = self.client.cookies[settings.HUB_REFRESH_COOKIE_NAME].value
        original = RefreshToken.objects.get(token_hash=token_hash(old))
        refreshed = self.refresh()
        self.assertEqual(refreshed.status_code, 200)
        original.refresh_from_db()
        self.assertIsNotNone(original.revoked_at)
        self.assertEqual(original.replaced_by.expires_at, original.expires_at)
        self.assertEqual(self.hub_me(login.json()["access_token"]).status_code, 200)
        self.client.cookies[settings.HUB_REFRESH_COOKIE_NAME] = old
        self.assertEqual(self.refresh().status_code, 401)
        self.assertEqual(self.hub_me(refreshed.json()["access_token"]).status_code, 401)

    def test_logout_revokes_access_and_clears_cookie_idempotently(self):
        token = self.hub_login().json()["access_token"]
        response = self.client.post(HUB + "logout/", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.cookies[settings.HUB_REFRESH_COOKIE_NAME]["max-age"], 0)
        self.assertEqual(self.hub_me(token).status_code, 401)
        self.assertEqual(self.client.post(HUB + "logout/", HTTP_X_CSRFTOKEN=self.csrf()).status_code, 204)

    def test_tokens_expired_tampered_wrong_audience_missing_claim(self):
        token = self.hub_login().json()["access_token"]
        payload = jwt.decode(token, signing_key(), algorithms=["HS256"], audience="have-hub")
        for update in ({"exp": int(time.time()) - 1}, {"aud": "have-advisor"}):
            bad = jwt.encode(payload | update, signing_key(), algorithm="HS256")
            self.assertEqual(self.hub_me(bad).status_code, 401)
        del payload["sid"]
        self.assertEqual(self.hub_me(jwt.encode(payload, signing_key(), algorithm="HS256")).status_code, 401)
        self.assertEqual(self.hub_me(token + "tampered").status_code, 401)

    def test_expired_refresh_disabled_user_and_database_failure(self):
        token = self.hub_login().json()["access_token"]
        RefreshToken.objects.update(created_at=timezone.now() - timedelta(days=2), expires_at=timezone.now() - timedelta(days=1))
        self.assertEqual(self.refresh().status_code, 401)
        self.assertEqual(self.hub_me(token).status_code, 401)
        token = self.hub_login().json()["access_token"]
        User.objects.filter(pk=self.user.pk).update(is_disabled=True)
        self.assertEqual(self.hub_me(token).status_code, 401)
        with patch("apps.accounts.security.authentication.authenticate_hub_access", side_effect=DatabaseError):
            self.assertEqual(self.hub_me(token).status_code, 503)

    def test_redis_outage_blocks_login_not_existing_hub_session(self):
        token = self.hub_login().json()["access_token"]
        with patch("apps.accounts.security.state.get_redis_client", side_effect=RedisError):
            self.assertEqual(self.hub_login().status_code, 503)
            self.assertEqual(self.hub_me(token).status_code, 200)
            self.assertEqual(self.refresh().status_code, 200)

    def test_new_browser_login_does_not_revoke_other_device_session(self):
        first = self.hub_login().json()["access_token"]
        self.client.cookies.clear()
        second = self.hub_login().json()["access_token"]
        third = self.hub_login().json()["access_token"]
        self.assertEqual(self.hub_me(first).status_code, 200)
        self.assertEqual(self.hub_me(second).status_code, 401)
        self.assertEqual(self.hub_me(third).status_code, 200)

    def test_refresh_access_is_capped_at_family_expiry_and_me_does_not_extend(self):
        self.hub_login()
        row = RefreshToken.objects.get(revoked_at__isnull=True)
        deadline = timezone.now() + timedelta(seconds=45)
        RefreshToken.objects.filter(pk=row.pk).update(expires_at=deadline)
        response = self.refresh()
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(response.json()["expires_in"], 45)
        self.assertEqual(self.hub_me(response.json()["access_token"]).status_code, 200)
        current = RefreshToken.objects.get(revoked_at__isnull=True)
        self.assertEqual(current.expires_at, deadline)

    @override_settings(SESSION_COOKIE_SECURE=True)
    def test_hub_cookie_is_secure_in_base_configuration(self):
        response = self.hub_login()
        self.assertTrue(response.cookies[settings.HUB_REFRESH_COOKIE_NAME]["secure"])

    def test_hub_anonymous_and_owner_cookie_do_not_authenticate_customer(self):
        self.assertEqual(self.client.get(HUB + "me/").status_code, 401)
        owner = create_owner_account(first_name="Owner", last_name="Tester", phone_number="01212345678",
                                     email="owner-cookie@example.test", password="Orchid-River-Demo-4826!")
        self.client.force_login(owner, backend="apps.accounts.backends.OwnerBackend")
        session = self.client.session
        session["owner_started_at"] = time.time()
        session["owner_last_activity_at"] = time.time()
        session.save()
        self.assertEqual(self.client.get(HUB + "me/").status_code, 401)


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class HubConcurrencyTests(SessionFixtures, TransactionTestCase):
    def setUp(self):
        self.setup_sessions()

    def test_concurrent_refresh_revokes_family_on_second_use(self):
        _, row, raw, _ = start_hub_session(self.user, remember_me=False, previous_token=None, user_agent="test", ip_address="127.0.0.1")

        def refresh(_):
            close_old_connections()
            try:
                refresh_hub_session(raw, user_agent="test", ip_address="127.0.0.1")
                return "success"
            except AuthError:
                return "replay"
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(refresh, range(2)))
        self.assertCountEqual(results, ["success", "replay"])
        self.assertFalse(RefreshToken.objects.filter(session_family_id=row.session_family_id, revoked_at__isnull=True).exists())
