from django.db import models


class TerminalSlot(models.Model):
    terminal = models.ForeignKey("terminals.Terminal", db_column="terminal_serial_number", on_delete=models.PROTECT, related_name="slots")
    slot_code = models.CharField(max_length=30)
    product = models.ForeignKey("catalogue.Product", on_delete=models.PROTECT, related_name="terminal_slots")
    capacity = models.IntegerField()
    is_enabled = models.BooleanField(default=True)

    class Meta:
        db_table = "terminal_slots"
        constraints = [
            models.UniqueConstraint(fields=["terminal", "slot_code"], name="terminal_slots_terminal_code_unique"),
            models.CheckConstraint(condition=models.Q(capacity__gt=0), name="terminal_slots_capacity_positive"),
        ]
