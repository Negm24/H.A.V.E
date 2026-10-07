from django.db import models
from django.utils import timezone


class Customer(models.Model):
    user = models.OneToOneField(
        "accounts.User",
        primary_key=True,
        on_delete=models.PROTECT,
        related_name="customer",
    )

    date_of_birth = models.DateField()

    pin_hash = models.CharField(max_length=255)

    credential_changed_at = models.DateTimeField(
        default=timezone.now,
    )

    class Meta:
        db_table = "customers"

        constraints = [
            models.CheckConstraint(
                condition=~models.Q(pin_hash=""),
                name="customers_pin_hash_not_empty",
            ),
        ]

    def __str__(self):
        return self.user_id