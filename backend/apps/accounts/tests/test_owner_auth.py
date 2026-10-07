from datetime import date
from unittest.mock import patch
import time

from django.conf import settings
from django.test import TestCase, override_settings
from django.urls import include, path, reverse
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from redis.exceptions import RedisError
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.services.customer_services.registration import create_customer_account
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.accounts.services.owner_services.registration import create_owner_account


# Test docs with an explicit URLconf: the test runner sets DEBUG=False before
# importing config.urls, where development-only docs are deliberately omitted.
urlpatterns = [
    path("api/v1/auth/", include("apps.accounts.api.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
]


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class OwnerApiTests(TestCase):
    password = "Orchid-River-Sample-4826!"

    @classmethod
    def setUpTestData(cls):
        cls.owner = create_owner_account(
            first_name="Owner", last_name="Tester", phone_number="01112345678",
            email="owner-api@example.test", password=cls.password,
        )

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        # API tests isolate Redis; the real backend still checks passwords and roles.
        for name, value in (
            ("allow_login_attempt_from_source", True),
            ("get_login_lockout_seconds", 0),
            ("record_failed_login", 0),
            ("clear_login_failures", None),
        ):
            patcher = patch(f"apps.accounts.security.authentication.{name}", return_value=value)
            self.addCleanup(patcher.stop)
            setattr(self, name, patcher.start())

    def csrf(self):
        response = self.client.get(reverse("accounts_api:csrf"))
        self.assertEqual(response.status_code, 200)
        return response.json()["csrf_token"]

    def sign_in(self, **changes):
        data = {"phone_number": "01112345678", "password": self.password}
        data.update(changes)
        return self.client.post(
            reverse("accounts_api:owner-login"), data, format="json",
            HTTP_X_CSRFTOKEN=self.csrf(),
        )

    def test_login_sets_session_and_me_returns_safe_identity(self):
        response = self.sign_in()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "id": self.owner.pk, "account_type": "OWNER",
            "first_name": "Owner", "last_name": "Tester",
        })
        self.assertTrue(response.cookies[settings.SESSION_COOKIE_NAME]["httponly"])
        self.assertEqual(response.cookies[settings.SESSION_COOKIE_NAME]["samesite"], "Strict")
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(self.client.get(reverse("accounts_api:owner-me")).status_code, 200)
        self.assertNotIn("password", response.json())
        self.assertIn("owner_started_at", self.client.session)

    def test_missing_csrf_rejected_before_authentication(self):
        response = self.client.post(reverse("accounts_api:owner-login"), {
            "phone_number": "01112345678", "password": self.password,
        }, format="json")
        self.assertEqual(response.status_code, 403)
        self.allow_login_attempt_from_source.assert_not_called()

    def test_untrusted_origin_rejected(self):
        response = self.client.post(reverse("accounts_api:owner-login"), {
            "phone_number": "01112345678", "password": self.password,
        }, format="json", HTTP_X_CSRFTOKEN=self.csrf(), HTTP_ORIGIN="https://untrusted.example")
        self.assertEqual(response.status_code, 403)

    def test_wrong_password_rejected(self):
        self.assertEqual(self.sign_in(password="Wrong-password").status_code, 401)
        self.assertNotIn("_auth_user_id", self.client.session)
        self.record_failed_login.assert_called_once()

    def test_unknown_owner_rejected(self):
        self.assertEqual(self.sign_in(phone_number="01212345678").status_code, 401)

    def test_disabled_or_nonstaff_owner_rejected(self):
        for changes in ({"is_disabled": True}, {"is_disabled": False, "is_staff": False}):
            with self.subTest(changes=changes):
                User.objects.filter(pk=self.owner.pk).update(**changes)
                self.assertEqual(self.sign_in().status_code, 401)

    def test_customer_and_doctor_cannot_login_as_owner(self):
        create_customer_account(
            first_name="Customer", last_name="Tester", phone_number="01212345678",
            email="customer-api@example.test", date_of_birth=date(2000, 1, 1), pin="4826",
        )
        create_doctor_account(
            first_name="Doctor", last_name="Tester", phone_number="01012345678",
            email="doctor-api@example.test", password=self.password,
            professional_license_number="API-TEST-001", specialty="General",
            clinic_name="Test clinic", clinic_address="Test address",
        )
        self.assertEqual(self.sign_in(phone_number="01212345678", password="4826").status_code, 401)
        self.assertEqual(self.sign_in(phone_number="01012345678").status_code, 401)

    def test_invalid_input(self):
        for changes in ({"phone_number": "invalid"}, {"password": ""}, {"password": "x" * 129}):
            with self.subTest(changes=changes):
                self.assertEqual(self.sign_in(**changes).status_code, 400)

    def test_redis_failure_denies_login(self):
        self.allow_login_attempt_from_source.side_effect = RedisError("test")
        self.assertEqual(self.sign_in().status_code, 401)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_rate_limit_and_lockout_deny_correct_password(self):
        self.allow_login_attempt_from_source.return_value = False
        self.assertEqual(self.sign_in().status_code, 401)
        self.allow_login_attempt_from_source.return_value = True
        self.get_login_lockout_seconds.return_value = 30
        self.assertEqual(self.sign_in().status_code, 401)

    def test_anonymous_me_is_forbidden(self):
        self.assertEqual(self.client.get(reverse("accounts_api:owner-me")).status_code, 403)

    def test_logout_requires_csrf_and_ends_session(self):
        self.sign_in()
        self.assertEqual(self.client.post(reverse("accounts_api:owner-logout")).status_code, 403)
        response = self.client.post(
            reverse("accounts_api:owner-logout"), HTTP_X_CSRFTOKEN=self.csrf(),
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.client.get(reverse("accounts_api:owner-me")).status_code, 403)

    def test_idle_absolute_and_missing_clock_expire_session(self):
        for change in ("idle", "absolute", "missing"):
            with self.subTest(change=change):
                self.sign_in()
                session = self.client.session
                if change == "idle":
                    session["owner_last_activity_at"] = time.time() - 601
                elif change == "absolute":
                    session["owner_started_at"] = time.time() - 7201
                else:
                    del session["owner_started_at"]
                session.save()
                self.assertEqual(self.client.get(reverse("accounts_api:owner-me")).status_code, 403)

    def test_disabling_owner_invalidates_access(self):
        self.sign_in()
        User.objects.filter(pk=self.owner.pk).update(is_disabled=True)
        self.assertEqual(self.client.get(reverse("accounts_api:owner-me")).status_code, 403)

    def test_health_does_not_extend_owner_activity(self):
        self.sign_in()
        session = self.client.session
        previous = time.time() - 120
        session["owner_last_activity_at"] = previous
        session.save()
        self.client.get(reverse("health"))
        self.assertEqual(self.client.session["owner_last_activity_at"], previous)

    @override_settings(DEBUG=True, ROOT_URLCONF=__name__)
    def test_docs_schema_and_local_assets(self):
        response = self.client.get("/api/docs/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "drf_spectacular_sidecar/swagger-ui-dist/swagger-ui-bundle.js")
        self.assertIn("csrftoken", response.cookies)
        response = self.client.get("/api/schema/?format=json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("/api/v1/auth/owners/login/", response.json()["paths"])
