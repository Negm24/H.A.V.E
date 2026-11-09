"""Private, deterministic prescription documents built from the issued snapshot."""
import base64
import re
import unicodedata
from datetime import datetime
from html import escape
from io import BytesIO
from pathlib import Path
from zoneinfo import ZoneInfo

from pypdf import PdfReader, PdfWriter
from weasyprint import HTML
from weasyprint.text.fonts import FontConfiguration
from weasyprint.urls import URLFetcherResponse


STYLE = """
@page {
  size: A4;
  margin: 18mm 18mm 56mm;
  @bottom-left { content: element(reference); font-size:7pt; color:#626778; vertical-align:bottom; padding-bottom:5mm; }
  @bottom-right { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #626778; }
}
@page:first { @bottom-left { content:none; } }
* { box-sizing: border-box; }
body { font: 10pt/1.6 "Noto Sans Arabic", "Noto Sans", sans-serif; color: #252737; }
.reference { position: running(reference); font-size: 8pt; color: #626778; padding-bottom: 4mm; }
.letterhead { position:relative; border-bottom: 2pt solid #5d5294; padding-bottom: 4mm; margin-bottom: 4mm; }
.platform-brand { position:absolute; top:-12mm; right:0; width:35mm; height:9.154mm; overflow:hidden; }
.platform-brand img { position:absolute; width:129.231mm; height:77.538mm; max-width:none; max-height:none; left:-93.154mm; top:-59.769mm; }
.header-grid { display:table; width:100%; table-layout:fixed; }
.header-grid > div { display:table-cell; vertical-align:top; overflow-wrap:anywhere; }
.header-side {width:29%; font-size:7.5pt; line-height:1.5; white-space:pre-line;}
.header-ar {font-family:"Aref Ruqaa", "Noto Sans Arabic",serif;font-size:11pt;line-height:1.5;text-align:right;}
.header-center {width:42%;text-align:center;padding:0 3mm;}
.doctor-display {font-size:12pt;font-weight:bold;line-height:1.5;}
.brand { font-family: "Noto Sans", sans-serif; color: #5d5294; font-size: 11pt; font-weight: bold; letter-spacing: 1pt; }
.logo { margin: 4mm 0; max-height: 20mm; max-width: 50mm; object-fit: contain; border-radius: 2mm; }
.clinic { font-size: 14pt; font-weight: bold; margin: 2mm 0; overflow-wrap: anywhere; }
.muted { color: #626778; font-size: 9pt; }
h1 { margin: 0 0 4mm; font-size: 16pt; font-weight: bold; }
.identity { width: 100%; border-collapse: collapse; margin-bottom: 5mm; table-layout: fixed; }
.identity td { width: 50%; padding: 2mm 3mm 2mm 0; vertical-align: top; overflow-wrap: anywhere; }
.label { display: block; color: #626778; font-size: 8pt; }
.patient { font-size: 12pt; font-weight: bold; }
.medicine { border: 1px solid #dce0ea; border-left: 3px solid #9181d0; padding: 4mm; margin: 0 0 4mm; break-inside: avoid; overflow-wrap: anywhere; }
.medicine h2 { font: bold 11pt/1.5 "Noto Sans", sans-serif; margin: 0 0 1mm; }
.medicine-details { font: 9pt/1.5 "Noto Sans", sans-serif; color: #4b5262; }
.medicine-meta { display: table; width: 100%; margin-top: 2mm; }
.medicine-meta > div { display: table-cell; width: 50%; vertical-align: top; }
.instructions { margin: 2mm 0 0; }
.instructions--structured { font-size:9pt; line-height:1.4; }
.instructions--structured .instruction-line { min-height:1.4em; }
.instruction-line { white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1.6em; }
.revoked { position: fixed; top: 80mm; left: 0; width: 174mm; text-align: center; color: #b42318; opacity: .2; font: bold 52pt "Noto Sans", sans-serif; transform: rotate(-25deg); }
.revoked-label { color: #b42318; border: 1px solid #b42318; padding: 2mm 4mm; font-weight: bold; margin-bottom: 4mm; }
"""


def _text(value):
    return escape(str(value if value is not None else ""), quote=True)


def _direction(value):
    for character in str(value):
        direction = unicodedata.bidirectional(character)
        if direction in ('R', 'AL'):
            return 'rtl'
        if direction == 'L':
            return 'ltr'
    return 'ltr'


def _date(value):
    if not value:
        return ""
    try:
        date = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if date.tzinfo:
            date = date.astimezone(ZoneInfo("Africa/Cairo"))
        return date.strftime("%d %b %Y")
    except ValueError:
        return str(value)


