from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from threading import Barrier
from uuid import uuid4

from django.contrib.auth.hashers import make_password
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import Doctor, DoctorRegistrationDraft, DoctorVerificationDocument
from apps.accounts.services.doctor_services import registration_drafts as drafts
from apps.accounts.security.errors import SignupError
from apps.accounts.services.owner_services.doctor_review import reject_doctor, approve_doctor
from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.tests.helpers import SessionFixtures
from apps.accounts.tests.test_doctor_signup import APPLICATION, PASSWORD, BASE


def image_file(name="fictional.jpg"):
    data = BytesIO()
    Image.new("RGB", (220, 160), "white").save(data, format="JPEG", exif=b"")
    return SimpleUploadedFile(name, data.getvalue(), content_type="image/jpeg")


@override_settings(DEBUG=False, AUTH_CONSOLE_SMS=True, OWNER_NOTIFICATION_EMAIL="owner@example.test",
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class RegistrationTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.storage = override_settings(DOCTOR_VERIFICATION_ROOT=self.temp.name)
        self.storage.enable()
        self.addCleanup(self.storage.disable)

    def create_draft(self, **changes):
        data = APPLICATION | changes
        data.pop("password")
        data["phone_number"] = "+201212345678"
        data["email"] = "doctor@example.test"
        draft, secret = drafts.create_verified_draft(data | {"password_hash": make_password(PASSWORD)})
        self.client.cookies[drafts.cookie_name()] = secret
        return draft, secret

    def post(self, path, body):
        return self.client.post(BASE + path, body, format="json", HTTP_X_CSRFTOKEN=self.csrf())

    def upload(self, kind, file=None):
        return self.client.put(BASE + f"documents/{kind}/", {"image": file or image_file()},
                               format="multipart", HTTP_X_CSRFTOKEN=self.csrf())

    def fill(self, nationality="EG"):
        for kind in ["graduation", "syndicate"] + (["id_front", "id_back"] if nationality == "EG" else ["passport"]):
            response = self.upload(kind)
            self.assertEqual(response.status_code, 200, response.data)

    def test_verification_creates_private_draft_without_application_or_notification(self):
        with patch("apps.accounts.services.doctor_services.signup._deliver_sms") as sms, patch(
            "apps.accounts.services.shared_services.signup_verification.send_verification_email"
        ) as email:
            start = self.post("start/", APPLICATION)
            self.assertEqual(start.status_code, 202, start.data)
            body = {"phone_number": APPLICATION["phone_number"], "challenge_id": start.data["challenge_id"]}
            self.assertEqual(self.post("verify/", body | {"code": sms.call_args.kwargs["code"]}).status_code, 202)
            draft = self.post("verify/", body | {"code": email.call_args.kwargs["code"]})
        self.assertEqual(draft.status_code, 200, draft.data)
        self.assertEqual(draft.data["status"], "DRAFT")
        self.assertFalse(Doctor.objects.exists())
        self.assertEqual(len(mail.outbox), 0)
        self.assertTrue(draft.cookies[drafts.cookie_name()]["httponly"])
        self.assertEqual(draft.cookies[drafts.cookie_name()]["path"], drafts.COOKIE_PATH)
        self.assertNotIn(PASSWORD, str(draft.data))
        self.assertNotIn("password_hash", draft.data["data"])
        self.assertEqual(draft.data["data"]["name_ar"], APPLICATION["name_ar"])

    def test_required_documents_and_idempotent_final_submit(self):
        draft, _ = self.create_draft()
        action = {"action_id": str(uuid4())}
        self.assertEqual(self.post("submit/", action).status_code, 400)
        self.fill()
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post("submit/", action)
            retry = self.post("submit/", action)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(response.data["id"], retry.data["id"])
        self.assertEqual(Doctor.objects.count(), 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(self.post("submit/", {"action_id": str(uuid4())}).status_code, 409)
        draft.refresh_from_db()
        self.assertEqual(draft.data, {})
        self.assertEqual(draft.password_hash, "")
        self.assertEqual(DoctorVerificationDocument.objects.filter(doctor_id=response.data["id"]).count(), 4)
        self.assertEqual(self.client.patch(BASE + "current/", {"first_name": "Other"}, format="json",
                                         HTTP_X_CSRFTOKEN=self.csrf()).status_code, 409)

    def test_foreign_passport_route_and_optional_licence(self):
        self.create_draft(nationality="GB", country_of_graduation="EG", professional_license_number="")
        self.assertEqual(self.upload("id_front").status_code, 400)
        self.fill("GB")
        response = self.post("submit/", {"action_id": str(uuid4())})
        self.assertEqual(response.status_code, 201, response.data)
        doctor = Doctor.objects.get()
        self.assertIsNone(doctor.professional_license_number)
        self.assertEqual(doctor.specialty, "")
        self.assertEqual(doctor.syndicate_registration_number, "")

    def test_cookie_is_not_an_advisor_token_and_uploads_are_private(self):
        _, secret = self.create_draft()
        self.fill()
        anonymous = APIClient()
        self.assertEqual(anonymous.get(BASE + "current/").status_code, 401)
        self.assertEqual(anonymous.get(BASE + "documents/graduation/").status_code, 401)
        self.assertEqual(anonymous.get("/api/v1/auth/doctors/me/", HTTP_AUTHORIZATION="Bearer " + secret).status_code, 401)
        response = self.client.get(BASE + "documents/graduation/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertNotIn("private_path", str(self.client.get(BASE + "current/").data))
        self.assertTrue(b"".join(response.streaming_content))

    def test_resume_requires_password_rotates_token_and_preserves_original_deadline(self):
        draft, old = self.create_draft()
        original_saved = draft.last_saved_at
        self.assertEqual(self.post("resume/", {"phone_number": APPLICATION["phone_number"], "password": "Wrong"}).status_code, 401)
        response = self.post("resume/", {"phone_number": APPLICATION["phone_number"], "password": PASSWORD})
        self.assertEqual(response.status_code, 200, response.data)
        draft.refresh_from_db()
        self.assertEqual(draft.last_saved_at, original_saved)
        self.assertEqual(response.data["expires_at"], draft.expires_at)
        stale = APIClient()
        stale.cookies[drafts.cookie_name()] = old
        self.assertEqual(stale.get(BASE + "current/").status_code, 401)

    def test_expiry_cleanup_and_failed_file_deletion_remain_retryable(self):
        draft, _ = self.create_draft()
        self.upload("graduation")
        doc = DoctorVerificationDocument.objects.get()
        path = drafts.document_path(doc)
        DoctorRegistrationDraft.objects.filter(pk=draft.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.client.get(BASE + "current/").status_code, 401)
        with patch.object(Path, "unlink", side_effect=OSError("offline")):
            with self.captureOnCommitCallbacks(execute=True):
                result = drafts.cleanup_registrations()
        self.assertGreaterEqual(result["deferred"], 1)
        self.assertFalse(DoctorRegistrationDraft.objects.exists())
        self.assertTrue(DoctorVerificationDocument.objects.get(pk=doc.pk).pending_delete)
        self.assertTrue(path.exists())
        self.assertEqual(drafts.cleanup_registrations()["deferred"], 0)
        self.assertFalse(path.exists())
        self.assertFalse(DoctorVerificationDocument.objects.exists())

    def test_nationality_change_retires_inapplicable_identity_images(self):
        self.create_draft()
        self.fill()
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(BASE + "current/", {"nationality": "GB"}, format="json",
                                         HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual({d["kind"] for d in response.data["documents"]}, {"graduation", "syndicate"})
        self.assertEqual(self.post("submit/", {"action_id": str(uuid4())}).status_code, 400)

    def test_csrf_and_contact_changes_are_enforced(self):
        self.assertEqual(self.client.post(BASE + "start/", APPLICATION, format="json").status_code, 403)
        self.create_draft()
        self.assertEqual(self.client.patch(BASE + "current/", {"clinic_name": "Changed"}, format="json").status_code, 403)
        for forbidden in ({"phone_number": "+201512345678"}, {"email": "new@example.test"}, {"password": PASSWORD}, {"specialty": "General"}):
            response = self.client.patch(BASE + "current/", forbidden, format="json", HTTP_X_CSRFTOKEN=self.csrf())
            self.assertEqual(response.status_code, 400, response.data)

    def test_malformed_and_unsupported_images_do_not_replace_saved_document(self):
        self.create_draft()
        self.upload("graduation")
        original = DoctorVerificationDocument.objects.get().pk
        response = self.upload("graduation", SimpleUploadedFile("fake.jpg", b"not an image", content_type="image/jpeg"))
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(DoctorVerificationDocument.objects.get().pk, original)
        self.assertEqual(self.upload("unknown").status_code, 404)

    def test_owner_optional_metadata_approval_and_rejection_erasure(self):
        self.create_draft()
        self.fill()
        user_id = self.post("submit/", {"action_id": str(uuid4())}).data["id"]
        endpoint = f"/api/v1/auth/owners/doctors/{user_id}/verification/"
        self.assertEqual(APIClient().get(endpoint).status_code, 403)
        owner = create_owner_account(first_name="Owner", last_name="Test", phone_number="01112345678",
                                     email="owner@example.test", password=PASSWORD)
        self.client.force_login(owner, backend="apps.accounts.backends.OwnerBackend")
        session = self.client.session
        session["owner_started_at"] = session["owner_last_activity_at"] = timezone.now().timestamp()
        session.save()
        self.assertEqual(len(self.client.get(endpoint).data["documents"]), 4)
        metadata = self.client.patch(endpoint, {"syndicate_registration_number": "1234", "specialty_ar": "طب الأسرة"},
                                     format="json", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(metadata.status_code, 200, metadata.data)
        self.assertEqual(metadata.data["syndicate_registration_number"], "1234")
        document = self.client.get(endpoint + "documents/graduation/")
        self.assertEqual(document.status_code, 200)
        self.assertTrue(b"".join(document.streaming_content))
        with self.captureOnCommitCallbacks(execute=True):
            reject_doctor(doctor_id=user_id, owner=owner)
        doctor = Doctor.objects.get(pk=user_id)
        self.assertEqual(doctor.name_ar, "")
        self.assertEqual(doctor.syndicate_registration_number, "")
        self.assertFalse(DoctorVerificationDocument.objects.exists())
        self.assertEqual(list(Path(self.temp.name).glob("*.jpg")), [])

    def test_approval_does_not_require_checklist_or_syndicate_number(self):
        self.create_draft(professional_license_number="")
        self.fill()
        user_id = self.post("submit/", {"action_id": str(uuid4())}).data["id"]
        owner = create_owner_account(first_name="Owner", last_name="Test", phone_number="01112345678",
                                     email="owner@example.test", password=PASSWORD)
        approve_doctor(doctor_id=user_id, owner=owner)
        doctor = Doctor.objects.get(pk=user_id)
        self.assertEqual(doctor.approval_status, "APPROVED")
        self.assertEqual(doctor.syndicate_registration_number, "")
        self.assertEqual(doctor.verification_documents.count(), 4)

    def test_expiring_submitted_draft_preserves_account_lifetime_documents(self):
        draft, _ = self.create_draft()
        self.fill()
        user_id = self.post("submit/", {"action_id": str(uuid4())}).data["id"]
        DoctorRegistrationDraft.objects.filter(pk=draft.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        drafts.cleanup_registrations()
        self.assertFalse(DoctorRegistrationDraft.objects.exists())
        self.assertEqual(DoctorVerificationDocument.objects.filter(doctor_id=user_id, pending_delete=False).count(), 4)
        self.assertTrue(all(drafts.document_path(doc).is_file() for doc in DoctorVerificationDocument.objects.all()))

    def test_start_over_erases_only_this_authenticated_draft(self):
        self.create_draft()
        self.fill()
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post("restart/", {})
        self.assertEqual(response.status_code, 204, response.data)
        self.assertFalse(DoctorRegistrationDraft.objects.exists())
        self.assertFalse(DoctorVerificationDocument.objects.exists())
        self.assertEqual(list(Path(self.temp.name).glob("*.jpg")), [])
        self.assertEqual(self.client.get(BASE + "current/").status_code, 401)

    def test_leaving_completed_registration_preserves_doctor_and_its_documents(self):
        self.create_draft()
        self.fill()
        user_id = self.post("submit/", {"action_id": str(uuid4())}).data["id"]
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post("restart/", {})
        self.assertEqual(response.status_code, 204, response.data)
        self.assertFalse(DoctorRegistrationDraft.objects.exists())
        self.assertTrue(Doctor.objects.filter(pk=user_id).exists())
        self.assertEqual(DoctorVerificationDocument.objects.filter(doctor_id=user_id).count(), 4)
        self.assertEqual(len(list(Path(self.temp.name).glob("*.jpg"))), 4)


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ConcurrentRegistrationTests(TransactionTestCase):
    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("Concurrent registration requires the intended PostgreSQL runtime.")
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        storage = override_settings(DOCTOR_VERIFICATION_ROOT=self.temp.name)
        storage.enable()
        self.addCleanup(storage.disable)
        data = APPLICATION | {"phone_number": "+201212345678", "email": "doctor@example.test"}
        data.pop("password")
        self.draft, self.secret = drafts.create_verified_draft(data | {"password_hash": make_password(PASSWORD)})
        for kind in ("graduation", "id_front", "id_back", "syndicate"):
            drafts.upload_document(self.secret, kind, image_file())

    def submit_together(self, identifiers):
        barrier = Barrier(2)

        def submit(action_id):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                user, created = drafts.submit_draft(self.secret, action_id)
                return user.pk, 201 if created else 200
            except SignupError as exc:
                return None, exc.status
            finally:
                close_old_connections()

        with patch("apps.accounts.services.doctor_services.registration_drafts.notify_owner_of_doctor_application") as notify:
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(submit, identifiers))
            self.assertEqual(notify.call_count, 1)
        self.assertEqual(Doctor.objects.count(), 1)
        self.assertEqual(DoctorVerificationDocument.objects.filter(doctor__isnull=False).count(), 4)
        return results

    def test_concurrent_identical_final_submissions_create_one_application(self):
        action = uuid4()
        results = self.submit_together([action, action])
        self.assertEqual(sorted(status for _, status in results), [200, 201])
        self.assertEqual(results[0][0], results[1][0])

    def test_concurrent_different_actions_cannot_duplicate_an_application(self):
        results = self.submit_together([uuid4(), uuid4()])
        self.assertEqual(sorted(status for _, status in results), [201, 409])
