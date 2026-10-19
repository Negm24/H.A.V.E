from unittest.mock import patch
import json

from django.core import mail
from django.test import TestCase, override_settings
from redis.exceptions import RedisError

from apps.accounts.models import Doctor, User
from apps.accounts.security.state import doctor_challenge_key
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.accounts.tests.helpers import SessionFixtures


SIGNUP = "/api/v1/auth/doctors/signup/"
VERIFY = "/api/v1/auth/doctors/signup/verify/"
PASSWORD = "Orchid-River-Example-4826!"
APPLICATION = {
    "first_name": "Mona", "last_name": "Hassan", "phone_number": "01212345678",
    "email": "Doctor@Example.test", "password": PASSWORD,
    "professional_license_number": "EG-MED-12345", "specialty": "Family medicine",
    "clinic_name": "Demo Clinic", "clinic_address": "12 Example Street, Cairo",
}


@override_settings(DEBUG=False, AUTH_CONSOLE_SMS=True, OWNER_NOTIFICATION_EMAIL="owner@example.test",
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class DoctorSignupTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        mock = patch("apps.accounts.services.doctor_services.signup._deliver_sms")
        self.sms = mock.start()
        self.addCleanup(mock.stop)
        email = patch("apps.accounts.services.shared_services.signup_verification.send_verification_email")
        self.email = email.start()
        self.addCleanup(email.stop)

    def start(self, **changes):
        return self.client.post(SIGNUP, APPLICATION | changes, format="json")

    def verify(self, challenge_id, *, code=None, phone="01212345678"):
        return self.client.post(VERIFY, {
            "challenge_id": challenge_id, "phone_number": phone,
            "code": code or self.sms.call_args.kwargs["code"],
        }, format="json")

    def finish(self, challenge_id, *, phone="01212345678"):
        """Both verification steps: SMS code (202), then the emailed code."""
        response = self.verify(challenge_id, phone=phone)
        self.assertEqual(response.status_code, 202, getattr(response, "data", None))
        return self.verify(challenge_id, code=self.email.call_args.kwargs["code"], phone=phone)

    def apply(self, **changes):
        response = self.start(**changes)
        self.assertEqual(response.status_code, 202, response.data)
        with self.captureOnCommitCallbacks(execute=True):
            return self.finish(response.json()["challenge_id"],
                               phone=changes.get("phone_number", "01212345678"))

    def test_verified_application_creates_pending_doctor_and_notifies_owner(self):
        response = self.start()
        self.assertEqual(response.status_code, 202, response.data)
        self.assertEqual(set(response.json()), {"challenge_id", "expires_in", "resend_after", "detail"})
        self.assertFalse(User.objects.filter(account_type="DOCTOR").exists())
        with self.captureOnCommitCallbacks(execute=True):
            response = self.finish(response.json()["challenge_id"])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.email.call_args.kwargs["email"], "doctor@example.test")
        body = response.json()
        self.assertTrue(body["id"].startswith("HAV-D678-"))
        self.assertEqual(body["approval_status"], "PENDING")
        self.assertFalse(body["mfa_enrolled"])
        self.assertEqual(body["email"], "doctor@example.test")
        self.assertNotIn("access_token", body)
        user = User.objects.get(pk=body["id"])
        self.assertTrue(user.check_password(PASSWORD))
        self.assertIsNotNone(user.phone_verified_at)
        self.assertEqual(len(mail.outbox), 1)
        email = mail.outbox[0]
        self.assertEqual(email.to, ["owner@example.test"])
        self.assertIn(user.pk, email.body)
        for secret in (PASSWORD, user.doctor.password_hash):
            self.assertNotIn(secret, email.body)

    def test_redis_holds_only_a_password_hash(self):
        challenge = self.start().json()["challenge_id"]
        payload = json.loads(self.redis.hget(doctor_challenge_key(challenge), "payload"))
        self.assertNotIn("password", payload)
        self.assertNotIn(PASSWORD, json.dumps(payload))
        self.assertTrue(payload["password_hash"])

    def test_weak_password_and_invalid_fields_send_no_code(self):
        for changes in (
            {"password": "short"}, {"password": "password12345"}, {"password": "doctor@example.test"},
            {"specialty": "   "}, {"phone_number": "0123"}, {"first_name": "Mona1"},
            {"account_type": "OWNER"},
        ):
            with self.subTest(changes=changes):
                self.assertEqual(self.start(**changes).status_code, 400)
        self.sms.assert_not_called()

    def test_wrong_code_then_success_then_replay(self):
        challenge = self.start().json()["challenge_id"]
        code = self.sms.call_args.kwargs["code"]
        self.assertEqual(self.verify(challenge, code="000000" if code != "000000" else "111111").status_code, 400)
        self.assertEqual(self.finish(challenge).status_code, 201)
        self.assertEqual(self.verify(challenge, code=self.email.call_args.kwargs["code"]).status_code, 400)
        self.assertEqual(Doctor.objects.count(), 1)

    def test_duplicates_are_reported_only_after_verification(self):
        create_doctor_account(first_name="Existing", last_name="Doctor", phone_number="01212345678",
                              email="existing@example.test", password=PASSWORD,
                              professional_license_number="EXISTING-1", specialty="General",
                              clinic_name="Clinic", clinic_address="Address")
        self.assertEqual(self.apply().status_code, 409)
        self.assertEqual(self.apply(phone_number="01512345678",
                                    professional_license_number="EXISTING-1").status_code, 409)
        self.assertEqual(Doctor.objects.count(), 1)

    def test_customer_phone_may_also_register_as_doctor(self):
        response = self.apply(phone_number=self.user.phone_number, email=self.user.email)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(User.objects.filter(phone_number=self.user.phone_number).count(), 2)

    def test_pending_customer_and_doctor_signups_for_one_phone_are_independent(self):
        with patch("apps.accounts.services.customer_services.signup._deliver_sms") as customer_sms:
            customer = self.client.post("/api/v1/auth/customers/signup/", {
                "first_name": "Mona", "last_name": "Hassan", "phone_number": "01512345678",
                "email": "mona@example.test", "date_of_birth": "24-01-1990", "pin": "4826",
            }, format="json")
            self.assertEqual(customer.status_code, 202)
            doctor = self.start(phone_number="01512345678")
            self.assertEqual(doctor.status_code, 202)
            self.assertEqual(self.finish(doctor.json()["challenge_id"], phone="01512345678").status_code, 201)
            customer_verify = lambda code: self.client.post("/api/v1/auth/customers/signup/verify/", {
                "challenge_id": customer.json()["challenge_id"], "phone_number": "01512345678",
                "code": code,
            }, format="json")
            self.assertEqual(customer_verify(customer_sms.call_args.kwargs["code"]).status_code, 202)
            response = customer_verify(self.email.call_args.kwargs["code"])
        self.assertEqual(response.status_code, 201)

    def test_resend_cooldown(self):
        self.assertEqual(self.start().status_code, 202)
        response = self.start()
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)

    def test_notification_failure_does_not_block_application(self):
        with patch("apps.accounts.services.shared_services.notifications.send_mail", side_effect=OSError):
            self.assertEqual(self.apply().status_code, 201)
        self.assertEqual(Doctor.objects.get().approval_status, "PENDING")

    def test_redis_outage_fails_closed(self):
        with patch("apps.accounts.services.doctor_services.signup.get_redis_client", side_effect=RedisError):
            self.assertEqual(self.start().status_code, 503)

    @override_settings(AUTH_CONSOLE_SMS=False)
    def test_no_mock_sms_without_explicit_opt_in(self):
        self.assertEqual(self.start().status_code, 503)
        self.sms.assert_not_called()
