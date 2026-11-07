from django.core.validators import MinValueValidator, MaxValueValidator, RegexValidator
from django.db import models


class Terminal(models.Model):
    class Status(models.TextChoices):
        ONLINE = "ONLINE", "Online"
        OFFLINE = "OFFLINE", "Offline"
        MAINTENANCE = "MAINTENANCE", "Maintenance"
        OUT_OF_SERVICE = "OUT_OF_SERVICE", "Out of service"

    serial_number = models.CharField(primary_key=True, max_length=100)
    display_name = models.CharField(max_length=100)
    address_en = models.TextField()
    address_ar = models.TextField()
    latitude = models.DecimalField(max_digits=9, decimal_places=6, validators=[MinValueValidator(-90), MaxValueValidator(90)])
    longitude = models.DecimalField(max_digits=9, decimal_places=6, validators=[MinValueValidator(-180), MaxValueValidator(180)])
    status = models.CharField(max_length=14, choices=Status.choices, default=Status.OFFLINE)
    is_disabled = models.BooleanField(default=False)
    device_credential_hash = models.CharField(max_length=64, validators=[RegexValidator(r"^[0-9a-f]{64}$")])
    created_at = models.DateTimeField(auto_now_add=True)
    revision = models.PositiveIntegerField(default=1)
    layout_confirmed = models.BooleanField(default=False)
    layout_revision = models.PositiveIntegerField(default=1)
    maintenance_enabled = models.BooleanField(default=False)
    maintenance_reason = models.CharField(max_length=1000, blank=True)
    maintenance_at = models.DateTimeField(null=True, blank=True)
    maintenance_by = models.ForeignKey("accounts.Owner", null=True, blank=True, on_delete=models.PROTECT)

    class Meta:
        db_table = "terminals"
        constraints = [
            models.CheckConstraint(condition=models.Q(latitude__gte=-90, latitude__lte=90), name="terminals_latitude_valid"),
            models.CheckConstraint(condition=models.Q(longitude__gte=-180, longitude__lte=180), name="terminals_longitude_valid"),
            models.CheckConstraint(condition=models.Q(status__in=["ONLINE", "OFFLINE", "MAINTENANCE", "OUT_OF_SERVICE"]), name="terminals_status_valid"),
        ]

    def __str__(self):
        return self.serial_number
