from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from unittest.mock import patch
import time

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import DatabaseError, close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from redis.exceptions import RedisError
from rest_framework.test import APIClient

from apps.accounts.models import User, RefreshToken
from apps.accounts.security.challenges import (
    challenge_key, latest_key, recovery_digest, enforce_limit,
)
from apps.accounts.security.state import auth_key, record_failed_login, get_login_lockout_seconds
from apps.accounts.services.customer_services.hub_sessions import start_hub_session
from apps.accounts.services.customer_services.login import authenticate_customer
from apps.accounts.security.errors import AuthError
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.tests.helpers import SessionFixtures
from apps.accounts.services.shared_services.recovery import (
    complete_recovery, request_recovery, verify_recovery,
)
from apps.terminals.services.session_services import operate


PATHS = {
    "CUSTOMER": "/api/v1/auth/customers/hub/pin-reset/",
    "DOCTOR": "/api/v1/auth/doctors/password-reset/",
    "OWNER": "/api/v1/auth/owners/password-reset/",
}


@override_settings(DEBUG=True, AUTH_CONSOLE_SMS=True,
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class RecoveryTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.owner = create_owner_account(first_name="Owner", last_name="Tester",
            phone_number="01112345678", email="owner-reset@example.test", password="Orchid-River-Example-4826!")
        self.doctor = create_doctor_account(first_name="Doctor", last_name="Tester",
            phone_number="01212345678", email="doctor-reset@example.test", password="Orchid-River-Example-4826!",
            professional_license_number="RESET-001", specialty="General", clinic_name="Clinic", clinic_address="Address")
        self.users = {"CUSTOMER": self.user, "DOCTOR": self.doctor, "OWNER": self.owner}
        mock = patch("apps.accounts.services.shared_services.recovery.send_verification_sms")
        self.sms = mock.start()
        self.addCleanup(mock.stop)

    def post(self, role, action, data):
        return self.client.post(PATHS[role] + action + "/", data, format="json", HTTP_X_CSRFTOKEN=self.csrf())

    def request_code(self, role="CUSTOMER", phone=None):
        return self.post(role, "request", {"phone_number": phone or self.users[role].phone_number})

    def proof(self, role="CUSTOMER"):
        response = self.request_code(role)
        self.assertEqual(response.status_code, 202, response.data)
        challenge = response.json()["challenge_id"]
        response = self.post(role, "verify", {
            "challenge_id": challenge, "phone_number": self.users[role].phone_number,
            "code": self.sms.call_args.kwargs["code"],
        })
        self.assertEqual(response.status_code, 200, response.data)
        return response.json()["reset_token"]

    def complete(self, token, role="CUSTOMER", **changes):
        field = "pin" if role == "CUSTOMER" else "password"
        value = "5937" if role == "CUSTOMER" else "Cedar-Mountain-New-9472!"
        data = {"reset_token": token, "new_" + field: value, "confirm_" + field: value}
        return self.post(role, "complete", data | changes)

    def clear_cooldown(self, phone):
        self.redis.delete(auth_key("recovery:cooldown:" + recovery_digest(phone)))

    def test_all_roles_reset_and_never_create_a_login(self):
        for role, user in self.users.items():
            with self.subTest(role=role):
                token = self.proof(role)
                old_version = user.credential_profile.credential_changed_at
                response = self.complete(token, role)
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.json(), {"detail": "Credential updated. Sign in again."})
                self.assertNotIn("sessionid", response.cookies)
                self.assertNotIn("have_hub_refresh", response.cookies)
                self.assertNotIn("access_token", response.json())
                current = User.objects.get(pk=user.pk)
                self.assertTrue(current.check_password("5937" if role == "CUSTOMER" else "Cedar-Mountain-New-9472!"))
                self.assertGreater(current.credential_profile.credential_changed_at, old_version)
                self.assertEqual(self.complete(token, role).status_code, 400)

    def test_customer_reset_revokes_hub_and_terminal_sessions(self):
        hub = self.hub_login().json()["access_token"]
        terminal = self.terminal_login(self.start_guest()).json()["session_token"]
        self.assertEqual(self.complete(self.proof()).status_code, 200)
        self.assertEqual(self.hub_me(hub).status_code, 401)
        self.assertEqual(self.terminal_me(terminal).status_code, 401)
        self.assertEqual(self.refresh().status_code, 401)
        self.assertEqual(self.hub_login().status_code, 401)
        self.assertEqual(self.hub_login(pin="5937").status_code, 200)

    def test_owner_reset_invalidates_native_session(self):
        self.client.force_login(self.owner, backend="apps.accounts.backends.OwnerBackend")
        session = self.client.session
        session.update({"owner_started_at": time.time(), "owner_last_activity_at": time.time()})
        session.save()
        self.assertEqual(self.client.get("/api/v1/auth/owners/me/").status_code, 200)
        self.assertEqual(self.complete(self.proof("OWNER"), "OWNER").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/auth/owners/me/").status_code, 403)
        response = self.client.post("/api/v1/auth/owners/login/", {
            "phone_number": self.owner.phone_number, "password": "Cedar-Mountain-New-9472!",
        }, format="json", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(response.status_code, 200)

    def test_doctor_reset_preserves_mfa_and_approval(self):
        profile = self.doctor.doctor
        profile.mfa_secret_encrypted = "test-encrypted-value"
        profile.mfa_enrolled_at = timezone.now()
        profile.approval_status = "REJECTED"
        profile.save()
        response = self.complete(self.proof("DOCTOR"), "DOCTOR")
        self.assertEqual(response.status_code, 200)
        profile.refresh_from_db()
        self.assertEqual(profile.mfa_secret_encrypted, "test-encrypted-value")
        self.assertIsNotNone(profile.mfa_enrolled_at)
        self.assertEqual(profile.approval_status, "REJECTED")

    def test_unknown_disabled_unverified_and_nonstaff_are_generic(self):
        unknown = self.request_code(phone="01512345678")
        self.assertEqual(unknown.status_code, 202)
        self.sms.assert_not_called()
        User.objects.filter(pk=self.user.pk).update(phone_verified_at=None)
        response = self.request_code()
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["detail"], unknown.json()["detail"])
        self.sms.assert_not_called()
        User.objects.filter(pk=self.owner.pk).update(is_staff=False)
        self.assertEqual(self.request_code("OWNER").status_code, 202)
        User.objects.filter(pk=self.doctor.pk).update(is_disabled=True)
        self.assertEqual(self.request_code("DOCTOR").status_code, 202)
        self.sms.assert_not_called()

    def test_same_phone_roles_are_isolated(self):
        User.objects.filter(pk=self.doctor.pk).update(phone_number=self.user.phone_number)
        self.doctor.refresh_from_db()
        token = self.proof()
        self.assertEqual(self.complete(token, "DOCTOR").status_code, 400)
        self.assertEqual(self.complete(token).status_code, 200)
        self.assertTrue(User.objects.get(pk=self.doctor.pk).check_password("Orchid-River-Example-4826!"))

    def test_csrf_and_no_terminal_reset_route(self):
        for role in PATHS:
            self.assertEqual(self.client.post(PATHS[role] + "request/").status_code, 403)
        self.assertEqual(self.client.post("/api/v1/auth/customers/terminal/pin-reset/request/").status_code, 404)

    def test_weak_pin_mismatch_numeric_and_weak_password_do_not_consume_proof(self):
        token = self.proof()
        for fields in (
            {"new_pin": "1111", "confirm_pin": "1111"},
            {"confirm_pin": "4826"}, {"new_pin": 5937, "confirm_pin": 5937},
            {"account_type": "OWNER"},
        ):
            self.assertEqual(self.complete(token, **fields).status_code, 400)
        self.assertEqual(self.complete(token).status_code, 200)
        token = self.proof("OWNER")
        self.assertEqual(self.complete(token, "OWNER", new_password="1234", confirm_password="1234").status_code, 400)
        self.assertEqual(self.complete(token, "OWNER").status_code, 200)

    def test_code_attempt_limit_and_single_verification(self):
        challenge = self.request_code().json()["challenge_id"]
        code = self.sms.call_args.kwargs["code"]
        data = {"challenge_id": challenge, "phone_number": self.user.phone_number,
                "code": "000000" if code != "000000" else "111111"}
        for _ in range(5):
            self.assertEqual(self.post("CUSTOMER", "verify", data).status_code, 400)
        self.assertEqual(self.post("CUSTOMER", "verify", data | {"code": code}).status_code, 400)
        self.clear_cooldown(self.user.phone_number)
        token = self.proof()
        self.assertEqual(self.post("CUSTOMER", "verify", data | {
            "challenge_id": token.split(".")[0], "code": self.sms.call_args.kwargs["code"],
        }).status_code, 400)
        self.assertEqual(self.complete(token).status_code, 200)

    def test_resend_replaces_verified_proof_and_expires_codes(self):
        token = self.proof()
        self.clear_cooldown(self.user.phone_number)
        response = self.request_code()
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.complete(token).status_code, 400)
        key = challenge_key("CUSTOMER", response.json()["challenge_id"])
        self.redis.expire(key, 0)
        self.assertEqual(self.post("CUSTOMER", "verify", {
            "challenge_id": response.json()["challenge_id"], "phone_number": self.user.phone_number,
            "code": self.sms.call_args.kwargs["code"],
        }).status_code, 400)

    def test_proof_expiry_and_wrong_phone_binding(self):
        token = self.proof()
        self.redis.expire(challenge_key("CUSTOMER", token.split(".")[0]), 0)
        self.assertEqual(self.complete(token).status_code, 400)
        self.clear_cooldown(self.user.phone_number)
        challenge = self.request_code().json()["challenge_id"]
        self.assertEqual(self.post("CUSTOMER", "verify", {
            "challenge_id": challenge, "phone_number": self.owner.phone_number,
            "code": self.sms.call_args.kwargs["code"],
        }).status_code, 400)

    def test_send_cooldown_phone_and_source_budgets(self):
        self.assertEqual(self.request_code().status_code, 202)
        response = self.request_code()
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)
        for _ in range(4):
            self.clear_cooldown(self.user.phone_number)
            self.assertEqual(self.request_code().status_code, 202)
        self.clear_cooldown(self.user.phone_number)
        self.assertEqual(self.request_code().status_code, 429)
        self.cleanup_redis()
        for _ in range(20):
            enforce_limit("recovery-send", "127.0.0.1", 20, 600)
        self.assertEqual(self.request_code().status_code, 429)

    def test_delivery_failure_is_generic_and_invalidates_challenge(self):
        self.sms.side_effect = OSError("test")
        response = self.request_code()
        self.assertEqual(response.status_code, 202)
        self.assertFalse(self.redis.exists(challenge_key("CUSTOMER", response.json()["challenge_id"])))

    @override_settings(DEBUG=False)
    def test_no_mock_sms_outside_development(self):
        self.assertEqual(self.request_code().status_code, 503)
        self.sms.assert_not_called()

    def test_redis_outage_fails_closed(self):
        with patch("apps.accounts.security.challenges.get_redis_client", side_effect=RedisError):
            self.assertEqual(self.request_code().status_code, 503)

    def test_database_failure_rolls_back_and_burns_proof(self):
        token = self.proof()
        with patch("apps.accounts.models.customer.Customer.save", side_effect=DatabaseError):
            self.assertEqual(self.complete(token).status_code, 503)
        self.assertTrue(User.objects.get(pk=self.user.pk).check_password("4826"))
        self.assertEqual(self.complete(token).status_code, 400)

    def test_reset_clears_account_lockout_not_source_limits(self):
        for _ in range(5):
            record_failed_login("CUSTOMER", self.user.phone_number)
        self.assertGreater(get_login_lockout_seconds("CUSTOMER", self.user.phone_number), 0)
        self.assertEqual(self.complete(self.proof()).status_code, 200)
        self.assertEqual(get_login_lockout_seconds("CUSTOMER", self.user.phone_number), 0)
        self.assertTrue(list(self.redis.scan_iter(match=self.prefix + "limits:*")))

    def test_login_verified_before_reset_cannot_create_session_after_reset(self):
        verified = authenticate_customer(phone_number=self.user.phone_number, pin="4826", source="test")
        guest = self.start_guest()
        self.assertEqual(self.complete(self.proof()).status_code, 200)
        with self.assertRaises(AuthError):
            start_hub_session(verified, remember_me=False, previous_token=None,
                              user_agent="test", ip_address="127.0.0.1")
        with self.assertRaises(AuthError):
            operate(self.terminal, "login", guest, user=verified)


@override_settings(DEBUG=True, AUTH_CONSOLE_SMS=True,
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class RecoveryConcurrencyTests(SessionFixtures, TransactionTestCase):
    def setUp(self):
        self.setup_sessions()

    def test_only_one_concurrent_reset_can_consume_proof(self):
        with patch("apps.accounts.services.shared_services.recovery.send_verification_sms") as sms:
            challenge = request_recovery(account_type="CUSTOMER",
                phone_number=self.user.phone_number, source="test")
            proof = verify_recovery(account_type="CUSTOMER", phone_number=self.user.phone_number,
                challenge_id=challenge["challenge_id"], code=sms.call_args.kwargs["code"], source="test")

        def finish(_):
            close_old_connections()
            try:
                complete_recovery(account_type="CUSTOMER", reset_token=proof["reset_token"],
                                  new_credential="5937", source="test")
                return "success"
            except AuthError:
                return "denied"
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(finish, range(2)))
        self.assertCountEqual(results, ["success", "denied"])
        self.assertTrue(User.objects.get(pk=self.user.pk).check_password("5937"))
