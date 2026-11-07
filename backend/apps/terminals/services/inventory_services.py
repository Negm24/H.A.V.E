from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum

from apps.terminals.models import Terminal, TerminalSlot, TerminalStock
from apps.catalogue.models import ProductBatch


@transaction.atomic
def set_stock(*, slot_id, batch, quantity):
    """All inventory writers must lock the slot, including when inserting a new batch."""
    terminal_id = TerminalSlot.objects.values_list("terminal_id", flat=True).get(pk=slot_id)
    Terminal.objects.select_for_update().get(pk=terminal_id)
    slot = TerminalSlot.objects.select_for_update().get(pk=slot_id)
    batch = ProductBatch.objects.select_for_update().get(pk=batch.pk)
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 0:
        raise ValidationError("Stock quantity must be a nonnegative integer.")
    if batch.product_id != slot.product_id:
        raise ValidationError("The batch and slot must contain the same product.")
    others = slot.stock.exclude(batch=batch).aggregate(total=Sum("quantity_on_hand"))["total"] or 0
    if others + quantity > slot.capacity:
        raise ValidationError("The total stock exceeds the slot capacity.")
    row = TerminalStock.objects.select_for_update().filter(terminal_slot=slot, batch=batch).first()
    if row:
        from apps.orders.models import StockReservation
        held = StockReservation.objects.filter(status="ACTIVE", order_product__terminal_stock=row).aggregate(total=Sum("quantity"))["total"] or 0
        if quantity < held:
            raise ValidationError("Stock cannot be reduced below active reservations. Reconcile affected orders first.")
        row.quantity_on_hand = quantity
        row.revision += 1
        row.save(update_fields=["quantity_on_hand", "revision", "updated_at"])
    else:
        row = TerminalStock.objects.create(terminal_slot=slot, batch=batch, quantity_on_hand=quantity)
    return row
