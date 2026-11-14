"""Opt-in real-browser fixture server, always using Django's separate test DB.

Run with manage.py test tools.advisor_browser_acceptance --noinput, then run
the opt-in frontend advisor-live.spec.ts against a Vite proxy to backend:8001.
Ready/result files contain fictional data only and live under ignored media/.
"""
import json
import os
import time
from pathlib import Path
from unittest import skipUnless

import pyotp
from django.conf import settings
from django.test import LiveServerTestCase, override_settings
from django.utils import timezone

from apps.accounts.security.mfa import encrypt_secret
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.accounts.tests.helpers import SessionFixtures
from apps.catalogue.models import Category, Product
from apps.prescriptions.models import Prescription, PrescribingEligibility


@skipUnless(os.environ.get('ADVISOR_BROWSER_ACCEPTANCE') == '1', 'Explicit isolated browser acceptance only.')
@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class AdvisorBrowserAcceptance(SessionFixtures, LiveServerTestCase):
    host = '0.0.0.0'
    port = 8001

    def test_real_browser_clinic_visit(self):
        self.assertNotEqual(settings.DATABASES['default']['NAME'], os.environ.get('POSTGRES_DB'))
        self.setup_sessions()
        password = 'Fictional-Browser-Visit-4826!'
        doctor = create_doctor_account(first_name='Browser', last_name='Doctor',
            phone_number='01112345678', email='browser-doctor@example.test', password=password,
            professional_license_number='ISOLATED-BROWSER', specialty='General',
            clinic_name='Fictional Browser Clinic', clinic_address='Fictional Cairo address')
        secret = pyotp.random_base32()
        profile = doctor.doctor
        profile.approval_status = 'APPROVED'
        profile.mfa_secret_encrypted = encrypt_secret(secret)
        profile.mfa_enrolled_at = timezone.now()
        profile.save()
        category = Category.objects.create(name_en='Browser fixtures', name_ar='تجريبي')
        for name, rx in [('Browser Rx fixture', True), ('Browser OTC fixture', False)]:
            product = Product.objects.create(sku=name.replace(' ', '-'), category=category,
                name_en=name, name_ar='دواء تجريبي', price='10.00', strength='100 mg',
                dosage_form='Tablets', pack_description='10 tablets', requires_prescription=rx,
                usage_instructions_en='Fixture only', usage_instructions_ar='تجريبي')
            PrescribingEligibility.objects.create(product=product, approved=True,
                review_reason='Fictional isolated browser acceptance only')
        folder = Path(settings.MEDIA_ROOT) / 'advisor-browser'
        folder.mkdir(parents=True, exist_ok=True)
        ready, result = folder / 'ready.local.json', folder / 'result.local.json'
        result.unlink(missing_ok=True)
        self.addCleanup(lambda: ready.unlink(missing_ok=True))
        ready.write_text(json.dumps(dict(phone='01112345678', password=password, secret=secret)), encoding='utf-8')
        print('Isolated Advisor browser fixture ready on backend:8001.', flush=True)
        deadline = time.monotonic() + 240
        while not result.exists() and time.monotonic() < deadline:
            time.sleep(0.5)
        self.assertTrue(result.exists(), 'Browser did not finish before the acceptance deadline.')
        self.assertEqual(json.loads(result.read_text())['status'], 'passed')
        self.assertEqual(Prescription.objects.count(), 1)
        self.assertIsNotNone(Prescription.objects.get().revoked_at)
