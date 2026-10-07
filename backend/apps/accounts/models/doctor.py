from django.db import models
from django.utils import timezone


class Doctor(models.Model):
    class ApprovalStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    user = models.OneToOneField(
        "accounts.User",
        primary_key=True,
        on_delete=models.PROTECT,
        related_name="doctor",
    )

    password_hash = models.CharField(max_length=255)

    professional_license_number = models.CharField(
        max_length=100,
    )
    specialty = models.CharField(max_length=100)
    clinic_name = models.CharField(max_length=200)
    clinic_address = models.TextField()

    approval_status = models.CharField(
        max_length=8,
        choices=ApprovalStatus.choices,
        default=ApprovalStatus.PENDING,
    )

    reviewed_by_owner = models.ForeignKey(
        "accounts.Owner",
        on_delete=models.PROTECT,
        related_name="reviewed_doctors",
        null=True,
        blank=True,
    )
    reviewed_at = models.DateTimeField(
        null=True,
        blank=True,
    )
    rejection_reason = models.TextField(
        null=True,
        blank=True,
    )

    mfa_secret_encrypted = models.TextField(
        null=True,
        blank=True,
    )
    mfa_enrolled_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    credential_changed_at = models.DateTimeField(
        default=timezone.now,
    )

    class Meta:
        db_table = "doctors"

        constraints = [
            models.CheckConstraint(
                condition=~models.Q(password_hash=""),
                name="doctors_password_hash_not_empty",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    approval_status__in=[
                        "PENDING",
                        "APPROVED",
                        "REJECTED",
                    ],
                ),
                name="doctors_approval_status_valid",
            ),
            models.UniqueConstraint(
                fields=["professional_license_number"],
                name="doctors_license_number_unique",
            ),
        ]

    def __str__(self):
        return self.user_id