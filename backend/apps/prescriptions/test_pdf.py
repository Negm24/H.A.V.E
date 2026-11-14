"""Document contracts independent of patient databases and network services."""
from io import BytesIO

from django.test import SimpleTestCase
from pypdf import PdfReader

from .pdf import _html, render_prescription_pdf


def fictional_snapshot(line_count=1):
    return {
        'reference': 'HAVE-RX-FICTIONAL-001',
        'issued_at': '2026-11-08T12:00:00+00:00',
        'expires_at': '2026-12-08T23:59:59+02:00',
        'patient': {'first_name': 'مريض', 'last_name': 'تجريبي', 'phone_number': '+201000000001', 'date_of_birth': '1990-01-01'},
        'doctor': {'first_name': 'طبيب', 'last_name': 'تجريبي', 'professional_license_number': 'FICTIONAL-ONLY', 'specialty': 'طب الأسرة'},
        'clinic': {'name': 'عيادة تجريبية', 'address': 'عنوان تجريبي - القاهرة'},
        'letterhead': {'alignment': 'right', 'contact_line': 'بيانات تجريبية فقط'},
        'lines': [{'name_en': f'Fictional medicine {index + 1}', 'strength': '100 mg', 'dosage_form': 'Tablets', 'pack_description': '10 tablets',
                   'instructions': 'تعليمات يكتبها الطبيب كما هي دون ترجمة.\nFollow the written instructions.', 'quantity': 2, 'refills': 0}
                  for index in range(line_count)],
    }


class PrescriptionPdfTests(SimpleTestCase):
    def test_registered_bilingual_header_renders_from_snapshot_only(self):
        snapshot = fictional_snapshot()
        snapshot["header_source"] = "registered-profile-v1"
        snapshot["doctor"].update(first_name="Example", last_name="Doctor", name_ar="طبيب تجريبي", specialty="Family medicine", specialty_ar="طب الأسرة", syndicate_registration_number="12345")
        snapshot["clinic"].update(name="Example clinic", name_ar="عيادة تجريبية", address="Fictional Cairo address", address_ar="عنوان تجريبي بالقاهرة")
        snapshot["letterhead"]["header_details"] = {"doctor_name_en": "FORBIDDEN ALIAS", "doctor_name_ar": "اسم آخر"}
        reader = PdfReader(BytesIO(render_prescription_pdf(snapshot)))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Example Doctor", text)
        self.assertIn("Example clinic", text)
        self.assertIn("Syndicate registration: 12345", text)
        self.assertNotIn("FORBIDDEN ALIAS", text)
        self.assertIn("Doctor's signature", reader.pages[-1].extract_text())

    def test_bilingual_single_page_has_final_signature(self):
        reader = PdfReader(BytesIO(render_prescription_pdf(fictional_snapshot())))
        self.assertEqual(len(reader.pages), 1)
        text = reader.pages[0].extract_text()
        self.assertIn('Fictional medicine 1', text)
        self.assertIn("Doctor's signature", text)
        self.assertAlmostEqual(float(reader.pages[0].mediabox.width), 595.28, delta=1)

    def test_multiple_pages_repeat_reference_and_sign_only_last(self):
        reader = PdfReader(BytesIO(render_prescription_pdf(fictional_snapshot(20))))
        self.assertGreater(len(reader.pages), 1)
        for page in reader.pages:
            self.assertIn('HAVE-RX-FICTIONAL-001', page.extract_text())
        for page in reader.pages[:-1]:
            self.assertNotIn("Doctor's signature", page.extract_text())
        self.assertIn("Doctor's signature", reader.pages[-1].extract_text())

    def test_revoked_reprint_is_marked_on_each_page(self):
        reader = PdfReader(BytesIO(render_prescription_pdf(fictional_snapshot(12), revoked=True)))
        for page in reader.pages:
            self.assertIn('REVOKED', page.extract_text())

    def test_authored_content_is_escaped_and_external_logo_is_rejected(self):
        snapshot = fictional_snapshot()
        snapshot['letterhead']['logo_data_uri'] = 'https://example.invalid/private-logo.png'
        snapshot['lines'][0]['instructions'] = '<img src="http://127.0.0.1/private"> & original instructions'
        html = _html(snapshot, False)
        self.assertNotIn('src="https://example.invalid', html)
        self.assertIn('&lt;img', html)
        self.assertIn('&amp; original instructions', html)

    def test_long_mixed_instructions_reach_last_page_without_clipping(self):
        snapshot = fictional_snapshot()
        snapshot['patient']['first_name'] = 'اسم تجريبي طويل للمريض'
        snapshot['patient']['last_name'] = 'اسم عائلة طويل لاختبار تنسيق الوصفة'
        snapshot['lines'][0]['instructions'] = ('تعليمات مكتوبة بواسطة الطبيب للاختبار فقط. ' * 80) + '\nEND OF AUTHORED INSTRUCTIONS.'
        reader = PdfReader(BytesIO(render_prescription_pdf(snapshot)))
        self.assertGreater(len(reader.pages), 1)
        text = '\n'.join(page.extract_text() for page in reader.pages)
        self.assertIn('END OF AUTHORED INSTRUCTIONS.', text)
        self.assertIn("Doctor's signature", reader.pages[-1].extract_text())

    def test_medicine_details_use_english_catalogue_segments_only(self):
        snapshot = fictional_snapshot()
        snapshot['lines'][0]['pack_description'] = '24 tablets · ٢٤ قرص'
        snapshot['lines'][0]['instructions'] = 'تعليمات الطبيب الأصلية'
        html = _html(snapshot, False)
        self.assertIn('24 tablets', html)
        self.assertNotIn('٢٤ قرص', html)
        self.assertIn('تعليمات الطبيب الأصلية', html)


    def test_simple_bilingual_structured_instructions_fit_one_page(self):
        from .dosage import render_dosage
        snapshot = fictional_snapshot()
        data = dict(mode='structured',amount='1',schedule='times',times=['12:00','21:30'],food='after',duration='days',duration_count=3,notes='Fictional instructions only.')
        snapshot['lines'][0].update(instructions=render_dosage(data,'tablet'),instructions_ar=render_dosage(data,'tablet','ar'))
        reader=PdfReader(BytesIO(render_prescription_pdf(snapshot)))
        self.assertEqual(len(reader.pages),1)
        self.assertIn('21:30',reader.pages[0].extract_text())


    def test_three_column_header_uses_explicit_names_and_no_old_top_label(self):
        snapshot=fictional_snapshot()
        snapshot['letterhead']['header_details']={'doctor_name_en':'Example Doctor','doctor_name_ar':'طبيب تجريبي','details_en':'Family medicine','details_ar':'طب الأسرة'}
        html=_html(snapshot,False)
        self.assertIn('Dr. Example Doctor',html)
        self.assertIn('د. طبيب تجريبي',html)
        self.assertIn('Aref Ruqaa',html)
        self.assertNotIn('AutoPharm · HAVE-RX-FICTIONAL',html)
        self.assertIn('header-side header-ar',html)


    def test_official_brand_is_image_in_upper_header_not_footer(self):
        html=_html(fictional_snapshot(),False)
        self.assertIn('<header class="letterhead"><div class="platform-brand"><img',html)
        self.assertNotIn('element(platformBrand)',html)
        self.assertNotIn('<div class="brand">AUTO PHARM</div>',html)
