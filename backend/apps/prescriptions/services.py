import base64
import hashlib
import io
import json
from datetime import timedelta
from uuid import uuid4
from PIL import Image, UnidentifiedImageError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.crypto import salted_hmac
from apps.accounts.models import Doctor, RefreshToken, User
from apps.accounts.security.authentication import bearer_token
from apps.accounts.security.tokens import decode_access
from apps.accounts.security.errors import AuthError
from apps.accounts.security.permissions import eligible_doctor
from apps.catalogue.models import Product
from .eligibility import formulation_signature
from .dosage import dose_unit, render_dosage
from .models import (
    ClinicLetterhead,
    Prescription,
    PrescriptionAction,
    PrescriptionLine,
    PrescribingEligibility,
)


def require_doctor(user, *, lock=False):
    query = Doctor.objects.select_related("user")
    if lock:
        # Account blocking and session creation serialize against the user row.
        User.objects.select_for_update().get(pk=user.pk)
        query = query.select_for_update(of=("self",))
    doctor = query.get(pk=user.pk)
    if not eligible_doctor(doctor.user):
        raise AuthError("An active approved doctor account is required.", 403)
    return doctor


def session_family(request):
    return decode_access(bearer_token(request), "ADVISOR")[1]


def require_live_family(user, family):
    if not RefreshToken.objects.filter(
        user=user,
        client_app="ADVISOR",
        session_family_id=family,
        revoked_at__isnull=True,
        replaced_by__isnull=True,
        expires_at__gt=timezone.now(),
    ).exists():
        raise AuthError("Session expired. Sign in again.")


def letterhead(doctor, *, lock=False):
    row, _ = ClinicLetterhead.objects.get_or_create(doctor=doctor)
    return (
        ClinicLetterhead.objects.select_for_update().get(pk=doctor.pk) if lock else row
    )


def professional_details(doctor):
    """Use recorded language fields, never guessed translations or header overrides."""
    english = [doctor.specialty, doctor.medical_school, doctor.clinic_address]
    if doctor.professional_license_number:
        english.append("Practice licence: " + doctor.professional_license_number)
    if doctor.syndicate_registration_number:
        english.append("Syndicate registration: " + doctor.syndicate_registration_number)
    arabic = [doctor.specialty_ar, doctor.clinic_address_ar]
    return "\n".join(filter(None, english)), "\n".join(filter(None, arabic))


def doctor_snapshot(doctor):
    return {
        "id": str(doctor.pk), "first_name": doctor.user.first_name,
        "last_name": doctor.user.last_name, "name_ar": doctor.name_ar,
        "professional_license_number": doctor.professional_license_number,
        "syndicate_registration_number": doctor.syndicate_registration_number,
        "specialty": doctor.specialty, "specialty_ar": doctor.specialty_ar,
        "medical_school": doctor.medical_school,
    }


def clinic_snapshot(doctor):
    return {"name": doctor.clinic_name, "name_ar": doctor.clinic_name_ar,
            "address": doctor.clinic_address, "address_ar": doctor.clinic_address_ar}


def letterhead_data(row):
    english, arabic = professional_details(row.doctor)
    return {
        "revision": row.revision,
        "alignment": row.alignment,
        "contact_line": row.contact_line,
        "has_logo": bool(row.logo_data_uri),
        "header_details": {},
        "doctor_name": row.doctor.user.first_name + " " + row.doctor.user.last_name,
        "doctor_name_ar": row.doctor.name_ar,
        "doctor_details_en": english,
        "doctor_details_ar": arabic,
        "clinic_name": row.doctor.clinic_name,
        "clinic_name_ar": row.doctor.clinic_name_ar,
        "clinic_address": row.doctor.clinic_address,
    }


@transaction.atomic
def update_letterhead(user, values, upload=None):
    if "header_details" in values:
        raise AuthError("Prescription identity comes from the registered profile and cannot be overridden.", 400)
    doctor = require_doctor(user, lock=True)
    row = letterhead(doctor, lock=True)
    if values["revision"] != row.revision:
        raise AuthError("Clinic letterhead changed. Reload and review it.", 409)
    if upload is not None:
        if upload.size > 2 * 1024 * 1024:
            raise AuthError("Choose a PNG or JPEG logo up to 2 MiB.", 400)
        try:
            image = Image.open(upload)
            if (
                image.format not in ("PNG", "JPEG")
                or image.width > 2000
                or image.height > 2000
                or min(image.size) < 16
            ):
                raise ValueError()
            image.load()
            image.thumbnail((640, 640))
            buffer = io.BytesIO()
            image.convert("RGBA").save(buffer, format="PNG")
            if buffer.tell() > 2 * 1024 * 1024:
                raise ValueError()
        except (
            UnidentifiedImageError,
            OSError,
            ValueError,
            Image.DecompressionBombError,
        ):
            raise AuthError(
                "Choose a valid PNG or JPEG logo, 16–2000 pixels per side.", 400
            ) from None
        row.logo_data_uri = "data:image/png;base64," + base64.b64encode(
            buffer.getvalue()
        ).decode("ascii")
    for key in ("alignment", "contact_line"):
        if key in values:
            setattr(row, key, values[key])
    row.revision += 1
    row.save()
    return letterhead_data(row)


