import uuid

from django.db import models
from django.utils import timezone


class RefreshToken(models.Model):
    class ClientApp(models.TextChoices):
        HUB = "HUB", "Hub"
        ADVISOR = "ADVISOR", "Advisor"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.PROTECT,
        related_name="refresh_tokens",
    )

    session_family_id = models.UUIDField(
        default=uuid.uuid4,
        db_index=True,
        editable=False,
    )

    client_app = models.CharField(
        max_length=7,
        choices=ClientApp.choices,
    )

    token_hash = models.CharField(
        max_length=64,
        unique=True,
    )

    remember_me = models.BooleanField(default=False)

    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(db_index=True)

    revoked_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    replaced_by = models.OneToOneField(
        "self",
        on_delete=models.PROTECT,
        related_name="replaces",
        null=True,
        blank=True,
    )

    user_agent = models.TextField(
        null=True,
        blank=True,
    )

    ip_address = models.GenericIPAddressField(
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "refresh_tokens"

        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    expires_at__gt=models.F("created_at"),
                ),
                name="refresh_tokens_expiry_valid",
            ),
            models.CheckConstraint(
                condition=~models.Q(
                    id=models.F("replaced_by_id"),
                ),
                name="refresh_tokens_no_self_replacement",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    client_app__in=["HUB", "ADVISOR"],
                ),
                name="refresh_tokens_client_app_valid",
            ),
        ]

    def __str__(self):
        return str(self.id)