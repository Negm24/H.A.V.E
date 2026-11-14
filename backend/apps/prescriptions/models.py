import uuid
from django.db import models
from django.utils import timezone


class PrescribingEligibility(models.Model):
    product = models.OneToOneField(
        "catalogue.Product", on_delete=models.PROTECT, primary_key=True
    )
    approved = models.BooleanField(default=False)
    controlled = models.BooleanField(default=False)
    review_reason = models.CharField(max_length=1000)
    reviewed_at = models.DateTimeField(default=timezone.now)
    formulation_signature = models.CharField(max_length=64, blank=True)

    def save(self, *args, **kwargs):
        if self._state.adding and not self.formulation_signature:
            from .eligibility import formulation_signature
            self.formulation_signature = formulation_signature(self.product)
        super().save(*args, **kwargs)


class ClinicLetterhead(models.Model):
    doctor = models.OneToOneField(
        "accounts.Doctor", on_delete=models.PROTECT, primary_key=True
    )
    alignment = models.CharField(
        max_length=6,
        default="center",
        choices=[("left", "Left"), ("center", "Center"), ("right", "Right")],
    )
    contact_line = models.CharField(max_length=250, blank=True)
    logo_data_uri = models.TextField(blank=True)
    header_details = models.JSONField(default=dict, blank=True)
    revision = models.PositiveIntegerField(default=1)


class Prescription(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference = models.CharField(max_length=40, unique=True)
    doctor = models.ForeignKey(
        "accounts.Doctor", on_delete=models.PROTECT, related_name="prescriptions"
    )
    patient_phone_number = models.CharField(max_length=32, db_index=True)
    issued_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    snapshot = models.JSONField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revocation_reason = models.CharField(max_length=1000, blank=True)
    replaces = models.OneToOneField(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="replacement",
    )


class PrescriptionLine(models.Model):
    prescription = models.ForeignKey(
        Prescription, on_delete=models.PROTECT, related_name="lines"
    )
    product = models.ForeignKey("catalogue.Product", on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    refills = models.PositiveIntegerField(default=0)
    instructions = models.TextField()
    dosage = models.JSONField(null=True, blank=True)


class PrescriptionAction(models.Model):
    id = models.UUIDField(primary_key=True)
    doctor = models.ForeignKey("accounts.Doctor", on_delete=models.PROTECT)
    kind = models.CharField(max_length=20)
    fingerprint = models.CharField(max_length=64)
    prescription = models.ForeignKey(Prescription, on_delete=models.PROTECT)
    created_at = models.DateTimeField(default=timezone.now)