def prescription_data(row):
    snapshot = row.snapshot
    status = (
        "REVOKED"
        if row.revoked_at
        else "EXPIRED"
        if row.expires_at <= timezone.now()
        else "ACTIVE"
    )
    head = {
        key: value
        for key, value in snapshot["letterhead"].items()
        if key != "logo_data_uri"
    }
    return {
        "id": str(row.pk),
        "reference": row.reference,
        "status": status,
        **{"patient_" + key: value for key, value in snapshot["patient"].items()},
        "doctor": snapshot["doctor"],
        "clinic": snapshot["clinic"],
        "letterhead": head,
        "issued_at": row.issued_at.isoformat(),
        "expires_at": row.expires_at.isoformat(),
        "lines": [{**line, "dose_unit": line.get("dose_unit", dose_unit(line.get("dosage_form")))} for line in snapshot["lines"]],
        "revoked_at": row.revoked_at,
        "revocation_reason": row.revocation_reason,
        "replaces_id": str(row.replaces_id) if row.replaces_id else None,
        "replaced_by_id": str(
            Prescription.objects.filter(replaces=row)
            .values_list("pk", flat=True)
            .first()
            or ""
        )
        or None,
        "claim_status": "UNCLAIMED",
    }


def owned(doctor, pk, *, lock=False):
    query = Prescription.objects.filter(doctor=doctor)
    if lock:
        query = query.select_for_update()
    row = query.filter(pk=pk).first()
    if not row:
        raise AuthError("Prescription not found.", 404)
    return row


def fingerprint(kind, values, target):
    return hashlib.sha256(
        json.dumps(
            {"kind": kind, "target": str(target or ""), "values": values},
            default=str,
            sort_keys=True,
        ).encode()
    ).hexdigest()


@transaction.atomic
def issue(user, family, values, replacement_id=None):
    doctor = require_doctor(user, lock=True)
    require_live_family(user, family)
    kind = "replace" if replacement_id else "issue"
    digest = fingerprint(kind, values, replacement_id)
    previous = PrescriptionAction.objects.filter(pk=values["action_id"]).first()
    if previous:
        if previous.doctor_id != doctor.pk or previous.fingerprint != digest:
            raise AuthError(
                "This submission reference was used for different content.", 409
            )
        return prescription_data(previous.prescription)
    now = timezone.now()
    if values["expires_at"] <= now:
        raise AuthError("Choose a future prescription expiry.", 400)
    original = owned(doctor, replacement_id, lock=True) if replacement_id else None
    if original and original.revoked_at:
        raise AuthError("This prescription was already revoked or replaced.", 409)
    ids = [line["product_id"] for line in values["lines"]]
    products = {
        p.pk: p
        for p in Product.objects.select_for_update(of=("self",))
        .select_related("category")
        .filter(pk__in=ids)
        .order_by("pk")
    }
    approvals = PrescribingEligibility.objects.select_for_update().filter(
        product_id__in=ids, approved=True, controlled=False
    )
    allowed = {
        row.product_id for row in approvals
        if row.product_id in products
        and row.formulation_signature == formulation_signature(products[row.product_id])
    }
    if (
        set(ids) != allowed
        or any(not p.is_active or not p.category.is_active for p in products.values())
        or len(products) != len(ids)
    ):
        raise AuthError(
            "One or more medicines are not approved for prescribing. Review the medicine list.",
            409,
        )
    resolved_lines = []
    for line in values['lines']:
        line = dict(line)
        data = line.get('dosage')
        unit = dose_unit(products[line['product_id']].dosage_form)
        if data and data['mode'] == 'structured':
            if data.get('catalogue_form', products[line['product_id']].dosage_form) != products[line['product_id']].dosage_form:
                raise AuthError('The medicine form changed. Select it again before issuing.', 409)
            if not unit:
                raise AuthError('This catalogue form needs custom written instructions.', 400)
            line['instructions'] = render_dosage(data, unit)
            line['instructions_ar'] = render_dosage(data, unit, 'ar')
        elif data and data['mode'] == 'none':
            line['instructions'] = render_dosage(data, unit)
            line['instructions_ar'] = render_dosage(data, unit, 'ar')
        line['dose_unit'] = unit
        resolved_lines.append(line)
    head = letterhead(doctor, lock=True)
    reference = "HAVE-RX-" + uuid4().hex[:20].upper()
    snapshot = {
        "reference": reference,
        "issued_at": now.isoformat(),
        "expires_at": values["expires_at"].isoformat(),
        "patient": {
            "phone_number": values["patient_phone_number"],
            "first_name": values["patient_first_name"],
            "last_name": values["patient_last_name"],
            "date_of_birth": values["patient_date_of_birth"].isoformat(),
        },
        "header_source": "registered-profile-v1",
        "doctor": doctor_snapshot(doctor),
        "clinic": clinic_snapshot(doctor),
        "letterhead": {
            "alignment": head.alignment,
            "contact_line": head.contact_line,
            "logo_data_uri": head.logo_data_uri,
            "header_details": {},
        },
        "lines": [
            {
                **line,
                "name_en": products[line["product_id"]].name_en,
                "strength": products[line["product_id"]].strength,
                "dosage_form": products[line["product_id"]].dosage_form,
                "pack_description": products[line["product_id"]].pack_description,
            }
            for line in resolved_lines
        ],
    }
    snapshot["signature"] = {
        "method": "authenticated-doctor-issue",
        "algorithm": "HMAC-SHA256",
        "signer_id": str(doctor.pk),
        "signed_at": now.isoformat(),
        "value": salted_hmac(
            "have.prescription.v1",
            json.dumps(snapshot, sort_keys=True),
            algorithm="sha256",
        ).hexdigest(),
    }
    row = Prescription.objects.create(
        reference=reference,
        doctor=doctor,
        patient_phone_number=values["patient_phone_number"],
        issued_at=now,
        expires_at=values["expires_at"],
        snapshot=snapshot,
        replaces=original,
    )
    PrescriptionLine.objects.bulk_create(
        [PrescriptionLine(prescription=row, **{k: line[k] for k in ("product_id", "quantity", "refills", "instructions", "dosage") if k in line}) for line in resolved_lines]
    )
    if original:
        original.revoked_at = now
        original.revocation_reason = values["reason"]
        original.save(update_fields=["revoked_at", "revocation_reason"])
    PrescriptionAction.objects.create(
        id=values["action_id"],
        doctor=doctor,
        kind=kind,
        fingerprint=digest,
        prescription=row,
    )
    return prescription_data(row)


