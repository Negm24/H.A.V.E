"""Private, authenticated registration drafts and image lifecycle.

Registration proof never grants an Advisor token. Submission is the only public
route that creates an application; file deletion is retryable after commit.
"""
from datetime import timedelta
from io import BytesIO
from pathlib import Path
import secrets
import warnings

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from apps.accounts.models import Doctor, DoctorRegistrationDraft, DoctorVerificationDocument, User
from apps.accounts.security.errors import SignupError
from apps.accounts.security.state import (_source_limit, get_login_lockout_seconds, record_failed_login,
                                         clear_login_failures)
from apps.accounts.security.tokens import identifier_hash, token_hash
from apps.accounts.services.shared_services.notifications import notify_owner_of_doctor_application
from .registration import _create_doctor_from_validated_data, _reopen_rejected_doctor, find_rejected_applicant


KINDS = DoctorVerificationDocument.Kind.values
COOKIE_PATH = "/api/v1/auth/doctors/registration/"


def cookie_name():
    return getattr(settings, "DOCTOR_REGISTRATION_COOKIE_NAME", "have_doctor_registration")


def private_root():
    return Path(getattr(settings, "DOCTOR_VERIFICATION_ROOT", settings.BASE_DIR / "private" / "doctor-verification"))


def document_path(document):
    root = private_root().resolve()
    candidate = (root / document.private_path).resolve()
    if candidate.parent != root or candidate.suffix != ".jpg":
        raise SignupError("Document unavailable.", status=404)
    return candidate


def draft_data(draft):
    submitted = bool(draft.submission_id)
    return {"id": str(draft.id), "status": "SUBMITTED" if submitted else "DRAFT",
            "data": {} if submitted else draft.data, "expires_at": draft.expires_at,
            "last_saved_at": draft.last_saved_at, "doctor_id": draft.doctor_id,
            "documents": [] if submitted else list(draft.documents.filter(pending_delete=False).values(
                "kind", "uploaded_at", "content_type"))}


def create_verified_draft(payload):
    data = dict(payload)
    password_hash = data.pop("password_hash")
    identity = identifier_hash("phone", data["phone_number"])
    with transaction.atomic():
        expired = DoctorRegistrationDraft.objects.select_for_update().filter(
            phone_hash=identity, expires_at__lte=timezone.now()).first()
        if expired:
            retire_documents(expired.documents.filter(pending_delete=False))
            expired.delete()
        previous = find_rejected_applicant(phone_number=data["phone_number"], email=data["email"])
        if previous and previous.rejection_count >= settings.DOCTOR_MAX_REJECTIONS:
            raise SignupError("This application cannot be accepted.", status=403)
        if User.objects.filter(account_type="DOCTOR", phone_number=data["phone_number"]).exists() or User.objects.filter(
                account_type="DOCTOR", email__iexact=data["email"]).exists():
            raise SignupError("A doctor account already uses these account details.", status=409)
        if DoctorRegistrationDraft.objects.filter(phone_hash=identity, expires_at__gt=timezone.now(),
                                                  submission_id__isnull=True).exists():
            raise SignupError("A saved application exists. Resume it with your phone and password.", status=409)
        secret = secrets.token_urlsafe(32)
        try:
            with transaction.atomic():
                draft = DoctorRegistrationDraft.objects.create(phone_hash=identity, password_hash=password_hash,
                    token_hash=token_hash(secret), data=data, expires_at=timezone.now() + timedelta(days=7))
        except IntegrityError:
            raise SignupError("A saved application exists. Resume it with your phone and password.", status=409) from None
    return draft, secret


def get_draft(secret, *, lock=False, editable=False):
    if not secret or len(secret) > 200:
        raise SignupError("Authenticate to resume your registration.", status=401)
    query = DoctorRegistrationDraft.objects.select_for_update() if lock else DoctorRegistrationDraft.objects
    draft = query.filter(token_hash=token_hash(secret), expires_at__gt=timezone.now()).first()
    if not draft:
        raise SignupError("Your saved registration is unavailable or has expired.", status=401)
    if editable and draft.submission_id:
        raise SignupError("This application has already been submitted.", status=409)
    return draft


def resume_draft(*, phone_number, password, source):
    _source_limit(source, "doctor-draft-resume", 20, 600)
    role = "DOCTOR_DRAFT"
    delay = get_login_lockout_seconds(role, phone_number)
    if delay:
        raise SignupError("Please wait before trying again.", status=429, retry_after=delay)
    with transaction.atomic():
        draft = DoctorRegistrationDraft.objects.select_for_update().filter(
            phone_hash=identifier_hash("phone", phone_number), submission_id__isnull=True,
            expires_at__gt=timezone.now()).order_by("-created_at").first()
        from apps.accounts.security.authentication import get_dummy_password_hash
        matches = check_password(password, draft.password_hash if draft else get_dummy_password_hash())
        if not draft or not matches:
            record_failed_login(role, phone_number)
            raise SignupError("Unable to resume with these credentials.", status=401)
        clear_login_failures(role, phone_number)
        secret = secrets.token_urlsafe(32)
        draft.token_hash = token_hash(secret)
        draft.save(update_fields=["token_hash"])
    return draft, secret


def update_draft(secret, changes):
    with transaction.atomic():
        draft = get_draft(secret, lock=True, editable=True)
        old_nationality = draft.data["nationality"]
        draft.data = draft.data | changes
        draft.save(update_fields=["data", "last_saved_at"])
        if (old_nationality == "EG") != (draft.data["nationality"] == "EG"):
            invalid = ["passport"] if draft.data["nationality"] == "EG" else ["id_front", "id_back"]
            retire_documents(draft.documents.filter(kind__in=invalid, pending_delete=False))
    return draft


