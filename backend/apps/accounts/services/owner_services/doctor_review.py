"""Owner decisions on doctor applications. Approval is activation, not login.

Rejection erases the application's personal data (PDPL storage limitation,
requirements FR-82e to FR-82g). The rows stay with the decision, the owner's
reason, the password hash, a rejection counter and keyed hashes of the phone and
email, so the doctor can see the outcome and reason at sign-in and may reapply
until the third rejection.
"""
import logging

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Doctor, RefreshToken, User
from apps.accounts.security.tokens import identifier_hash
from apps.accounts.services.shared_services.notifications import send_doctor_rejection_email

logger = logging.getLogger(__name__)

def list_doctor_applications(*, status=Doctor.ApprovalStatus.PENDING):
    """Applications in one status, oldest first so the owner works the queue in order."""
    if status not in Doctor.ApprovalStatus.values:
        raise ValidationError("Unknown approval status.", code="invalid_status")
    return list(Doctor.objects.select_related("user")
                .filter(approval_status=status).order_by("user__created_at"))


def get_doctor_application(*, doctor_id):
    doctor = Doctor.objects.select_related("user").filter(pk=doctor_id).first()
    if doctor is None:
        raise ValidationError("Doctor application not found.", code="not_found")
    return doctor


def decide(*, doctor_id, owner, decision, reason=""):
    if decision == "approve":
        return approve_doctor(doctor_id=doctor_id, owner=owner)
    if decision == "reject":
        return reject_doctor(doctor_id=doctor_id, owner=owner, reason=reason)
    raise ValidationError("Decision must be approve or reject.", code="invalid_decision")


def approve_doctor(*, doctor_id, owner):
    with transaction.atomic():
        _, doctor = _lock_pending(doctor_id, owner)
        _record_decision(doctor, owner, Doctor.ApprovalStatus.APPROVED)
        doctor.save(update_fields=["approval_status", "reviewed_by_owner", "reviewed_at"])
    _log(doctor, owner, "APPROVED")
    return doctor


def reject_doctor(*, doctor_id, owner, reason=""):
    reason = (reason or "").strip()
    if len(reason) > 1000:
        raise ValidationError("Rejection reason must not exceed 1000 characters.", code="invalid_reason")
    with transaction.atomic():
        user, doctor = _lock_pending(doctor_id, owner)
        # Contacts are kept in memory only, to address the rejection email after commit.
        email, first_name = user.email, user.first_name

        doctor.phone_hash = identifier_hash("phone", user.phone_number)
        doctor.email_hash = identifier_hash("email", user.email)
        doctor.rejection_count += 1
        doctor.rejection_reason = reason or None
        doctor.professional_license_number = None
        doctor.specialty = doctor.clinic_name = doctor.clinic_address = ""
        _record_decision(doctor, owner, Doctor.ApprovalStatus.REJECTED)
        doctor.save(update_fields=[
            "phone_hash", "email_hash", "rejection_count", "rejection_reason", "professional_license_number",
            "specialty", "clinic_name", "clinic_address",
            "approval_status", "reviewed_by_owner", "reviewed_at",
        ])

        user.first_name = user.last_name = ""
        user.phone_number = user.email = None
        user.phone_verified_at = user.email_verified_at = None
        user.save(update_fields=["first_name", "last_name", "phone_number", "email",
                                 "phone_verified_at", "email_verified_at"])
        RefreshToken.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())

        transaction.on_commit(lambda: send_doctor_rejection_email(
            email=email, first_name=first_name, reason=reason,
            can_reapply=doctor.rejection_count < settings.DOCTOR_MAX_REJECTIONS, doctor_id=doctor.pk))
    _log(doctor, owner, "REJECTED")
    return doctor


def _lock_pending(doctor_id, owner):
    if not (owner.is_active and owner.is_staff and owner.account_type == "OWNER"):
        raise ValidationError("Only an active owner can review doctor applications.", code="forbidden")
    # User before Doctor: the same lock order as session code, so no deadlocks.
    user = User.objects.select_for_update().filter(pk=doctor_id, account_type="DOCTOR").first()
    doctor = user and Doctor.objects.select_for_update().filter(pk=doctor_id).first()
    if doctor is None:
        raise ValidationError("Doctor application not found.", code="not_found")
    if doctor.approval_status != Doctor.ApprovalStatus.PENDING:
        raise ValidationError("Only pending applications can be reviewed.", code="not_pending")
    return user, doctor


def _record_decision(doctor, owner, status):
    doctor.approval_status = status
    doctor.reviewed_by_owner_id = owner.pk
    doctor.reviewed_at = timezone.now()


def _log(doctor, owner, decision):
    # IDs only: no names, contacts or the reason in logs.
    logger.info("Doctor application reviewed: doctor=%s owner=%s decision=%s rejections=%s",
                doctor.pk, owner.pk, decision, doctor.rejection_count)
