"""Profile permissions, phone-proof boundaries and bilingual signed header snapshots."""
from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import Doctor, RefreshToken, User
from apps.accounts.security.errors import AuthError
from apps.accounts.services.doctor_services import doctor_profile
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.accounts.tests.helpers import SessionFixtures
from . import services, tests as fixtures
from .models import Prescription
from .pdf import _html


PROFILE = "/api/v1/auth/doctors/profile/"


@override_settings(AUTH_CONSOLE_SMS=True, PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class DoctorProfileTests(SessionFixtures, TestCase):
    setUp = fixtures.PrescriptionTests.setUp
    values = fixtures.PrescriptionTests.values
    issue = fixtures.PrescriptionTests.issue

    def bilingual(self):
        return {
            "clinic_name": "Example clinic", "clinic_name_ar": "عيادة تجريبية",
            "clinic_address": "Fictional address", "clinic_address_ar": "عنوان تجريبي",
            "specialty": "Family medicine", "specialty_ar": "طب الأسرة",
        }

    def test_only_permitted_profile_fields_and_bilingual_clinic_details(self):
        for key, value in [("first_name", "Changed"), ("name_ar", "اسم"), ("email", "other@example.test"), ("medical_school", "Changed"), ("nationality", "GB"), ("professional_license_number", "CHANGED"), ("phone_number", "01200000001")]:
            response = self.api.patch(PROFILE, self.bilingual() | {key: value}, format="json")
            self.assertEqual(response.status_code, 400, (key, response.data))
        response = self.api.patch(PROFILE, self.bilingual(), format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["clinic_name_ar"], "عيادة تجريبية")
        response = self.api.patch(PROFILE, {"clinic_name_ar": ""}, format="json")
        self.assertEqual(response.status_code, 400)
        response = self.api.patch(PROFILE, {"clinic_name_ar": "Repeated English text"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_phone_is_unchanged_until_verified_then_account_id_and_mfa_survive(self):
        original_id, original_phone = self.doctor_user.pk, self.doctor_user.phone_number
        original_mfa = self.doctor_user.doctor.mfa_enrolled_at
        with patch("apps.accounts.services.doctor_services.doctor_profile.send_verification_sms") as sms:
            result = self.api.post(PROFILE + "phone/request/", {"phone_number": "01200000001"}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        code = sms.call_args.kwargs["code"]
        self.doctor_user.refresh_from_db()
        self.assertEqual(self.doctor_user.phone_number, original_phone)
        bad = self.api.post(PROFILE + "phone/verify/", {"phone_number": "01200000001", "challenge_id": result.data["challenge_id"], "code": "000000" if code != "000000" else "111111"}, format="json")
        self.assertEqual(bad.status_code, 400)
        body = {"phone_number": "01200000001", "challenge_id": result.data["challenge_id"], "code": code}
        confirmed = self.api.post(PROFILE + "phone/verify/", body, format="json")
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        self.doctor_user.refresh_from_db()
        self.assertEqual(self.doctor_user.pk, original_id)
        self.assertEqual(self.doctor_user.phone_number, "+201200000001")
        self.assertEqual(self.doctor_user.doctor.mfa_enrolled_at, original_mfa)
        self.assertFalse(RefreshToken.objects.filter(user=self.doctor_user, revoked_at__isnull=True).exists())
        self.assertEqual(self.api.get(PROFILE).status_code, 401)
        self.assertEqual(self.api.post(PROFILE + "phone/verify/", body, format="json").status_code, 401)

    def test_phone_conflict_and_blocked_doctor_cannot_edit(self):
        response = self.api.post(PROFILE + "phone/request/", {"phone_number": self.doctor_user.phone_number}, format="json")
        self.assertEqual(response.status_code, 400)
        User.objects.filter(pk=self.doctor_user.pk).update(is_disabled=True)
        self.assertIn(self.api.patch(PROFILE, self.bilingual(), format="json").status_code, (401, 403))

    def phone_challenge(self, number):
        with patch("apps.accounts.services.doctor_services.doctor_profile.send_verification_sms") as sms:
            response = self.api.post(PROFILE + "phone/request/", {"phone_number": number}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return {"phone_number": number, "challenge_id": response.data["challenge_id"], "code": sms.call_args.kwargs["code"]}

    def test_mutation_rechecks_logout_or_blocking_after_initial_authentication(self):
        stale = User.objects.select_related("doctor").get(pk=self.doctor_user.pk)
        RefreshToken.objects.filter(user=stale).update(revoked_at=timezone.now())
        with self.assertRaises(AuthError):
            doctor_profile.update_profile(stale, self.bilingual(), session_family=self.family)
        User.objects.filter(pk=stale.pk).update(is_disabled=True)
        with self.assertRaises(AuthError):
            doctor_profile.update_profile(stale, self.bilingual())

    def test_phone_proof_cannot_survive_a_prior_credential_reset(self):
        body = self.phone_challenge("01200000002")
        stale = User.objects.select_related("doctor").get(pk=self.doctor_user.pk)
        Doctor.objects.filter(pk=stale.pk).update(credential_changed_at=timezone.now() + timedelta(seconds=1))
        RefreshToken.objects.filter(user=stale).update(revoked_at=timezone.now())
        with self.assertRaises(AuthError):
            doctor_profile.verify_phone_change(stale, **body, source="test", session_family=self.family)
        self.assertEqual(User.objects.get(pk=stale.pk).phone_number, stale.phone_number)

    def test_second_phone_change_invalidates_other_outstanding_challenges(self):
        first = self.phone_challenge("01200000002")
        second = self.phone_challenge("01200000003")
        self.assertEqual(self.api.post(PROFILE + "phone/verify/", second, format="json").status_code, 200)
        fresh = User.objects.select_related("doctor").get(pk=self.doctor_user.pk)
        with self.assertRaises(AuthError):
            doctor_profile.verify_phone_change(fresh, **first, source="test")
        self.assertEqual(User.objects.get(pk=fresh.pk).phone_number, "+201200000003")

    def test_phone_availability_is_rechecked_after_sms(self):
        body = self.phone_challenge("01200000002")
        other = create_doctor_account(first_name="Other", last_name="Doctor", phone_number="01200000002", email="other-profile@example.test", password="Orchid-River-Other-4826!", professional_license_number="PROFILE-OTHER", specialty="General", clinic_name="Other clinic", clinic_address="Other address")
        # Availability may change after sending the SMS: no existing number is overwritten.
        response = self.api.post(PROFILE + "phone/verify/", body, format="json")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(User.objects.get(pk=other.pk).phone_number, "+201200000002")
        self.assertEqual(User.objects.get(pk=self.doctor_user.pk).phone_number, self.doctor_user.phone_number)

    def test_phone_proof_cannot_be_used_by_another_approved_doctor(self):
        body = self.phone_challenge("01200000002")
        other = create_doctor_account(first_name="Other", last_name="Doctor", phone_number="01200000004", email="other-proof@example.test", password="Orchid-River-Other-4826!", professional_license_number="PROOF-OTHER", specialty="General", clinic_name="Other clinic", clinic_address="Other address")
        Doctor.objects.filter(pk=other.pk).update(approval_status="APPROVED", mfa_enrolled_at=timezone.now())
        other.refresh_from_db()
        with self.assertRaises(AuthError):
            doctor_profile.verify_phone_change(other, **body, source="test")
        self.assertEqual(User.objects.get(pk=other.pk).phone_number, "+201200000004")

    def test_new_snapshots_ignore_old_identity_overrides_and_preserve_history(self):
        Doctor.objects.filter(pk=self.doctor_user.pk).update(name_ar="طبيب تجريبي", syndicate_registration_number="12345", **self.bilingual())
        self.doctor_user.refresh_from_db()
        head = services.letterhead(self.doctor_user.doctor)
        head.header_details = {"doctor_name_en": "Unreviewed alias", "details_ar": "LICENCE IN ARABIC SIDE"}
        head.save()
        result = self.issue()
        row = Prescription.objects.get(pk=result["id"])
        original = deepcopy(row.snapshot)
        self.assertEqual(original["doctor"]["name_ar"], "طبيب تجريبي")
        self.assertEqual(original["clinic"]["name_ar"], "عيادة تجريبية")
        self.assertEqual(original["letterhead"]["header_details"], {})
        html = _html(original, False)
        self.assertNotIn("Unreviewed alias", html)
        self.assertIn("Syndicate registration: 12345", html)
        self.assertIn("د. طبيب تجريبي", html)
        arabic = html.split('<div class="header-side header-ar" dir="rtl">')[1].split('</div>')[0]
        self.assertNotIn("12345", arabic)
        self.assertNotIn("TEST-LICENCE", arabic)
        self.api.patch(PROFILE, self.bilingual() | {"clinic_name_ar": "عيادة جديدة"}, format="json")
        row.refresh_from_db()
        self.assertEqual(row.snapshot, original)

    def test_new_letterhead_override_requests_are_rejected(self):
        head = services.letterhead(self.doctor_user.doctor)
        response = self.api.patch("/api/v1/advisor/letterhead/", {"revision": head.revision, "header_details": {"doctor_name_en": "Other person"}}, format="json")
        self.assertEqual(response.status_code, 400)
        response = self.api.post("/api/v1/advisor/letterhead/preview/", {"header_details": {"doctor_name_en": "Other person"}}, format="json")
        self.assertEqual(response.status_code, 400)