@transaction.atomic
def revoke(user, pk, values):
    doctor = require_doctor(user, lock=True)
    row = owned(doctor, pk, lock=True)
    digest = fingerprint("revoke", values, pk)
    previous = PrescriptionAction.objects.filter(pk=values["action_id"]).first()
    if previous:
        if previous.doctor_id != doctor.pk or previous.fingerprint != digest:
            raise AuthError(
                "This submission reference was used for different content.", 409
            )
        return prescription_data(row)
    if row.revoked_at:
        raise AuthError("This prescription is already revoked.", 409)
    row.revoked_at = timezone.now()
    row.revocation_reason = values["reason"]
    row.save(update_fields=["revoked_at", "revocation_reason"])
    PrescriptionAction.objects.create(
        id=values["action_id"],
        doctor=doctor,
        kind="revoke",
        fingerprint=digest,
        prescription=row,
    )
    return prescription_data(row)


def search_prescriptions(doctor, values):
    query = Prescription.objects.filter(doctor=doctor).order_by("-issued_at", "-pk")
    term = values.get("query", "").strip()
    if term:
        from apps.accounts.security.validation import normalize_phone_number

        try:
            phone = normalize_phone_number(term)
        except Exception:
            phone = ""
        query = query.filter(Q(reference__iexact=term) | Q(patient_phone_number=phone))
    status = values.get("status")
    if status == "REVOKED":
        query = query.filter(revoked_at__isnull=False)
    elif status == "EXPIRED":
        query = query.filter(revoked_at__isnull=True, expires_at__lte=timezone.now())
    elif status == "ACTIVE":
        query = query.filter(revoked_at__isnull=True, expires_at__gt=timezone.now())
    for key, lookup in [("start", "issued_at__gte"), ("end", "issued_at__lte")]:
        if key in values:
            query = query.filter(**{lookup: values[key]})
    page, size = values["page"], values["page_size"]
    return {
        "items": [
            prescription_data(row) for row in query[(page - 1) * size : page * size]
        ],
        "total": query.count(),
        "page": page,
        "page_size": size,
    }


def preview_snapshot(doctor, values):
    if "header_details" in values:
        raise AuthError("Prescription identity comes from the registered profile and cannot be overridden.", 400)
    head = letterhead(doctor)
    now = timezone.now()
    return {
        "reference": "PREVIEW-FICTIONAL",
        "issued_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "patient": {
            "first_name": "Example",
            "last_name": "Patient",
            "phone_number": "+201000000000",
            "date_of_birth": "1990-01-01",
        },
        "header_source": "registered-profile-v1",
        "doctor": doctor_snapshot(doctor),
        "clinic": clinic_snapshot(doctor),
        "letterhead": {
            "alignment": values.get("alignment", head.alignment),
            "contact_line": values.get("contact_line", head.contact_line),
            "logo_data_uri": head.logo_data_uri,
            "header_details": {},
        },
        "lines": [
            {
                "name_en": "Example medicine",
                "strength": "Example strength",
                "dosage_form": "Tablets",
                "pack_description": "Example pack",
                "quantity": 1,
                "refills": 0,
                "instructions": "Fictional preview instructions / تعليمات تجريبية",
            }
        ],
    }