def _logo(value):
    """Admit the embedded raster snapshot only. Never fetch URLs or file paths."""
    if not isinstance(value, str) or len(value) > 2_800_000:
        return ""
    if not re.fullmatch(r"data:image/(?:png|jpeg);base64,[A-Za-z0-9+/=]+", value):
        return ""
    try:
        data = base64.b64decode(value.split(",", 1)[1], validate=True)
    except ValueError:
        return ""
    if len(data) > 2 * 1024 * 1024 or not (data.startswith(b"\x89PNG\r\n\x1a\n") or data.startswith(b"\xff\xd8\xff")):
        return ""
    return value


def _english_details(value):
    """Project the English part of catalogue's bilingual middle-dot fields."""
    return ' · '.join(
        part.strip() for part in str(value or '').split('·')
        if part.strip() and not re.search(r'[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]', part)
    )


def _html(snapshot, revoked):
    patient = snapshot.get("patient", {})
    doctor = snapshot.get("doctor", {})
    clinic = snapshot.get("clinic", {})
    letterhead = snapshot.get("letterhead", {})
    details = letterhead.get("header_details", {})
    alignment = letterhead.get("alignment", "left")
    if alignment not in ("left", "center", "right"):
        alignment = "left"
    logo = _logo(letterhead.get("logo_data_uri"))
    logo_html = f'<img class="logo" src="{logo}" alt="">' if logo else ""
    patient_name = " ".join(str(patient.get(key, "")) for key in ("first_name", "last_name"))
    doctor_name = " ".join(str(doctor.get(key, "")) for key in ("first_name", "last_name"))
    name_en = details.get('doctor_name_en') or doctor_name
    name_ar = details.get('doctor_name_ar') or doctor_name
    english_details = details.get('details_en') or '\n'.join(filter(None, [doctor.get('specialty'), doctor.get('medical_school'), clinic.get('address'), 'Licence: ' + str(doctor.get('professional_license_number', ''))]))
    arabic_details = details.get('details_ar') or '\n'.join(filter(None, [doctor.get('specialty'), doctor.get('medical_school'), clinic.get('address'), 'رقم الترخيص: ' + str(doctor.get('professional_license_number', ''))]))
    registered_header = snapshot.get("header_source") == "registered-profile-v1"
    if registered_header:
        # This discriminator preserves reprints of historical signed snapshots.
        name_en, name_ar = doctor_name, doctor.get("name_ar", "")
        english_parts = [doctor.get("specialty"), doctor.get("medical_school"), clinic.get("address")]
        if doctor.get("professional_license_number"):
            english_parts.append("Practice licence: " + str(doctor["professional_license_number"]))
        if doctor.get("syndicate_registration_number"):
            english_parts.append("Syndicate registration: " + str(doctor["syndicate_registration_number"]))
        english_details = "\n".join(filter(None, english_parts))
        arabic_details = "\n".join(filter(None, [doctor.get("specialty_ar"), clinic.get("address_ar")]))
    arabic_name_html = f'<div class="doctor-display header-ar" dir="rtl" style="text-align:center">د. {_text(name_ar)}</div>' if name_ar else ""
    arabic_clinic_html = f'<div class="clinic header-ar" dir="rtl" style="text-align:center">{_text(clinic.get("name_ar"))}</div>' if registered_header and clinic.get("name_ar") else ""
    reference = _text(snapshot.get("reference"))
    font = (Path(__file__).parent / 'assets' / 'ArefRuqaa-Regular.ttf').read_bytes()
    font_uri = 'data:font/ttf;base64,' + base64.b64encode(font).decode('ascii')
    font_style = "@font-face {font-family:'Aref Ruqaa';src:url('" + font_uri + "')}"
    brand_path = Path(__file__).parent / 'assets' / 'autopharm-logo.png'
    brand = 'data:image/png;base64,' + base64.b64encode(brand_path.read_bytes()).decode('ascii') if brand_path.exists() else ''
    brand_html = f'<div class="platform-brand"><img src="{brand}" alt=""></div>' if brand else ''

    medicines = []
    for line in snapshot.get("lines", []):
        instructions = line.get("instructions", "")
        if line.get("instructions_ar"):
            instructions += "\n" + line["instructions_ar"]
        instruction_lines = ''.join(
            f'<div class="instruction-line" dir="{_direction(part)}">{_text(part)}</div>'
            for part in str(instructions).split('\n')
        )
        details = " · ".join(
            value for key in ("strength", "dosage_form", "pack_description")
            if (value := _english_details(line.get(f'{key}_en', line.get(key))))
        )
        medicines.append(f'''<section class="medicine">
          <h2 dir="ltr">{_text(line.get("name_en"))}</h2>
          <div class="medicine-details" dir="ltr">{_text(details)}</div>
          <div class="medicine-meta"><div><span class="label">Authorized packs / عدد العبوات</span>{_text(line.get("quantity"))}</div>
          <div><span class="label">Permitted refills / مرات التكرار المسموحة</span>{_text(line.get("refills", 0))}</div></div>
          <span class="label">Instructions / التعليمات</span>
          <div class="instructions{ " instructions--structured" if line.get("instructions_ar") else "" }">{instruction_lines}</div>
        </section>''')
    revoked_html = '<div class="revoked">REVOKED</div><div class="revoked-label">REVOKED / ملغاة</div>' if revoked else ""
    return f'''<!doctype html><html lang="ar"><meta charset="utf-8"><style>{STYLE}{font_style}</style>
      <body><div class="reference">{reference}</div>{revoked_html}
      <header class="letterhead">{brand_html}<div class="header-grid">
        <div class="header-side" dir="ltr">{_text(english_details)}</div>
        <div class="header-center">{logo_html}<div class="doctor-display" dir="ltr">Dr. {_text(name_en)}</div>
          {arabic_name_html}
          <div class="clinic" dir="{_direction(clinic.get('name', ''))}">{_text(clinic.get('name'))}</div>{arabic_clinic_html}<div class="muted" dir="{_direction(letterhead.get('contact_line', ''))}">{_text(letterhead.get('contact_line'))}</div></div>
        <div class="header-side header-ar" dir="rtl">{_text(arabic_details)}</div>
      </div>
      </header><h1>Prescription / وصفة طبية</h1>
      <table class="identity"><tr>
        <td><span class="label">Patient / المريض</span><span class="patient" dir="{_direction(patient_name)}">{_text(patient_name)}</span></td>
        <td><span class="label">Doctor / الطبيب</span><span dir="{_direction(doctor_name)}">{_text(doctor_name)}</span></td>
      </tr><tr>
        <td><span class="label">Phone / الهاتف</span><span dir="ltr">{_text(patient.get('phone_number'))}</span></td>
        <td><span class="label">Licence / الترخيص</span><span dir="ltr">{_text(doctor.get('professional_license_number'))}</span></td>
      </tr><tr>
        <td><span class="label">Date of birth / تاريخ الميلاد</span>{_text(_date(patient.get('date_of_birth')))}</td>
        <td><span class="label">Specialty / التخصص</span>{_text(doctor.get('specialty'))}</td>
      </tr><tr>
        <td><span class="label">Issued / تاريخ الإصدار</span>{_text(_date(snapshot.get('issued_at')))}</td>
        <td><span class="label">Expires / تاريخ الانتهاء</span>{_text(_date(snapshot.get('expires_at')))}</td>
      </tr></table><p class="muted">Reference / المرجع <span dir="ltr">{reference}</span></p>
      {''.join(medicines)}</body></html>'''


