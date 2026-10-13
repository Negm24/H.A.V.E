from unittest.mock import patch
import time

from django.conf import settings
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import Doctor, RefreshToken, User
from apps.accounts.security.tokens import identifier_hash
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.tests.helpers import SessionFixtures


OWNERS = "/api/v1/auth/owners/doctors/"
DOCTORS = "/api/v1/auth/doctors/"
PASSWORD = "Orchid-River-Example-4826!"
APPLICATION = {
    "first_name": "Mona", "last_name": "Hassan", "phone_number": "01212345678",
    "email": "doctor@example.test", "password": PASSWORD,
    "professional_license_number": "LICENSE-1", "specialty": "Family medicine",
    "clinic_name": "Demo Clinic", "clinic_address": "Cairo",
}


@override_settings(DEBUG=True, AUTH_CONSOLE_SMS=True, OWNER_NOTIFICATION_EMAIL="owner@example.test",
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class OwnerDoctorReviewTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.owner = create_owner_account(first_name="Owner", last_name="Tester",
            phone_number="01112345678", email="owner@example.test", password=PASSWORD)
        self.doctor = create_doctor_account(**{k: v for k, v in APPLICATION.items()})
        for target, name in (("apps.accounts.services.doctor_services.signup._deliver_sms", "sms"),
                             ("apps.accounts.services.shared_services.signup_verification.send_verification_email", "email_code")):
            mock = patch(target)
            setattr(self, name, mock.start())
            self.addCleanup(mock.stop)

    # ---- helpers -------------------------------------------------------
    def sign_in_owner(self):
        self.client.force_login(self.owner, backend="apps.accounts.backends.OwnerBackend")
        session = self.client.session
        session.update({"owner_started_at": time.time(), "owner_last_activity_at": time.time()})
        session.save()

    def decide(self, decision, doctor_id=None, **extra):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(f"{OWNERS}{doctor_id or self.doctor.pk}/decision/",
                                    {"decision": decision} | extra, format="json", HTTP_X_CSRFTOKEN=self.csrf())

    def detail(self, doctor_id=None):
        return self.client.get(f"{OWNERS}{doctor_id or self.doctor.pk}/")

    def doctor_login(self, phone="01212345678", password=PASSWORD):
        return self.client.post(DOCTORS + "login/", {"phone_number": phone, "password": password},
                                format="json", HTTP_X_CSRFTOKEN=self.csrf())

    def resignup(self, **changes):
        self.cleanup_redis()  # resend cooldowns and send budgets are not under test here
        start = self.client.post(DOCTORS + "signup/", APPLICATION | changes, format="json")
        self.assertEqual(start.status_code, 202, start.data)
        body = {"challenge_id": start.json()["challenge_id"],
                "phone_number": changes.get("phone_number", APPLICATION["phone_number"])}
        step = self.client.post(DOCTORS + "signup/verify/", body | {"code": self.sms.call_args.kwargs["code"]}, format="json")
        self.assertEqual(step.status_code, 202, step.data)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(DOCTORS + "signup/verify/",
                                    body | {"code": self.email_code.call_args.kwargs["code"]}, format="json")

    def reject_and_resignup(self, times):
        for _ in range(times):
            self.assertEqual(self.decide("reject").status_code, 200)
            self.assertEqual(self.resignup().status_code, 201)

    # ---- access --------------------------------------------------------
    def test_only_owners_with_csrf_can_use_review_endpoints(self):
        self.assertEqual(self.client.get(OWNERS).status_code, 403)
        hub = self.hub_login().json()["access_token"]
        self.assertEqual(self.client.get(OWNERS, HTTP_AUTHORIZATION="Bearer " + hub).status_code, 403)
        self.sign_in_owner()
        self.assertEqual(self.client.get(OWNERS).status_code, 200)
        no_csrf = self.client.post(f"{OWNERS}{self.doctor.pk}/decision/", {"decision": "approve"}, format="json")
        self.assertEqual(no_csrf.status_code, 403)
        self.assertEqual(Doctor.objects.get(pk=self.doctor.pk).approval_status, "PENDING")

    def test_expired_owner_session_is_rejected(self):
        self.sign_in_owner()
        session = self.client.session
        session["owner_last_activity_at"] = time.time() - settings.OWNER_SESSION_IDLE_SECONDS - 1
        session.save()
        self.assertEqual(self.client.get(OWNERS).status_code, 403)

    # ---- list and detail -----------------------------------------------
    def test_list_and_detail_show_application_without_secrets(self):
        self.sign_in_owner()
        listed = self.client.get(OWNERS).json()
        self.assertEqual([d["id"] for d in listed], [self.doctor.pk])
        self.assertEqual(self.client.get(OWNERS + "?status=APPROVED").json(), [])
        self.assertEqual(self.client.get(OWNERS + "?status=BOGUS").status_code, 400)
        body = self.detail().json()
        self.assertEqual(body["professional_license_number"], "LICENSE-1")
        self.assertEqual(body["times_previously_rejected"], 0)
        for secret in ("password_hash", "phone_hash", "email_hash", "mfa_secret_encrypted"):
            self.assertNotIn(secret, body)
        self.assertEqual(self.detail("HAV-D000-000000000000").status_code, 404)

    # ---- decisions -----------------------------------------------------
    def test_approve_records_owner_and_time(self):
        self.sign_in_owner()
        response = self.decide("approve")
        self.assertEqual(response.status_code, 200)
        doctor = Doctor.objects.get(pk=self.doctor.pk)
        self.assertEqual(doctor.approval_status, "APPROVED")
        self.assertEqual(doctor.reviewed_by_owner_id, self.owner.pk)
        self.assertIsNotNone(doctor.reviewed_at)
        self.assertEqual(self.decide("approve").status_code, 409)
        self.assertEqual(self.decide("reject").status_code, 409)

    def test_invalid_decision_input(self):
        self.sign_in_owner()
        self.assertEqual(self.decide("maybe").status_code, 400)
        self.assertEqual(self.decide("reject", reason="x" * 1001).status_code, 400)
        self.assertEqual(self.decide("approve", extra="field").status_code, 400)
        self.assertEqual(self.decide("approve", doctor_id="HAV-D000-000000000000").status_code, 404)

    def test_reject_erases_personal_data_keeps_hashes_and_emails_reason(self):
        RefreshToken.objects.create(user=self.doctor, client_app="ADVISOR", token_hash="x" * 64,
                                    expires_at=timezone.now() + timezone.timedelta(days=1))
        self.sign_in_owner()
        response = self.decide("reject", reason="License could not be verified.")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["times_previously_rejected"], 1)
        user = User.objects.get(pk=self.doctor.pk)
        doctor = user.doctor
        self.assertEqual((user.first_name, user.last_name, user.phone_number, user.email), ("", "", None, None))
        self.assertIsNone(user.phone_verified_at)
        self.assertEqual((doctor.professional_license_number, doctor.specialty, doctor.clinic_name,
                          doctor.clinic_address), (None, "", "", ""))
        self.assertEqual(doctor.approval_status, "REJECTED")
        self.assertEqual(doctor.rejection_count, 1)
        self.assertEqual(doctor.rejection_reason, "License could not be verified.")
        self.assertEqual(response.json()["last_rejection_reason"], "License could not be verified.")
        self.assertEqual(doctor.reviewed_by_owner_id, self.owner.pk)
        self.assertEqual(doctor.phone_hash, identifier_hash("phone", "+201212345678"))
        self.assertEqual(doctor.email_hash, identifier_hash("email", "doctor@example.test"))
        self.assertNotIn("+201212345678", doctor.phone_hash)
        self.assertTrue(user.check_password(PASSWORD))
        self.assertFalse(RefreshToken.objects.filter(user=user, revoked_at__isnull=True).exists())
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["doctor@example.test"])
        self.assertIn("License could not be verified.", mail.outbox[0].body)
        self.assertIn("apply again", mail.outbox[0].body)
        # Rejected rows expose no personal data to the owner either.
        self.assertIsNone(self.detail().json()["email"])

    def test_rejection_stands_when_email_fails(self):
        self.sign_in_owner()
        with patch("apps.accounts.services.shared_services.notifications.send_mail", side_effect=OSError):
            self.assertEqual(self.decide("reject").status_code, 200)
        self.assertEqual(Doctor.objects.get(pk=self.doctor.pk).approval_status, "REJECTED")

    # ---- rejected sign-in and re-signup --------------------------------
    def test_rejected_doctor_signs_in_through_phone_hash(self):
        self.sign_in_owner()
        self.decide("reject", reason="Clinic address could not be confirmed.")
        self.client.logout()
        body = self.doctor_login().json()
        self.assertEqual(body["status"], "REJECTED")
        self.assertEqual(body["rejection_reason"], "Clinic address could not be confirmed.")
        self.assertTrue(body["can_reapply"])
        self.assertNotIn("rejection_count", body)
        self.assertEqual(self.doctor_login(password="Wrong-Password-Example-1!").status_code, 401)

    def test_resignup_reuses_the_same_rows_and_returns_to_pending(self):
        self.sign_in_owner()
        self.decide("reject")
        response = self.resignup(first_name="Mona", professional_license_number="LICENSE-2")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.json()["id"], self.doctor.pk)
        self.assertEqual(User.objects.filter(account_type="DOCTOR").count(), 1)
        user = User.objects.get(pk=self.doctor.pk)
        self.assertEqual((user.phone_number, user.email), ("+201212345678", "doctor@example.test"))
        self.assertIsNotNone(user.email_verified_at)
        doctor = user.doctor
        self.assertEqual(doctor.approval_status, "PENDING")
        self.assertEqual(doctor.professional_license_number, "LICENSE-2")
        self.assertIsNone(doctor.phone_hash)
        self.assertEqual(self.detail().json()["times_previously_rejected"], 1)
        self.assertEqual(self.doctor_login().json()["status"], "WAITING_FOR_APPROVAL")

    def test_resignup_with_new_phone_matches_on_email_and_keeps_id(self):
        self.sign_in_owner()
        self.decide("reject")
        response = self.resignup(phone_number="01512345678")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.json()["id"], self.doctor.pk)
        self.assertEqual(User.objects.get(pk=self.doctor.pk).phone_number, "+201512345678")

    def test_third_rejection_blocks_signup(self):
        self.sign_in_owner()
        self.reject_and_resignup(2)
        self.assertEqual(self.decide("reject").status_code, 200)
        self.assertEqual(Doctor.objects.get(pk=self.doctor.pk).rejection_count, 3)
        self.assertNotIn("apply again", mail.outbox[-1].body)
        self.assertEqual(self.resignup().status_code, 403)
        self.assertEqual(self.resignup(phone_number="01512345678").status_code, 403)  # email still matches
        self.assertEqual(Doctor.objects.get(pk=self.doctor.pk).approval_status, "REJECTED")
        self.client.logout()
        self.assertFalse(self.doctor_login().json()["can_reapply"])

    def test_approval_after_earlier_rejection_keeps_history(self):
        self.sign_in_owner()
        self.reject_and_resignup(1)
        self.assertEqual(self.decide("approve").status_code, 200)
        body = self.detail().json()
        self.assertEqual(body["approval_status"], "APPROVED")
        self.assertEqual(body["times_previously_rejected"], 1)
