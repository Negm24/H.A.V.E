from django.core.exceptions import ValidationError
from django.db import models


class TerminalStock(models.Model):
    terminal_slot = models.ForeignKey("terminals.TerminalSlot", on_delete=models.PROTECT, related_name="stock")
    batch = models.ForeignKey("catalogue.ProductBatch", on_delete=models.PROTECT, related_name="terminal_stock")
    quantity_on_hand = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        super().clean()
        if self.batch_id and self.terminal_slot_id and self.batch.product_id != self.terminal_slot.product_id:
            raise ValidationError("The batch and slot must contain the same product.")

    class Meta:
        db_table = "terminal_stock"
        constraints = [
            models.UniqueConstraint(fields=["terminal_slot", "batch"], name="terminal_stock_slot_batch_unique"),
            models.CheckConstraint(condition=models.Q(quantity_on_hand__gte=0), name="terminal_stock_quantity_nonnegative"),
        ]
