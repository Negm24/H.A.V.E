"""A fictional clinic visit through real Owner, MFA and prescription APIs."""
from datetime import timedelta
from io import BytesIO
from uuid import uuid4

import pyotp
from PIL import Image
from pypdf import PdfReader
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.tests.helpers import SessionFixtures
from apps.catalogue.models import Category, Product
from .models import PrescribingEligibility, Prescription


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ClinicVisitAcceptanceTests(SessionFixtures, TestCase):
    password = 'Orchid-River-Visit-4826!'

    def setUp(self):
        self.setup_sessions()
        self.owner = create_owner_account(first_name='Visit', last_name='Owner', phone_number='01112345678',
            email='visit-owner@example.test', password=self.password)
        self.doctor = create_doctor_account(first_name='Visit', last_name='Doctor', phone_number='01212345678',
            email='visit-doctor@example.test', password=self.password, professional_license_number='FICTIONAL-VISIT',
            specialty='Family medicine', clinic_name='Fictional Clinic', clinic_address='Fictional Cairo address')
        self.owner_client = APIClient(enforce_csrf_checks=True)
        self.doctor_client = APIClient(enforce_csrf_checks=True)
        category = Category.objects.create(name_en='Fictional visit medicines', name_ar='أدوية تجريبية')
        self.medicines = []
        for name, requires_prescription in [('Fictional Rx', True), ('Fictional OTC', False)]:
            product = Product.objects.create(sku=name.replace(' ', '-'), category=category, name_en=name,
                name_ar='دواء تجريبي', price='10.00', strength='100 mg', dosage_form='Tablets',
                pack_description='24 tablets · ٢٤ قرص', usage_instructions_en='Fixture only', usage_instructions_ar='تجريبي',
                requires_prescription=requires_prescription)
            PrescribingEligibility.objects.create(product=product, approved=True, review_reason='Isolated test fixture only')
            self.medicines.append(product)

    def post(self, client, path, values):
        token = client.get('/api/v1/auth/csrf/').json()['csrf_token']
        return client.post(path, values, format='json', HTTP_X_CSRFTOKEN=token)

    def pdf_text(self, prescription_id):
        response = self.doctor_client.get(f'/api/v1/advisor/prescriptions/{prescription_id}/pdf/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertIn('no-store', response['Cache-Control'])
        return '\n'.join(page.extract_text() for page in PdfReader(BytesIO(response.content)).pages)

    def test_owner_approval_mfa_issue_pdf_replacement_and_revocation(self):
        pending = self.post(self.doctor_client, '/api/v1/auth/doctors/login/',
            dict(phone_number='01212345678', password=self.password))
        self.assertEqual(pending.json()['status'], 'WAITING_FOR_APPROVAL')
        signed_owner = self.post(self.owner_client, '/api/v1/auth/owners/login/',
            dict(phone_number='01112345678', password=self.password))
        self.assertEqual(signed_owner.status_code, 200, signed_owner.data)
        approved = self.post(self.owner_client, f'/api/v1/auth/owners/doctors/{self.doctor.pk}/decision/', {'decision': 'approve'})
        self.assertEqual(approved.status_code, 200, approved.data)
        challenge = self.post(self.doctor_client, '/api/v1/auth/doctors/login/',
            dict(phone_number='01212345678', password=self.password)).json()
        signed_doctor = self.post(self.doctor_client, '/api/v1/auth/doctors/login/mfa/',
            dict(mfa_token=challenge['mfa_token'], code=pyotp.TOTP(challenge['secret']).now()))
        self.assertEqual(signed_doctor.status_code, 200, signed_doctor.data)
        self.doctor_client.credentials(HTTP_AUTHORIZATION='Bearer '+signed_doctor.json()['access_token'])

        head = self.doctor_client.get('/api/v1/advisor/letterhead/').json()
        image_bytes = BytesIO()
        Image.new('RGB', (32, 32), '#5d5294').save(image_bytes, format='PNG')
        uploaded = self.doctor_client.post('/api/v1/advisor/letterhead/logo/', {
            'revision': head['revision'], 'file': SimpleUploadedFile('clinic.png', image_bytes.getvalue(), content_type='image/png')}, format='multipart')
        self.assertEqual(uploaded.status_code, 200, uploaded.data)
        updated = self.doctor_client.patch('/api/v1/advisor/letterhead/', {
            'revision': uploaded.json()['revision'], 'contact_line': 'Original clinic contact', 'alignment': 'right'}, format='json')
        self.assertEqual(updated.status_code, 200, updated.data)
        customer_count = User.objects.filter(account_type='CUSTOMER').count()
        lookup = self.post(self.doctor_client, '/api/v1/advisor/patient-lookup/', {'phone_number': '01000000099'})
        self.assertFalse(lookup.json()['found'])
        payload = dict(action_id=str(uuid4()), patient_phone_number='01000000099', patient_first_name='Fictional',
            patient_last_name='Patient', patient_date_of_birth='1990-01-01',
            expires_at=(timezone.now()+timedelta(days=30)).isoformat(),
            lines=[dict(product_id=medicine.pk, instructions='تعليمات الطبيب الأصلية\nAs written.', quantity=2, refills=0)
                   for medicine in self.medicines])
        issued = self.post(self.doctor_client, '/api/v1/advisor/prescriptions/issue/', payload)
        self.assertEqual(issued.status_code, 200, issued.data)
        original_id = issued.json()['id']
        replay = self.post(self.doctor_client, '/api/v1/advisor/prescriptions/issue/', payload)
        self.assertEqual(replay.json()['id'], original_id)
        self.assertEqual(Prescription.objects.count(), 1)
        self.assertEqual(User.objects.filter(account_type='CUSTOMER').count(), customer_count)
        text = self.pdf_text(original_id)
        for expected in ['Fictional Rx', 'Fictional OTC', 'Original clinic contact', "Doctor's signature"]:
            self.assertIn(expected, text)
        self.assertNotIn('٢٤ قرص', text)
        latest_head = self.doctor_client.get('/api/v1/advisor/letterhead/').json()
        self.doctor_client.patch('/api/v1/advisor/letterhead/', {
            'revision': latest_head['revision'], 'contact_line': 'Changed clinic contact'}, format='json')
        self.assertIn('Original clinic contact', self.pdf_text(original_id))

        correction = payload | dict(action_id=str(uuid4()), reason='Corrected after in-person review')
        correction['lines'] = [correction['lines'][0] | {'quantity': 1}]
        replacement = self.post(self.doctor_client, f'/api/v1/advisor/prescriptions/{original_id}/replace/', correction)
        self.assertEqual(replacement.status_code, 200, replacement.data)
        replacement_id = replacement.json()['id']
        self.assertEqual(replacement.json()['replaces_id'], original_id)
        self.assertIn('REVOKED', self.pdf_text(original_id))
        self.assertIn('Changed clinic contact', self.pdf_text(replacement_id))
        revoked = self.post(self.doctor_client, f'/api/v1/advisor/prescriptions/{replacement_id}/revoke/',
            dict(action_id=str(uuid4()), reason='Revoked after clinical review'))
        self.assertEqual(revoked.json()['status'], 'REVOKED')
        self.assertIn('REVOKED', self.pdf_text(replacement_id))
        history = self.post(self.doctor_client, '/api/v1/advisor/prescriptions/search/', {'query': '01000000099'})
        self.assertEqual(history.json()['total'], 2)
