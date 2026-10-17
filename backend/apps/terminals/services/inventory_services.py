from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum

from apps.terminals.models import TerminalSlot, TerminalStock
from apps.catalogue.models import ProductBatch


@transaction.atomic
def set_stock(*, slot_id, batch, quantity):
    """All inventory writers must lock the slot, including when inserting a new batch."""
    slot = TerminalSlot.objects.select_for_update().get(pk=slot_id)
    batch = ProductBatch.objects.select_for_update().get(pk=batch.pk)
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 0:
        raise ValidationError("Stock quantity must be a nonnegative integer.")
    if batch.product_id != slot.product_id:
        raise ValidationError("The batch and slot must contain the same product.")
    others = slot.stock.exclude(batch=batch).aggregate(total=Sum("quantity_on_hand"))["total"] or 0
    if others + quantity > slot.capacity:
        raise ValidationError("The total stock exceeds the slot capacity.")
    row, _ = TerminalStock.objects.update_or_create(terminal_slot=slot, batch=batch, defaults={"quantity_on_hand": quantity})
    return row
