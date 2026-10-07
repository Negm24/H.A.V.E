from django.db import models
from django.utils import timezone


class Owner(models.Model):
    user = models.OneToOneField(
        "accounts.User",
        primary_key=True,
        on_delete=models.PROTECT,
        related_name="owner",
    )

    password_hash = models.CharField(max_length=255)

    credential_changed_at = models.DateTimeField(
        default=timezone.now,
    )

    class Meta:
        db_table = "owners"

        constraints = [
            models.CheckConstraint(
                condition=~models.Q(password_hash=""),
                name="owners_password_hash_not_empty",
            ),
        ]

    def __str__(self):
        return self.user_id