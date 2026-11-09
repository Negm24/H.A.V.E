from copy import deepcopy
from django.test import SimpleTestCase, TestCase
from apps.accounts.tests.helpers import SessionFixtures
from .dosage import DosageInput, dose_unit
from .tests import PrescriptionTests

class DosageValidationTests(SimpleTestCase):
    def valid(self, **changes):
        return dict(mode='structured', amount='1', schedule='interval', hours=8, food='after', duration='days', duration_count=3) | changes

    def test_schedules_require_complete_unambiguous_inputs(self):
        for extra in [dict(times=['12:00']), dict(hours=0), dict(amount=0), dict(schedule='prn'), dict(duration='until')]:
            self.assertFalse(DosageInput(data=self.valid(**extra)).is_valid(), extra)
        self.assertTrue(DosageInput(data=self.valid()).is_valid())
        self.assertTrue(DosageInput(data=dict(mode='structured', amount=1, schedule='once')).is_valid())
        self.assertFalse(DosageInput(data=dict(mode='structured', amount=1, schedule='meals', meals=['breakfast'], duration='ongoing')).is_valid())
        self.assertFalse(DosageInput(data=dict(mode='structured', amount=1, schedule='times', times=['12:00','12:00'], duration='ongoing')).is_valid())
        self.assertTrue(DosageInput(data=self.valid(schedule='prn', reason='Fictional indication', max_doses=2)).is_valid())

    def test_catalogue_units_are_fixed_and_unknown_forms_are_not_guessed(self):
        for form, unit in [('Film-coated tablets','tablet'),('Nasal drops','drop'),('Oral suspension','mL'),('Topical cream','application')]:
            self.assertEqual(dose_unit(form),unit)
        self.assertIsNone(dose_unit('Unknown injection'))
        self.assertFalse(DosageInput(data=self.valid(unit='tablet')).is_valid())

class StructuredIssuanceTests(SessionFixtures, TestCase):
    setUp = PrescriptionTests.setUp
    values = PrescriptionTests.values
    def test_structured_snapshot_pdf_history_and_correction(self):
        from .models import Prescription
        from .pdf import _html
        self.medicine.dosage_form='Tablets'
        self.medicine.save()
        from .eligibility import formulation_signature
        self.eligibility.formulation_signature=formulation_signature(self.medicine)
        self.eligibility.save()
        payload=self.values()
        payload['lines'][0]['dosage']=dict(mode='structured',amount='1.000',schedule='times',times=['12:00','21:30'],food='after',duration='days',duration_count=3,notes='تعليمات إضافية')
        response=self.api.post('/api/v1/advisor/prescriptions/issue/',payload,format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.assertIn('12:00',response.data['lines'][0]['instructions'])
        self.assertEqual(response.data['lines'][0]['dose_unit'],'tablet')
        row=Prescription.objects.get(pk=response.data['id'])
        self.assertEqual(row.lines.get().dosage['amount'],'1.000')
        self.assertIn('تعليمات إضافية',_html(row.snapshot,False))
        self.assertIn('instructions_ar',row.snapshot['lines'][0])
        from uuid import uuid4
        correction=deepcopy(payload) | {'action_id':str(uuid4()), 'reason':'Fictional dosage correction'}
        correction['lines'][0]['dosage']['amount']='2'
        fixed=self.api.post(f"/api/v1/advisor/prescriptions/{row.pk}/replace/",correction,format='json')
        self.assertEqual(fixed.status_code,200,fixed.data)
        self.assertEqual(fixed.data['lines'][0]['dosage']['amount'],'2.000')
        row.refresh_from_db()
        self.assertEqual(row.snapshot['lines'][0]['dosage']['amount'],'1.000')
        self.assertIsNotNone(row.revoked_at)
        mismatch=deepcopy(payload) | {'action_id':str(uuid4())}
        mismatch['lines'][0]['dosage']['catalogue_form']='Oral suspension'
        self.assertEqual(self.api.post('/api/v1/advisor/prescriptions/issue/',mismatch,format='json').status_code,409)
        replay=self.api.post('/api/v1/advisor/prescriptions/issue/',payload,format='json')
        self.assertEqual(replay.data['id'],response.data['id'])

    def test_none_is_explicit_and_custom_still_preserves_original_text(self):
        payload=self.values()
        payload['lines'][0]['dosage']={'mode':'none'}
        payload['lines'][0]['instructions']=''
        response=self.api.post('/api/v1/advisor/prescriptions/issue/',payload,format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data['lines'][0]['instructions'],'No instructions recorded.')
        payload=self.values()
        payload['lines'][0]['instructions']=''
        self.assertEqual(self.api.post('/api/v1/advisor/prescriptions/issue/',payload,format='json').status_code,400)


    def test_logo_upload_accepts_modest_larger_files_and_rejects_over_limit(self):
        from io import BytesIO
        from PIL import Image
        from django.core.files.uploadedfile import SimpleUploadedFile
        from apps.accounts.security.errors import AuthError
        from . import services
        head=services.letterhead(self.doctor_user.doctor)
        out=BytesIO()
        Image.new('RGB',(32,32),'purple').save(out,format='PNG')
        content=out.getvalue()+b'0'*(600*1024)
        updated=services.update_letterhead(self.doctor_user,{'revision':head.revision},SimpleUploadedFile('clinic.png',content,content_type='image/png'))
        self.assertTrue(updated['has_logo'])
        with self.assertRaises(AuthError):
            services.update_letterhead(self.doctor_user,{'revision':updated['revision']},SimpleUploadedFile('large.png',content+b'0'*(2*1024*1024),content_type='image/png'))


    def test_medical_school_is_visible_to_owner_and_erased_on_rejection(self):
        from apps.accounts.services.owner_services.registration import create_owner_account
        from apps.accounts.services.owner_services.doctor_review import reject_doctor
        from apps.accounts.api.serializers.owner_serializers import DoctorApplicationOutputSerializer
        from apps.accounts.services.doctor_services.registration import create_doctor_account
        user=create_doctor_account(first_name='School',last_name='Applicant',phone_number='01200000088',email='school@example.test',password='Fictional-School-Password-4826!',professional_license_number='SCHOOL-FICTIONAL',specialty='General',clinic_name='School clinic',clinic_address='Fictional address',medical_school='Recognized overseas medical school')
        self.assertEqual(DoctorApplicationOutputSerializer(user.doctor).data['medical_school'],'Recognized overseas medical school')
        owner=create_owner_account(first_name='School',last_name='Owner',phone_number='01100000088',email='school-owner@example.test',password='Fictional-Owner-Password-4826!')
        reject_doctor(doctor_id=user.pk,owner=owner,reason='Fictional review')
        user.doctor.refresh_from_db()
        self.assertEqual(user.doctor.medical_school,'')
