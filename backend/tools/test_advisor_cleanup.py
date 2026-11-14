from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import Doctor, User
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.accounts.services.customer_services.registration import create_customer_account
from apps.prescriptions.models import ClinicLetterhead, Prescription
from tools.cleanup_advisor_accounts import execute, preview


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class AuthorizedAdvisorCleanupTests(TestCase):
    def setUp(self):
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.backup = Path(self.folder.name) / 'fixture.dump'
        self.backup.write_bytes(b'PGDMP-test-only')
        doctors = [create_doctor_account(first_name='Youssef' if i == 0 else 'Fictional',
            last_name='Negm' if i == 0 else 'Doctor', phone_number=f'0120000001{i}',
            email=f'cleanup-{i}@example.test', password='Fictional-Cleanup-Password-4826!',
            professional_license_number=f'CLEANUP-TEST-{i}', specialty='General',
            clinic_name='Fictional clinic', clinic_address='Test only') for i in range(4)]
        ClinicLetterhead.objects.create(doctor=doctors[0].doctor)
        for i in range(2):
            Prescription.objects.create(doctor=doctors[0].doctor, reference=f'CLEANUP-TEST-{i}',
                patient_phone_number='+201012345678', snapshot={}, expires_at=timezone.now() + timedelta(days=1))
        self.unrelated = create_customer_account(first_name='Unrelated', last_name='Customer',
            phone_number='+201112345678', email='unrelated@example.test', date_of_birth=date(2000, 1, 1), pin='4826')

    @patch('tools.cleanup_advisor_accounts.get_redis_client')
    def test_exact_authorized_selection_preserves_unrelated_accounts(self, get_redis):
        redis = Mock(); redis.get.return_value = None; redis.scan_iter.return_value = []
        get_redis.return_value = redis
        result = execute(backup=self.backup, expected=preview())
        self.assertEqual(result['deleted']['doctors'], 4)
        self.assertEqual(result['deleted']['prescriptions'], 2)
        self.assertFalse(Doctor.objects.exists())
        self.assertFalse(Prescription.objects.exists())
        self.assertTrue(User.objects.filter(pk=self.unrelated.pk).exists())
        redis.flushdb.assert_not_called()
        redis.flushall.assert_not_called()

    @patch('tools.cleanup_advisor_accounts.get_redis_client')
    def test_changed_preview_aborts_without_deleting(self, get_redis):
        expected = preview()
        expected['lines'] += 1
        with self.assertRaises(CommandError):
            execute(backup=self.backup, expected=expected)
        self.assertEqual(Doctor.objects.count(), 4)
        self.assertEqual(Prescription.objects.count(), 2)

    def test_backup_is_required_before_cleanup(self):
        self.backup.write_bytes(b'not-a-backup')
        with self.assertRaises(CommandError):
            execute(backup=self.backup, expected=preview())
        self.assertEqual(Doctor.objects.count(), 4)