def render_prescription_pdf(snapshot, *, revoked=False):
    """Return PDF bytes, preserving clinical text and final-page signature space."""
    allowed_logo = _logo(snapshot.get("letterhead", {}).get("logo_data_uri"))
    font_uri = 'data:font/ttf;base64,' + base64.b64encode((Path(__file__).parent / 'assets' / 'ArefRuqaa-Regular.ttf').read_bytes()).decode('ascii')
    brand_path = Path(__file__).parent / 'assets' / 'autopharm-logo.png'
    brand_uri = 'data:image/png;base64,' + base64.b64encode(brand_path.read_bytes()).decode('ascii') if brand_path.exists() else ''
    permitted = {value for value in (allowed_logo, font_uri, brand_uri) if value}


    def embedded_assets_only(url, *args, **kwargs):
        if url in permitted:
            return URLFetcherResponse(
                url,
                body=base64.b64decode(url.split(",", 1)[1]),
                headers={"Content-Type": url[5:url.index(";")]},
            )
        raise ValueError("Prescription PDF resources must be embedded raster snapshots.")

    font_config = FontConfiguration()
    main = HTML(string=_html(snapshot, revoked), url_fetcher=embedded_assets_only).write_pdf(font_config=font_config)
    signature_html = '''<html lang="ar"><meta charset="utf-8"><style>
      @page {size:A4; margin:0} body {margin:0; font-family:"Noto Sans Arabic",sans-serif; color:#626778}
      .signature {position:fixed; bottom:25mm; left:18mm; width:64mm; border-top:1px solid #b6bdc9; padding-top:2mm; font-size:9pt; text-align:left}
      </style><div class="signature">Doctor's signature / توقيع الطبيب</div></html>'''
    stamp = HTML(string=signature_html, url_fetcher=embedded_assets_only).write_pdf(font_config=font_config)
    reader, overlay = PdfReader(BytesIO(main)), PdfReader(BytesIO(stamp))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.pages[-1].merge_page(overlay.pages[0])
    writer.add_metadata({"/Title": "AutoPharm prescription", "/Author": "AutoPharm"})
    output = BytesIO()
    writer.write(output)
    return output.getvalue()
