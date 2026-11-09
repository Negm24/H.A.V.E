"""Opt-in browser registration against a separate test DB and temporary private disk.

ADVISOR_REGISTRATION_BROWSER_ACCEPTANCE=1 python manage.py test
tools.advisor_registration_acceptance --keepdb --noinput

Proxy Vite:5177 to backend:8001, copy ready.local.json into the ignored
development/advisor-registration-browser.local.json, then run the opt-in
advisor-registration-live.spec.ts. The coordinator writes result.local.json.
"""
import json
import os
import tempfile
import time
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.test import LiveServerTestCase, override_settings
from django.test.testcases import LiveServerThread, QuietWSGIRequestHandler
from rest_framework.test import APIClient

from apps.accounts.models import Doctor, DoctorRegistrationDraft, DoctorVerificationDocument
from apps.accounts.security.state import get_redis_client
from apps.accounts.services.doctor_services.registration_drafts import document_path
from apps.accounts.services.owner_services.registration import create_owner_account


class RegistrationServerThread(LiveServerThread):
    def _create_server(self, connections_override=None):
        return self.server_class((self.host, self.port), QuietWSGIRequestHandler,
            allow_reuse_address=True, connections_override=connections_override)


@skipUnless(os.environ.get("ADVISOR_REGISTRATION_BROWSER_ACCEPTANCE") == "1", "Explicit isolated registration browser acceptance only.")
@override_settings(
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
    AUTH_CONSOLE_SMS=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    SESSION_COOKIE_SECURE=False,
    CSRF_COOKIE_SECURE=False,
    ALLOWED_HOSTS=["localhost", "127.0.0.1", "backend", "testserver"],
    CSRF_TRUSTED_ORIGINS=["http://localhost:5177", "http://localhost:8001", "http://backend:8001"],
)
class AdvisorRegistrationAcceptance(LiveServerTestCase):
    server_thread_class = RegistrationServerThread
    host = "0.0.0.0"
    port = 8001

    def test_real_browser_registration_and_private_documents(self):
        self.assertNotEqual(settings.DATABASES["default"]["NAME"], os.environ.get("POSTGRES_DB"))
        self.assertTrue(str(settings.DATABASES["default"]["NAME"]).startswith("test_"))
        prefix = "have:test:advisor-registration-browser:" + uuid4().hex + ":"
        with tempfile.TemporaryDirectory(prefix="advisor-registration-private-") as private:
            with override_settings(AUTH_REDIS_PREFIX=prefix, DOCTOR_VERIFICATION_ROOT=private):
                self.redis = get_redis_client()
                self.redis.ping()
                self.addCleanup(lambda: self._cleanup_redis(prefix))
                with patch("apps.accounts.services.doctor_services.signup.generate_verification_code", return_value="123456"), \
                     patch("apps.accounts.services.shared_services.signup_verification.generate_verification_code", return_value="654321"), \
                     patch("apps.accounts.services.doctor_services.signup.send_verification_sms"), \
                     patch("apps.accounts.services.doctor_services.registration_drafts.notify_owner_of_doctor_application") as notification:
                    self._run_browser(private, notification)

    def _cleanup_redis(self, prefix):
        # Never clear the shared Redis database: only this test's random prefix.
        keys = list(self.redis.scan_iter(match=prefix + "*"))
        if keys:
            self.redis.delete(*keys)

    def _run_browser(self, private, notification):
        fixture = {
            "phone": "01200000909", "email": "registration-browser@example.test",
            "password": "Fictional-Registration-Visit-909!", "sms_code": "123456", "email_code": "654321",
            "details": {
                "first_name": "Browser", "last_name": "Applicant", "name_ar": "طبيب تجريبي",
                "clinic_name": "Fictional Browser Clinic", "clinic_name_ar": "عيادة تجريبية",
                "clinic_address": "12 Fictional Cairo Road", "clinic_address_ar": "١٢ شارع تجريبي بالقاهرة",
                "nationality": "EG", "country_of_graduation": "EG", "medical_school": "Fictional browser medical school",
            },
        }
        folder = Path(settings.MEDIA_ROOT) / "advisor-registration-browser"
        folder.mkdir(parents=True, exist_ok=True)
        ready, result = folder / "ready.local.json", folder / "result.local.json"
        result.unlink(missing_ok=True)
        self.addCleanup(lambda: ready.unlink(missing_ok=True))
        ready.write_text(json.dumps(fixture, ensure_ascii=False), encoding="utf-8")
        print("Isolated registration browser fixture ready on backend:8001; live data is not used.", flush=True)
        deadline = time.monotonic() + 240
        while not result.exists() and time.monotonic() < deadline:
            time.sleep(0.5)
        self.assertTrue(result.exists(), "Browser did not finish before the acceptance deadline.")
        self.assertEqual(json.loads(result.read_text(encoding="utf-8"))["status"], "passed")
        self.assertEqual(Doctor.objects.count(), 1)
        doctor = Doctor.objects.select_related("user").get()
        self.assertEqual(doctor.approval_status, "PENDING")
        self.assertEqual(doctor.name_ar, fixture["details"]["name_ar"])
        self.assertEqual(doctor.clinic_name_ar, fixture["details"]["clinic_name_ar"])
        self.assertEqual(doctor.medical_school, fixture["details"]["medical_school"])
        self.assertEqual(doctor.specialty, "")
        self.assertFalse(doctor.professional_license_number)
        self.assertEqual(doctor.syndicate_registration_number, "")
        self.assertEqual(doctor.user.phone_number, "+201200000909")
        self.assertIsNotNone(doctor.user.phone_verified_at)
        self.assertIsNotNone(doctor.user.email_verified_at)
        self.assertTrue(check_password(fixture["password"], doctor.password_hash))
        notification.assert_called_once()
        # The browser explicitly returns to sign-in after confirmed submission.
        # That clears the completed draft cookie/stub for the next applicant,
        # while the doctor's submitted evidence remains independently owned.
        self.assertFalse(DoctorRegistrationDraft.objects.exists())
        documents = list(DoctorVerificationDocument.objects.filter(doctor=doctor, pending_delete=False))
        self.assertEqual({item.kind for item in documents}, {"graduation", "id_front", "id_back", "syndicate"})
        for item in documents:
            path = document_path(item)
            self.assertEqual(path.parent, Path(private).resolve())
            self.assertTrue(path.read_bytes().startswith(b"\xff\xd8\xff"))
            self.assertIsNone(item.draft_id)

        # Review evidence through the actual permission-controlled Django view.
        owner = create_owner_account(first_name="Browser", last_name="Reviewer", phone_number="01100000909", email="registration-owner@example.test", password="Fictional-Owner-Review-909!")
        api = APIClient()
        url = f"/api/v1/auth/owners/doctors/{doctor.pk}/verification/documents/graduation/"
        self.assertIn(api.get(url).status_code, (401, 403))
        api.force_authenticate(user=owner)
        evidence = api.get(url)
        self.assertEqual(evidence.status_code, 200)
        self.assertIn("no-store", evidence["Cache-Control"])
        self.assertIn("private", evidence["Cache-Control"])
        self.assertTrue(b"".join(evidence.streaming_content).startswith(b"\xff\xd8\xff"))
        self.assertEqual(APIClient().get("/media/" + documents[0].private_path).status_code, 404)
        print("Registration browser acceptance verified pending application, private evidence and exactly-once notification.", flush=True)
