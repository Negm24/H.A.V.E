from datetime import timedelta
from unittest.mock import patch
import time

from django.conf import settings
from django.test import TestCase, override_settings
from django.utils import timezone
import pyotp

from apps.accounts.models import Doctor, RefreshToken, User
from apps.accounts.security.mfa import decrypt_secret
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.accounts.services.shared_services.recovery import (
    complete_recovery, request_recovery, verify_recovery,
)
from apps.accounts.tests.helpers import SessionFixtures


ADVISOR = "/api/v1/auth/doctors/"
PASSWORD = "Orchid-River-Example-4826!"


def code_at(secret, offset_steps=0):
    return pyotp.TOTP(secret).at(time.time() + 30 * offset_steps)


@override_settings(DEBUG=True, AUTH_CONSOLE_SMS=True,
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class AdvisorAuthTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.doctor = create_doctor_account(first_name="Mona", last_name="Hassan",
            phone_number="01212345678", email="doctor@example.test", password=PASSWORD,
            professional_license_number="LICENSE-1", specialty="Family medicine",
            clinic_name="Demo Clinic", clinic_address="Cairo")

    def set_status(self, status):
        Doctor.objects.filter(pk=self.doctor.pk).update(approval_status=status)

    def login(self, **changes):
        return self.client.post(ADVISOR + "login/", {"phone_number": "01212345678", "password": PASSWORD} | changes,
                                format="json", HTTP_X_CSRFTOKEN=self.csrf())

    def mfa(self, token, code):
        return self.client.post(ADVISOR + "login/mfa/", {"mfa_token": token, "code": code},
                                format="json", HTTP_X_CSRFTOKEN=self.csrf())

    def me(self, token):
        return self.client.get(ADVISOR + "me/", HTTP_AUTHORIZATION="Bearer " + token)

    def advisor_refresh(self):
        return self.client.post(ADVISOR + "refresh/", HTTP_X_CSRFTOKEN=self.csrf())

    def enroll(self, **login_changes):
        self.set_status("APPROVED")
        step = self.login(**login_changes).json()
        response = self.mfa(step["mfa_token"], code_at(step["secret"]))
        self.assertEqual(response.status_code, 200, response.data)
        return step["secret"], response

    def test_pending_and_rejected_get_status_without_tokens(self):
        response = self.login()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "WAITING_FOR_APPROVAL")
        self.assertNotIn("mfa_token", response.json())
        self.assertNotIn(settings.ADVISOR_REFRESH_COOKIE_NAME, response.cookies)
        self.set_status("REJECTED")
        body = self.login().json()
        self.assertEqual(body["status"], "REJECTED")
        self.assertTrue(body["can_reapply"])
        self.assertNotIn("mfa_token", body)
        self.assertFalse(RefreshToken.objects.filter(client_app="ADVISOR").exists())

    def test_wrong_password_and_unknown_doctor_are_generic(self):
        wrong = self.login(password="Wrong-Password-Example-1!")
        unknown = self.login(phone_number="01512345678")
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.json(), unknown.json())
        self.set_status("APPROVED")
        self.assertEqual(self.login(password="Wrong-Password-Example-1!").status_code, 401)

    def test_first_approved_login_enrolls_authenticator(self):
        self.set_status("APPROVED")
        step = self.login().json()
        self.assertEqual(step["status"], "MFA_ENROLLMENT_REQUIRED")
        self.assertTrue(step["otpauth_uri"].startswith("otpauth://totp/"))
        self.assertIsNone(Doctor.objects.get(pk=self.doctor.pk).mfa_enrolled_at)
        response = self.mfa(step["mfa_token"], code_at(step["secret"]))
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual(body["token_type"], "Bearer")
        self.assertTrue(body["doctor"]["mfa_enrolled"])
        self.assertIn(settings.ADVISOR_REFRESH_COOKIE_NAME, response.cookies)
        cookie = response.cookies[settings.ADVISOR_REFRESH_COOKIE_NAME]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["path"], settings.ADVISOR_REFRESH_COOKIE_PATH)
        doctor = Doctor.objects.get(pk=self.doctor.pk)
        self.assertNotEqual(doctor.mfa_secret_encrypted, step["secret"])
        self.assertEqual(decrypt_secret(doctor.mfa_secret_encrypted), step["secret"])
        self.assertEqual(self.me(body["access_token"]).status_code, 200)

    def test_enrolled_login_requires_code_and_never_resends_secret(self):
        secret, _ = self.enroll()
        step = self.login().json()
        self.assertEqual(step["status"], "MFA_REQUIRED")
        self.assertNotIn("secret", step)
        self.assertNotIn("otpauth_uri", step)
        self.assertEqual(self.mfa(step["mfa_token"], code_at(secret, 1)).status_code, 200)

    def test_authenticator_code_cannot_be_replayed(self):
        secret, _ = self.enroll()
        used = code_at(secret, 1)
        self.assertEqual(self.mfa(self.login().json()["mfa_token"], used).status_code, 200)
        response = self.mfa(self.login().json()["mfa_token"], used)
        self.assertEqual(response.status_code, 401)
        self.assertIn("already used", response.json()["detail"])

    def test_five_wrong_codes_end_challenge_and_lock_account(self):
        secret, _ = self.enroll()
        token = self.login().json()["mfa_token"]
        right = code_at(secret, 1)
        wrong = "000000" if right != "000000" else "111111"
        for _ in range(5):
            self.assertEqual(self.mfa(token, wrong).status_code, 401)
        self.assertEqual(self.mfa(token, right).status_code, 401)
        self.assertEqual(self.login().status_code, 401)

    def test_invalid_or_expired_challenge(self):
        self.set_status("APPROVED")
        self.assertEqual(self.mfa("not-a-real-token", "123456").status_code, 401)
        step = self.login().json()
        self.cleanup_redis()
        self.assertEqual(self.mfa(step["mfa_token"], code_at(step["secret"])).status_code, 401)
        self.assertIsNone(Doctor.objects.get(pk=self.doctor.pk).mfa_enrolled_at)

    def test_new_login_replaces_previous_challenge(self):
        self.set_status("APPROVED")
        first = self.login().json()
        second = self.login().json()
        self.assertEqual(self.mfa(first["mfa_token"], code_at(first["secret"])).status_code, 401)
        self.assertEqual(self.mfa(second["mfa_token"], code_at(second["secret"])).status_code, 200)

    def test_password_change_between_steps_invalidates_challenge(self):
        self.set_status("APPROVED")
        step = self.login().json()
        Doctor.objects.filter(pk=self.doctor.pk).update(credential_changed_at=timezone.now() + timedelta(seconds=1))
        self.assertEqual(self.mfa(step["mfa_token"], code_at(step["secret"])).status_code, 401)
        self.assertIsNone(Doctor.objects.get(pk=self.doctor.pk).mfa_enrolled_at)

    def test_refresh_rotation_replay_and_logout(self):
        _, response = self.enroll(remember_me=True)
        row = RefreshToken.objects.get(client_app="ADVISOR")
        self.assertGreater(row.expires_at, timezone.now() + timedelta(days=6))
        old_cookie = self.client.cookies[settings.ADVISOR_REFRESH_COOKIE_NAME].value
        refreshed = self.advisor_refresh()
        self.assertEqual(refreshed.status_code, 200)
        self.assertEqual(self.me(refreshed.json()["access_token"]).status_code, 200)
        self.client.cookies[settings.ADVISOR_REFRESH_COOKIE_NAME] = old_cookie
        self.assertEqual(self.advisor_refresh().status_code, 401)
        self.assertEqual(self.me(refreshed.json()["access_token"]).status_code, 401)

        _, response = self.enroll_again()
        access = response.json()["access_token"]
        logout = self.client.post(ADVISOR + "logout/", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(self.me(access).status_code, 401)

    def enroll_again(self):
        secret = decrypt_secret(Doctor.objects.get(pk=self.doctor.pk).mfa_secret_encrypted)
        step = self.login().json()
        return secret, self.mfa(step["mfa_token"], code_at(secret, 1))

    def test_hub_and_advisor_tokens_are_not_interchangeable(self):
        _, response = self.enroll()
        advisor = response.json()["access_token"]
        hub = self.hub_login().json()["access_token"]
        self.assertEqual(self.me(hub).status_code, 401)
        self.assertEqual(self.hub_me(advisor).status_code, 401)

    def test_disabled_or_unapproved_doctor_loses_access(self):
        _, response = self.enroll()
        access = response.json()["access_token"]
        User.objects.filter(pk=self.doctor.pk).update(is_disabled=True)
        self.assertEqual(self.me(access).status_code, 401)
        self.assertEqual(self.advisor_refresh().status_code, 401)

    def test_password_recovery_revokes_advisor_sessions(self):
        _, response = self.enroll()
        access = response.json()["access_token"]
        with patch("apps.accounts.services.shared_services.recovery.send_verification_sms") as sms:
            challenge = request_recovery(account_type="DOCTOR", phone_number=self.doctor.phone_number, source="t")
            proof = verify_recovery(account_type="DOCTOR", phone_number=self.doctor.phone_number,
                                    challenge_id=challenge["challenge_id"], code=sms.call_args.kwargs["code"],
                                    source="t")
        complete_recovery(account_type="DOCTOR", reset_token=proof["reset_token"],
                          new_credential="Cedar-Mountain-New-9472!", source="t")
        self.assertEqual(self.me(access).status_code, 401)
        self.assertIsNotNone(Doctor.objects.get(pk=self.doctor.pk).mfa_enrolled_at)

    def test_csrf_and_strict_input(self):
        self.assertEqual(self.client.post(ADVISOR + "login/", {"phone_number": "01212345678",
                                                               "password": PASSWORD}, format="json").status_code, 403)
        self.assertEqual(self.login(account_type="OWNER").status_code, 400)
        self.assertEqual(self.mfa("token", 123456).status_code, 400)

    @override_settings(MFA_ENCRYPTION_KEY="")
    def test_missing_encryption_key_fails_closed(self):
        self.set_status("APPROVED")
        self.assertEqual(self.login().status_code, 503)
