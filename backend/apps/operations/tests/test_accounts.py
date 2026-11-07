from datetime import timedelta
import time
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import Doctor, RefreshToken
from apps.accounts.security.errors import AuthError
from apps.accounts.services.doctor_services.registration import create_doctor_account, _reopen_rejected_doctor
from apps.accounts.services.owner_services.doctor_review import approve_doctor, reject_doctor
from apps.operations.models import ActivityEntry, OwnerAction
from apps.operations.services.actions import account_action
from .helpers import OperationsFixtures


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class AccountAndSessionTests(OperationsFixtures, TestCase):
    def setUp(self):
        self.setup_operations()

    def action(self, action, **changes):
        return account_action(**(dict(actor=self.owner, account_id=self.user.pk, action=action,
            reason="Fictional acceptance test", action_id=uuid4()) | changes))

    def test_anonymous_and_customer_access_denied_and_csrf_required(self):
        self.assertEqual(self.client.get("/api/v1/owner/customers/").status_code, 403)
        self.assertEqual(self.admin.post("/api/v1/owner/stock/adjust/", {}, format="json").status_code, 403)
        self.admin.force_login(self.user, backend="apps.accounts.backends.OwnerBackend")
        self.assertEqual(self.admin.get("/api/v1/owner/overview/").status_code, 403)

    def test_reads_do_not_extend_idle_clock_but_explicit_activity_does(self):
        previous = time.time() - 180
        session = self.admin.session
        session["owner_last_activity_at"] = previous
        session.save()
        for url in ["/api/v1/auth/owners/me/", "/api/v1/owner/session/", "/api/v1/owner/overview/"]:
            self.assertEqual(self.admin.get(url).status_code, 200)
            self.assertEqual(self.admin.session["owner_last_activity_at"], previous)
        before = self.admin.get("/api/v1/owner/session/").json()
        self.assertEqual(self.admin.post("/api/v1/owner/session/activity/", {}, format="json").status_code, 403)
        self.assertEqual(self.admin.session["owner_last_activity_at"], previous)
        response = self.admin_post("session/activity/", {})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertGreater(self.admin.session["owner_last_activity_at"], previous)
        self.assertEqual(before["absolute_expires_at"], response.json()["absolute_expires_at"])

    def test_expired_session_cannot_be_revived_by_activity(self):
        session = self.admin.session
        session["owner_last_activity_at"] = time.time() - 601
        session.save()
        self.assertEqual(self.admin_post("session/activity/", {}).status_code, 403)

    def test_activity_is_throttled_and_cannot_extend_absolute_deadline(self):
        first = self.admin_post("session/activity/", {}).json()
        clock = self.admin.session["owner_last_activity_at"]
        for _ in range(3):
            self.assertEqual(self.admin_post("session/activity/", {}).status_code, 200)
            self.assertEqual(self.admin.session["owner_last_activity_at"], clock)
        session = self.admin.session
        session["owner_started_at"] = time.time() - 7201
        session["owner_last_activity_at"] = time.time()
        session.save()
        self.assertEqual(self.admin_post("session/activity/", {}).status_code, 403)

    def test_block_and_unblock_revoke_hub_terminal_and_refresh_without_changing_pin(self):
        access = self.hub_login().json()["access_token"]
        token = self.start_guest()
        self.assertEqual(self.terminal_login(token).status_code, 200)
        self.user.customer.refresh_from_db()
        pin = self.user.customer.pin_hash
        version = self.user.customer.credential_changed_at
        self.action("block")
        self.action("unblock")
        self.assertEqual(self.hub_me(access).status_code, 401)
        self.assertEqual(self.refresh().status_code, 401)
        self.assertEqual(self.terminal_me(token).status_code, 401)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_disabled)
        self.assertEqual(self.user.customer.pin_hash, pin)
        self.assertGreater(self.user.customer.credential_changed_at, version)
        self.assertFalse(RefreshToken.objects.filter(user=self.user, revoked_at__isnull=True).exists())
        self.assertEqual(self.hub_login().status_code, 200)

    def test_sign_out_is_idempotent_and_different_action_cannot_reuse_id(self):
        identity = uuid4()
        first = self.action("sign-out", action_id=identity)
        self.user.customer.refresh_from_db()
        version = self.user.customer.credential_changed_at
        second = self.action("sign-out", action_id=identity)
        self.user.customer.refresh_from_db()
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(version, self.user.customer.credential_changed_at)
        self.assertEqual(OwnerAction.objects.count(), 1)
        self.assertEqual(ActivityEntry.objects.filter(action="ACCOUNT_SIGN_OUT").count(), 1)
        with self.assertRaises(AuthError):
            self.action("block", action_id=identity)

    def test_doctor_suspension_preserves_approval_mfa_identity_and_password(self):
        doctor_user = create_doctor_account(first_name="Doctor", last_name="Test", phone_number="01212345678",
            email="ops-doctor@example.test", password="Orchid-River-Sample-4826!", professional_license_number="OPS-1",
            specialty="General", clinic_name="Fictional clinic", clinic_address="Fictional address")
        with self.assertRaises(AuthError):
            self.action("block", account_id=doctor_user.pk)
        Doctor.objects.filter(pk=doctor_user.pk).update(approval_status="APPROVED", mfa_secret_encrypted="opaque-test-data",
            mfa_enrolled_at=timezone.now())
        doctor_user.doctor.refresh_from_db()
        password = doctor_user.doctor.password_hash
        self.action("block", account_id=doctor_user.pk)
        self.action("unblock", account_id=doctor_user.pk)
        doctor_user.refresh_from_db()
        self.assertEqual(doctor_user.first_name, "Doctor")
        self.assertEqual(doctor_user.doctor.approval_status, "APPROVED")
        self.assertEqual(doctor_user.doctor.mfa_secret_encrypted, "opaque-test-data")
        self.assertEqual(doctor_user.doctor.password_hash, password)

    def test_customer_search_is_paginated_post_only_and_identity_is_not_writable(self):
        response = self.admin_post("customers/search/", {"query": "sessions@example.test", "page_size": 1})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["total"], 1)
        self.assertEqual(response.json()["items"][0]["id"], self.user.pk)
        self.assertEqual(self.admin.get("/api/v1/owner/customers/?query=private").status_code, 400)
        self.assertEqual(self.admin_post(f"customers/{self.user.pk}/", {"first_name": "Changed"}, method="patch").status_code, 405)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Customer")

    def test_doctor_name_phone_and_id_search_use_concrete_text_fields(self):
        doctor = create_doctor_account(first_name="Laila", last_name="Fictional", phone_number="01212345678",
            email="ops-search@example.test", password="Orchid-River-Sample-4826!", professional_license_number="SEARCH-OPS",
            specialty="General", clinic_name="Fictional clinic", clinic_address="Fictional address")
        for query in ["Laila", doctor.phone_number, doctor.pk, "SEARCH-OPS"]:
            with self.subTest(query=query):
                response = self.admin_post("doctors/search/", {"query": query})
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual([row["id"] for row in response.json()["items"]], [doctor.pk])

    def test_related_text_search_for_order_customer_and_slot_terminal(self):
        order = self.reserve()
        for query in [order.order_number, self.user.pk]:
            with self.subTest(query=query):
                response = self.admin_post("orders/search/", {"query": query})
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual([row["id"] for row in response.json()["items"]], [str(order.pk)])
        response = self.admin_post("slots/search/", {"query": self.terminal.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["id"] for row in response.json()["items"]], [self.slot.pk])

    def test_legacy_application_date_unknown_and_reapplication_records_real_submission(self):
        values = dict(first_name="Doctor", last_name="Test", phone_number="01212345678",
            email="legacy-ops@example.test", password="Orchid-River-Sample-4826!", professional_license_number="LEGACY-OPS",
            specialty="General", clinic_name="Fictional clinic", clinic_address="Fictional address")
        doctor_user = create_doctor_account(**values)
        Doctor.objects.filter(pk=doctor_user.pk).update(application_submitted_at=None)
        response = self.admin.get(f"/api/v1/owner/doctors/{doctor_user.pk}/")
        self.assertIsNone(response.json()["application_submitted_at"])
        reject_doctor(doctor_id=doctor_user.pk, owner=self.owner, reason="Fictional incomplete evidence")
        rejected = self.admin.get(f"/api/v1/owner/doctors/{doctor_user.pk}/").json()
        self.assertEqual(rejected["first_name"], "")
        self.assertIsNone(rejected["phone_number"])
        self.assertIsNone(rejected["application_submitted_at"])
        doctor_user.doctor.refresh_from_db()
        values.pop("password")
        before = timezone.now()
        _reopen_rejected_doctor(doctor_user.pk, **values, password_hash=doctor_user.doctor.password_hash)
        doctor_user.doctor.refresh_from_db()
        self.assertGreaterEqual(doctor_user.doctor.application_submitted_at, before)
        approve_doctor(doctor_id=doctor_user.pk, owner=self.owner)
        result = self.admin.get(f"/api/v1/owner/doctors/{doctor_user.pk}/").json()
        self.assertIsNotNone(result["application_submitted_at"])
        self.assertEqual(result["approval_status"], "APPROVED")
        activity = list(ActivityEntry.objects.filter(target_id=doctor_user.pk).values("metadata"))
        self.assertTrue(all("phone" not in str(row) and "clinic" not in str(row) for row in activity))