def normalize_image(upload):
    if not upload or upload.size > 10 * 1024 * 1024:
        raise SignupError("Choose an image no larger than 10 MiB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(upload) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"} or getattr(image, "n_frames", 1) != 1:
                    raise SignupError("Choose a still JPEG, PNG or WebP image.")
                if image.width < 100 or image.height < 100 or image.width * image.height > 24_000_000:
                    raise SignupError("Use a clear image of at least 100 pixels per side and at most 24 megapixels.")
                image.load()
                normalized = ImageOps.exif_transpose(image).convert("RGB")
                normalized.thumbnail((4096, 4096))
                output = BytesIO()
                normalized.save(output, format="JPEG", quality=95)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise SignupError("This image cannot be read. Choose another JPEG, PNG or WebP image.") from None


def upload_document(secret, kind, upload):
    if kind not in KINDS:
        raise SignupError("Unknown document type.", status=404)
    content = normalize_image(upload)
    path = None
    try:
        with transaction.atomic():
            draft = get_draft(secret, lock=True, editable=True)
            permitted = {"graduation", "syndicate", "practice_license"} | (
                {"id_front", "id_back"} if draft.data["nationality"] == "EG" else {"passport"})
            if kind not in permitted:
                raise SignupError("This document does not match your selected nationality.")
            retire_documents(draft.documents.filter(kind=kind, pending_delete=False))
            document = DoctorVerificationDocument(draft=draft, kind=kind)
            document.private_path = f"{document.id.hex}.jpg"
            path = document_path(document)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as handle:
                handle.write(content)
            document.save()
            draft.save(update_fields=["last_saved_at"])
    except Exception:
        if path:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass  # Orphan scan retries files without a committed database row.
        raise
    return draft


def retire_documents(query):
    ids = list(query.values_list("id", flat=True))
    query.update(pending_delete=True, draft=None, doctor=None)
    if ids:
        transaction.on_commit(lambda: delete_retired_documents(ids))


def delete_retired_documents(ids=None):
    query = DoctorVerificationDocument.objects.filter(pending_delete=True)
    if ids is not None:
        query = query.filter(pk__in=ids)
    deleted = deferred = 0
    for document in query.order_by("uploaded_at")[:100]:
        try:
            document_path(document).unlink(missing_ok=True)
        except (OSError, SignupError):
            deferred += 1
        else:
            document.delete()
            deleted += 1
    return {"deleted": deleted, "deferred": deferred}


def remove_document(secret, kind):
    with transaction.atomic():
        draft = get_draft(secret, lock=True, editable=True)
        retire_documents(draft.documents.filter(kind=kind, pending_delete=False))
        draft.save(update_fields=["last_saved_at"])
    return draft


def discard_draft(secret):
    with transaction.atomic():
        # After a confirmed submission this clears only the browser's completed
        # registration stub. Issued account evidence belongs to the Doctor.
        draft = get_draft(secret, lock=True)
        retire_documents(draft.documents.filter(pending_delete=False))
        draft.delete()


def submit_draft(secret, action_id):
    try:
        with transaction.atomic():
            draft = get_draft(secret, lock=True)
            if draft.submission_id:
                if draft.submission_id != action_id:
                    raise SignupError("This application was already submitted with another action.", status=409)
                if not draft.doctor_id:
                    raise SignupError("This application is no longer available.", status=410)
                return draft.doctor.user, False
            required = {"graduation", "syndicate"} | (
                {"id_front", "id_back"} if draft.data["nationality"] == "EG" else {"passport"})
            documents = draft.documents.filter(pending_delete=False)
            if not required.issubset(set(documents.values_list("kind", flat=True))):
                raise SignupError("Upload all required documents before submitting.")
            # Files remain required if the private disk is unavailable or lost.
            if any(not document_path(document).is_file() for document in documents):
                raise SignupError("A document is unavailable. Upload it again before submitting.", status=409)
            data = dict(draft.data)
            data["professional_license_number"] = data.get("professional_license_number") or None
            data["specialty"] = ""
            previous = find_rejected_applicant(phone_number=data["phone_number"], email=data["email"])
            if previous:
                user = _reopen_rejected_doctor(previous.pk, **data, password_hash=draft.password_hash)
            else:
                user = _create_doctor_from_validated_data(**data, password_hash=draft.password_hash,
                                                         email_verified=True)
            documents.update(doctor=user.doctor, draft=None)
            draft.doctor = user.doctor
            draft.submission_id = action_id
            draft.password_hash = ""
            draft.data = {}
            draft.save(update_fields=["doctor", "submission_id", "password_hash", "data", "last_saved_at"])
            transaction.on_commit(lambda: notify_owner_of_doctor_application(user))
        return user, True
    except ValidationError as exc:
        raise SignupError(" ".join(exc.messages), status=409) from None
    except IntegrityError:
        raise SignupError("These account details conflict with another submitted application.", status=409) from None


def cleanup_registrations():
    expired = list(DoctorRegistrationDraft.objects.filter(expires_at__lte=timezone.now()).order_by("expires_at").values_list("pk", flat=True)[:100])
    for pk in expired:
        with transaction.atomic():
            draft = DoctorRegistrationDraft.objects.select_for_update().filter(pk=pk).first()
            if draft:
                retire_documents(draft.documents.filter(pending_delete=False))
                draft.delete()
    result = delete_retired_documents()
    root = private_root()
    if root.exists():
        cutoff = (timezone.now() - timedelta(hours=1)).timestamp()
        known = set(DoctorVerificationDocument.objects.values_list("private_path", flat=True))
        for path in root.glob("*.jpg"):
            if path.name not in known:
                try:
                    if path.stat().st_mtime < cutoff:
                        path.unlink()
                except OSError:
                    result["deferred"] += 1
    return result | {"expired_drafts": len(expired)}
