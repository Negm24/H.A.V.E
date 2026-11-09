"""Private registration state. No uploaded path is ever a public media URL."""
import uuid

from django.db import models


class DoctorRegistrationDraft(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone_hash = models.CharField(max_length=64, db_index=True)
    password_hash = models.CharField(max_length=255)
    token_hash = models.CharField(max_length=64, unique=True)
    data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    last_saved_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField(db_index=True)
    doctor = models.ForeignKey("accounts.Doctor", null=True, blank=True, on_delete=models.SET_NULL)
    submission_id = models.UUIDField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["phone_hash"], condition=models.Q(submission_id__isnull=True),
                                               name="doctor_active_registration_phone_unique")]


class DoctorVerificationDocument(models.Model):
    class Kind(models.TextChoices):
        GRADUATION = "graduation", "Graduation certificate"
        ID_FRONT = "id_front", "National ID front"
        ID_BACK = "id_back", "National ID back"
        PASSPORT = "passport", "Passport identity page"
        SYNDICATE = "syndicate", "Syndicate card"
        PRACTICE_LICENSE = "practice_license", "Practice licence"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    draft = models.ForeignKey(DoctorRegistrationDraft, null=True, blank=True,
                              on_delete=models.SET_NULL, related_name="documents")
    doctor = models.ForeignKey("accounts.Doctor", null=True, blank=True,
                               on_delete=models.PROTECT, related_name="verification_documents")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    private_path = models.CharField(max_length=100)
    content_type = models.CharField(max_length=40, default="image/jpeg")
    uploaded_at = models.DateTimeField(auto_now_add=True)
    pending_delete = models.BooleanField(default=False, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["draft", "kind"], condition=models.Q(pending_delete=False),
                                    name="doctor_draft_document_kind_unique"),
            models.UniqueConstraint(fields=["doctor", "kind"], condition=models.Q(pending_delete=False),
                                    name="doctor_document_kind_unique"),
        ]
