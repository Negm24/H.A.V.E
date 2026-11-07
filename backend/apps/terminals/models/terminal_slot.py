from django.db import models


class TerminalSlot(models.Model):
    terminal = models.ForeignKey("terminals.Terminal", db_column="terminal_serial_number", on_delete=models.PROTECT, related_name="slots")
    slot_code = models.CharField(max_length=30)
    product = models.ForeignKey("catalogue.Product", null=True, blank=True, on_delete=models.PROTECT, related_name="terminal_slots")
    capacity = models.IntegerField()
    is_enabled = models.BooleanField(default=True)
    revision = models.PositiveIntegerField(default=1)
    is_operational = models.BooleanField(default=True)
    cabinet_row = models.PositiveSmallIntegerField(null=True, blank=True)
    cabinet_column = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        db_table = "terminal_slots"
        constraints = [
            models.UniqueConstraint(fields=["terminal", "slot_code"], name="terminal_slots_terminal_code_unique"),
            models.CheckConstraint(condition=models.Q(capacity__gt=0), name="terminal_slots_capacity_positive"),
            models.UniqueConstraint(fields=['terminal','cabinet_row','cabinet_column'], condition=models.Q(is_operational=True), name='terminal_physical_position_unique'),
            models.CheckConstraint(condition=(models.Q(cabinet_row__isnull=True,cabinet_column__isnull=True) | models.Q(cabinet_row__gte=1,cabinet_row__lte=4,cabinet_column__gte=1,cabinet_column__lte=6)), name='terminal_physical_position_bounds'),
        ]
