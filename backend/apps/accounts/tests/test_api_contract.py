from datetime import timedelta
import ast
from pathlib import Path
from uuid import uuid4
import hashlib
import json
import time

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.test import SimpleTestCase, override_settings
from django.test import TestCase
from django.urls import include, path, reverse, resolve
from django.utils import timezone
from django.utils.crypto import salted_hmac
from drf_spectacular.generators import SchemaGenerator
from drf_spectacular.views import SpectacularAPIView
import jwt

from apps.accounts.models import RefreshToken
from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.tests.helpers import SessionFixtures


urlpatterns = [
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/v1/auth/", include("apps.accounts.api.urls")),
    path("api/v1/terminals/", include("apps.terminals.api.urls")),
]


class ApiContractTests(SimpleTestCase):
    def test_services_and_security_do_not_depend_on_api(self):
        apps_root = Path(__file__).resolve().parents[2]
        for app in ("accounts", "terminals"):
            for layer in ("services", "security"):
                for source in (apps_root / app / layer).rglob("*.py"):
                    tree = ast.parse(source.read_text(encoding="utf-8"))
                    for node in ast.walk(tree):
                        if isinstance(node, ast.ImportFrom):
                            imports = [node.module or ""]
                        elif isinstance(node, ast.Import):
                            imports = [alias.name for alias in node.names]
                        else:
                            continue
                        for module in imports:
                            with self.subTest(source=str(source), module=module):
                                self.assertNotIn("api", module.split("."))

    @override_settings(ROOT_URLCONF=__name__)
    def test_openapi_matches_pre_refactor_contract(self):
        expected = json.loads(Path(__file__).with_name("openapi_baseline.json").read_text())
        actual = SchemaGenerator().get_schema(request=None, public=True)
        self.assertEqual(actual, expected)

    def test_url_names_and_order_are_stable(self):
        from apps.accounts.api.urls import urlpatterns as account_routes
        from apps.terminals.api.urls import urlpatterns as terminal_routes

        expected_accounts = [
            ("customers/hub/login/", "hub-login"),
            ("customers/hub/me/", "hub-me"),
            ("customers/hub/refresh/", "hub-refresh"),
            ("customers/hub/logout/", "hub-logout"),
            ("customers/terminal/login/", "terminal-login"),
            ("customers/terminal/me/", "terminal-me"),
            ("customers/signup/", "customer-signup"),
            ("customers/signup/verify/", "customer-signup-verify"),
            ("csrf/", "csrf"),
            ("owners/login/", "owner-login"),
            ("owners/me/", "owner-me"),
            ("owners/logout/", "owner-logout"),
        ]
        expected_terminals = [
            ("sessions/", "terminal-session-start"),
            ("sessions/activity/", "terminal-session-activity"),
            ("sessions/end/", "terminal-session-end"),
        ]
        self.assertEqual([(str(p.pattern), p.name) for p in account_routes], expected_accounts)
        self.assertEqual([(str(p.pattern), p.name) for p in terminal_routes], expected_terminals)
        for suffix, name in expected_accounts:
            url = "/api/v1/auth/" + suffix
            self.assertEqual(reverse("accounts_api:" + name), url)
            self.assertEqual(resolve(url).view_name, "accounts_api:" + name)
        for suffix, name in expected_terminals:
            url = "/api/v1/terminals/" + suffix
            self.assertEqual(reverse(name), url)
            self.assertEqual(resolve(url).view_name, name)


# These fixtures deliberately use the pre-refactor wire/storage formats rather
# than the production issuance helpers. They guard compatibility after reload.


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
                   DEBUG=True, AUTH_CONSOLE_SMS=True)
class StoredCredentialCompatibilityTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()

    def test_owner_session_with_original_backend_path_and_hash(self):
        owner = create_owner_account(
            first_name="Private", last_name="Owner", phone_number="01112345678",
            email="legacy-owner@example.test", password="Orchid-River-Example-4826!",
        )
        legacy_hash = salted_hmac(
            "have.accounts.User.session",
            f"{owner.owner.password_hash}:{owner.owner.credential_changed_at.isoformat()}",
            algorithm="sha256",
        ).hexdigest()
        session = self.client.session
        session.update({
            "_auth_user_id": owner.pk,
            "_auth_user_backend": "apps.accounts.backends.OwnerBackend",
            "_auth_user_hash": legacy_hash,
            "owner_started_at": time.time(),
            "owner_last_activity_at": time.time(),
        })
        session.save()
        self.assertIn("apps.accounts.backends.OwnerBackend", settings.AUTHENTICATION_BACKENDS)
        response = self.client.get("/api/v1/auth/owners/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], owner.pk)

    def test_pre_refactor_hub_access_and_refresh_formats(self):
        raw = "legacy-refresh-" + uuid4().hex
        row = RefreshToken.objects.create(
            user=self.user, client_app="HUB",
            token_hash=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at=timezone.now() + timedelta(days=1), remember_me=False,
        )
        now = int(time.time())
        key = salted_hmac("have.hub.jwt.signing.v1", "access-token", algorithm="sha256").digest()
        access = jwt.encode({
            "iss": "have-backend", "aud": "have-hub", "sub": self.user.pk,
            "sid": str(row.session_family_id), "iat": now, "exp": now + 900,
        }, key, algorithm="HS256")
        self.assertEqual(self.hub_me(access).status_code, 200)
        self.client.cookies[settings.HUB_REFRESH_COOKIE_NAME] = raw
        refreshed = self.refresh()
        self.assertEqual(refreshed.status_code, 200)
        row.refresh_from_db()
        self.assertIsNotNone(row.replaced_by_id)
        self.assertEqual(row.replaced_by.expires_at, row.expires_at)
        self.assertEqual(self.hub_me(access).status_code, 200)

    def test_pre_refactor_terminal_customer_session_format(self):
        raw = "legacy-terminal-" + uuid4().hex
        now = time.time()
        state = {
            "session_id": str(uuid4()), "terminal_serial": self.terminal.pk,
            "credential_hash": hashlib.sha256(self.device_secret.encode()).hexdigest(),
            "user_id": self.user.pk, "token_hash": hashlib.sha256(raw.encode()).hexdigest(),
            "started_at": now, "last_activity_at": now - 20,
        }
        key = self.prefix + "terminal-session:" + hashlib.sha256(self.terminal.pk.encode()).hexdigest()
        self.redis.set(key, json.dumps(state), ex=100)
        response = self.terminal_me(raw)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], self.user.pk)
        self.assertEqual(json.loads(self.redis.get(key)), state)

    def test_pre_refactor_pending_signup_challenge_format(self):
        challenge = str(uuid4())
        phone = "+201112345678"
        code = "382619"
        digest = lambda value: salted_hmac("have.customer-signup", value, algorithm="sha256").hexdigest()
        challenge_key = self.prefix + "signup:challenge:" + challenge
        latest_key = self.prefix + "signup:latest:" + digest(phone)
        payload = {
            "first_name": "Legacy", "last_name": "Customer", "phone_number": phone,
            "email": "legacy-signup@example.test", "date_of_birth": "2005-01-24",
            "pin_hash": make_password("4826"),
        }
        self.redis.hset(challenge_key, mapping={
            "payload": json.dumps(payload), "code_hash": digest(f"{challenge}:{code}"), "attempts": 0,
        })
        self.redis.expire(challenge_key, 300)
        self.redis.set(latest_key, challenge_key, ex=300)
        response = self.client.post("/api/v1/auth/customers/signup/verify/", {
            "challenge_id": challenge, "phone_number": phone, "code": code,
        }, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["first_name"], "Legacy")
        self.assertFalse(self.redis.exists(challenge_key))
