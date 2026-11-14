from datetime import date, timedelta
from unittest.mock import patch
from uuid import uuid4
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from apps.accounts.tests.helpers import SessionFixtures
from apps.accounts.models import Doctor, RefreshToken
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.accounts.services.doctor_services.advisor_sessions import (
    start_advisor_session,
)
from apps.catalogue.models import Category, Product
from .models import (
    PrescribingEligibility,
    Prescription,
    PrescriptionAction,
)
from . import services


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class PrescriptionTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.doctor_user = create_doctor_account(
            first_name="Example",
            last_name="Doctor",
            phone_number="01112345678",
            email="doctor@example.test",
            password="Cedar-River-Sample-4826!",
            professional_license_number="TEST-LICENCE",
            specialty="General",
            clinic_name="Example clinic",
            clinic_address="Fictional address",
        )
        doctor = self.doctor_user.doctor
        doctor.approval_status = "APPROVED"
        doctor.mfa_enrolled_at = timezone.now()
        doctor.save()
        result = start_advisor_session(
            self.doctor_user,
            verified_version=doctor.credential_changed_at.isoformat(),
            remember_me=False,
            previous_token=None,
            user_agent="Test",
            ip_address="127.0.0.1",
        )
        self.family = result[1].session_family_id
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION="Bearer " + result[3]["access_token"])
        category = Category.objects.create(name_en="Prescribing test", name_ar="اختبار")
        self.medicine = Product.objects.create(
            sku="RX-FICTIONAL",
            category=category,
            name_en="Fictional medicine",
            name_ar="دواء تجريبي",
            price="10.00",
            pack_description="Test pack",
            usage_instructions_en="Test",
            usage_instructions_ar="اختبار",
            requires_prescription=True,
        )
        self.eligibility = PrescribingEligibility.objects.create(
            product=self.medicine, approved=True, review_reason="Isolated test fixture"
        )

    def values(self, **changes):
        return (
            dict(
                action_id=uuid4(),
                patient_phone_number="+201012345678",
                patient_first_name="Customer",
                patient_last_name="Tester",
                patient_date_of_birth=date(2005, 1, 24),
                expires_at=timezone.now() + timedelta(days=30),
                lines=[
                    dict(
                        product_id=self.medicine.pk,
                        instructions="تعليمات الطبيب كما كتبها",
                        quantity=2,
                        refills=0,
                    )
                ],
            )
            | changes
        )

    def issue(self, **changes):
        return services.issue(self.doctor_user, self.family, self.values(**changes))

    def test_issue_snapshots_without_linking_or_stock_requirement(self):
        result = self.issue()
        self.assertEqual(result["claim_status"], "UNCLAIMED")
        self.assertEqual(result["lines"][0]["instructions"], "تعليمات الطبيب كما كتبها")
        self.assertEqual(result["patient_phone_number"], "+201012345678")
        self.medicine.name_en = "Changed medicine"
        self.medicine.save()
        row = Prescription.objects.get(pk=result["id"])
        self.assertEqual(row.snapshot["lines"][0]["name_en"], "Fictional medicine")
        self.assertEqual(row.lines.get().quantity, 2)

    def test_issue_idempotence_and_changed_content_conflict(self):
        from apps.accounts.security.errors import AuthError

        values = self.values()
        first = services.issue(self.doctor_user, self.family, values)
        self.assertEqual(services.issue(self.doctor_user, self.family, values), first)
        with self.assertRaises(AuthError):
            services.issue(
                self.doctor_user,
                self.family,
                values | {"patient_last_name": "Different"},
            )
        self.assertEqual(Prescription.objects.count(), 1)

    def test_long_running_valid_session_can_issue_and_recover_without_extra_mfa(self):
        RefreshToken.objects.filter(session_family_id=self.family).update(
            created_at=timezone.now() - timedelta(hours=12)
        )
        values = self.values()
        first = services.issue(self.doctor_user, self.family, values)
        self.assertEqual(services.issue(self.doctor_user, self.family, values)['id'], first['id'])
        self.assertEqual(self.issue()['status'], 'ACTIVE')

    def test_revoked_session_cannot_issue(self):
        from apps.accounts.security.errors import AuthError

        RefreshToken.objects.filter(session_family_id=self.family).update(
            revoked_at=timezone.now()
        )
        with self.assertRaises(AuthError):
            self.issue()

    def test_unreviewed_controlled_and_inactive_medicines_fail_atomically(self):
        from apps.accounts.security.errors import AuthError

        for changes in [{"approved": False}, {"approved": True, "controlled": True}]:
            PrescribingEligibility.objects.filter(pk=self.eligibility.pk).update(
                **changes
            )
            with self.assertRaises(AuthError):
                self.issue()
        self.assertEqual(Prescription.objects.count(), 0)

    def test_failed_replacement_leaves_original_active_then_valid_replacement_revokes(
        self,
    ):
        from apps.accounts.security.errors import AuthError

        original = self.issue()
        values = self.values(reason="Correction during in-person visit")
        PrescribingEligibility.objects.filter(pk=self.eligibility.pk).update(
            approved=False
        )
        with self.assertRaises(AuthError):
            services.issue(self.doctor_user, self.family, values, original["id"])
        self.assertIsNone(Prescription.objects.get(pk=original["id"]).revoked_at)
        PrescribingEligibility.objects.filter(pk=self.eligibility.pk).update(
            approved=True
        )
        corrected = services.issue(
            self.doctor_user, self.family, values, original["id"]
        )
        self.assertEqual(corrected["replaces_id"], original["id"])
        self.assertIsNotNone(Prescription.objects.get(pk=original["id"]).revoked_at)
        self.assertEqual(
            services.issue(self.doctor_user, self.family, values, original["id"])["id"],
            corrected["id"],
        )

    def test_revocation_reason_and_idempotence(self):
        issued = self.issue()
        values = dict(action_id=uuid4(), reason="Clinical correction")
        first = services.revoke(self.doctor_user, issued["id"], values)
        self.assertEqual(first["status"], "REVOKED")
        self.assertEqual(services.revoke(self.doctor_user, issued["id"], values), first)
        self.assertEqual(first["revocation_reason"], "Clinical correction")

    def test_api_lookup_only_returns_minimum_patient_identity(self):
        response = self.api.post(
            "/api/v1/advisor/patient-lookup/",
            {"phone_number": "01012345678"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(response.data),
            {
                "found",
                "patient_phone_number",
                "patient_first_name",
                "patient_last_name",
                "patient_date_of_birth",
            },
        )
        self.assertTrue(response.data["found"])

    def test_private_api_rejects_hub_and_cross_doctor_requests(self):
        from apps.accounts.security.errors import AuthError

        issued = self.issue()
        with self.assertRaises(AuthError):
            services.owned(Doctor(pk="HAV-D000-000009999999"), issued["id"])
        self.api.credentials()
        response = self.api.get("/api/v1/advisor/prescriptions/" + issued["id"] + "/")
        self.assertEqual(response.status_code, 401)

    def test_letterhead_revision_snapshot_and_pdf_authorization(self):
        head = services.letterhead(self.doctor_user.doctor)
        services.update_letterhead(
            self.doctor_user,
            dict(
                revision=head.revision,
                contact_line="Original clinic contact",
                alignment="left",
            ),
        )
        issued = self.issue()
        head.refresh_from_db()
        services.update_letterhead(
            self.doctor_user,
            dict(revision=head.revision, contact_line="New clinic contact"),
        )
        self.assertEqual(
            Prescription.objects.get(pk=issued["id"]).snapshot["letterhead"][
                "contact_line"
            ],
            "Original clinic contact",
        )

        with patch(
            "apps.prescriptions.pdf.render_prescription_pdf", return_value=b"%PDF-test"
        ) as render:
            response = self.api.get(
                "/api/v1/advisor/prescriptions/" + issued["id"] + "/pdf/"
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertEqual(
            render.call_args.args[0]["letterhead"]["contact_line"],
            "Original clinic contact",
        )

    def test_formulation_change_requires_a_new_review(self):
        from apps.accounts.security.errors import AuthError
        self.medicine.strength = 'Changed strength'
        self.medicine.save()
        response = self.api.post('/api/v1/advisor/medicines/search/', {}, format='json')
        self.assertEqual(response.json()['total'], 0)
        with self.assertRaises(AuthError):
            self.issue()
        self.assertEqual(Prescription.objects.count(), 0)


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class PrescriptionConcurrencyTests(SessionFixtures, TransactionTestCase):
    # Reuse the isolated doctor/catalogue setup without TestCase's outer transaction.
    setUp = PrescriptionTests.setUp
    values = PrescriptionTests.values

    def race(self, operations):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections
        from apps.accounts.models import User
        from apps.accounts.security.errors import AuthError

        barrier = Barrier(len(operations))

        def execute(operation):
            close_old_connections()
            try:
                user = User.objects.get(pk=self.doctor_user.pk)
                barrier.wait(timeout=10)
                try:
                    return ('ok', operation(user))
                except AuthError as error:
                    return ('conflict', error.status)
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            return list(pool.map(execute, operations))

    def test_simultaneous_identical_issues_create_one_record(self):
        values = self.values()
        operation = lambda user: services.issue(user, self.family, values)
        results = self.race([operation, operation])
        self.assertTrue(all(status == 'ok' for status, _ in results))
        self.assertEqual(results[0][1]['id'], results[1][1]['id'])
        self.assertEqual(Prescription.objects.count(), 1)
        self.assertEqual(PrescriptionAction.objects.count(), 1)

    def test_revoke_racing_replacement_has_one_winner(self):
        original = services.issue(self.doctor_user, self.family, self.values())
        replacement = self.values(reason='Fictional correction')
        revocation = dict(action_id=uuid4(), reason='Fictional revocation')
        results = self.race([
            lambda user: services.issue(user, self.family, replacement, original['id']),
            lambda user: services.revoke(user, original['id'], revocation),
        ])
        self.assertEqual(sorted(status for status, _ in results), ['conflict', 'ok'])
        self.assertIsNotNone(Prescription.objects.get(pk=original['id']).revoked_at)
        self.assertEqual(PrescriptionAction.objects.count(), 2)
