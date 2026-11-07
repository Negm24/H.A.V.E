from decimal import Decimal
from hashlib import sha256
import json
import secrets

from django.db import transaction
from django.db.models import Sum

from apps.accounts.security.errors import AuthError
from apps.accounts.security.tokens import token_hash
from apps.catalogue.models import Category, Product, ProductBatch
from apps.terminals.models import Terminal, TerminalSlot, TerminalStock
from apps.terminals.services.inventory_services import set_stock
from apps.orders.models import StockReservation
from apps.operations.audit import record_activity
from apps.operations.models import OwnerAction
from .common import require_owner, require_revision, reason_text


def reserved(row):
    return StockReservation.objects.filter(status="ACTIVE", order_product__terminal_stock=row).aggregate(total=Sum("quantity"))["total"] or 0


def stock_data(row):
    return {"id": row.pk, "slot_id": row.terminal_slot_id, "batch_id": row.batch_id,
            "quantity": row.quantity_on_hand, "revision": row.revision,
            "terminal_serial": row.terminal_slot.terminal_id, "slot_code": row.terminal_slot.slot_code,
            "product_id": row.batch.product_id, "product_name": row.batch.product.name_en,
            "batch_number": row.batch.batch_number, "expiry_date": row.batch.expiry_date,
            "reserved_quantity": reserved(row)}


@transaction.atomic
def write_record(*, actor, model, serializer_type, data, pk=None, revision=None):
    require_owner(actor)
    if model is TerminalSlot:
        if pk is None:
            raise AuthError("A machine has exactly 24 fixed slots.", 405)
        terminal_id = model.objects.values_list("terminal_id", flat=True).get(pk=pk) if pk else data.get("terminal_serial")
        Terminal.objects.select_for_update().get(pk=terminal_id)
    instance = model.objects.select_for_update().get(pk=pk) if pk is not None else None
    if instance:
        require_revision(instance, revision)
        if model is TerminalSlot and not instance.is_operational:
            raise AuthError("Historical slots cannot be changed.", 409)
    serializer = serializer_type(instance, data=data, partial=instance is not None)
    allowed = {name for name, field in serializer.fields.items() if not field.read_only}
    if set(data) - allowed:
        raise AuthError("The request contains unsupported or read-only fields.", 400)
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    if instance and model is Terminal:
        if "serial_number" in values and values["serial_number"] != instance.pk:
            raise AuthError("Kiosk serial numbers cannot be changed.", 409)
    if instance and model is TerminalSlot:
        if "terminal_id" in values and values["terminal_id"] != instance.terminal_id:
            raise AuthError("A slot cannot be moved to a different Kiosk.", 409)
        physical = instance.stock.aggregate(total=Sum("quantity_on_hand"))["total"] or 0
        held = StockReservation.objects.filter(status="ACTIVE", order_product__terminal_stock__terminal_slot=instance).exists()
        if values.get("capacity", instance.capacity) < physical:
            raise AuthError("Capacity cannot be smaller than physical stock.", 409)
        if (values.get("product_id", instance.product_id) != instance.product_id and (physical or held)) or (values.get("is_enabled") is False and held):
            raise AuthError("The slot has stock or active reservations. Reconcile these before changing its assignment.", 409)
    if instance and model is ProductBatch:
        changing = any(key in values and values[key] != getattr(instance, key) for key in ("product_id", "batch_number", "expiry_date"))
        from apps.operations.models import ExternalStock
        if changing and (instance.terminal_stock.filter(quantity_on_hand__gt=0).exists()
                         or ExternalStock.objects.filter(batch=instance, quantity__gt=0).exists()):
            raise AuthError("A stocked batch's identity and expiry are immutable. Create the correct batch and reconcile stock instead.", 409)
    record = instance or model()
    previous_price = format(record.price, ".2f") if instance and model is Product else None
    for name, value in values.items():
        setattr(record, name, value)
    if instance:
        record.revision += 1
    elif model is Terminal:
        # Registration never exposes a raw device credential. Complete physical
        # enrollment through the existing private provision/rotation procedure.
        record.device_credential_hash = token_hash(secrets.token_urlsafe(32))
    record.full_clean()
    record.save()
    if model is Terminal and instance is None:
        TerminalSlot.objects.bulk_create([
            TerminalSlot(terminal=record, slot_code=f"{chr(65+row)}{column+1}", capacity=20,
                         cabinet_row=row+1, cabinet_column=column+1)
            for row in range(4) for column in range(6)
        ])
        record.layout_confirmed = True
        record.save(update_fields=["layout_confirmed"])
    metadata = {"revision": record.revision}
    if model is Product:
        metadata.update(price=format(record.price, ".2f"), previous_price=previous_price)
    record_activity(actor=actor, action="UPDATE" if instance else "CREATE", target_type=model._meta.model_name,
                    target_id=record.pk, metadata=metadata)
    return record


@transaction.atomic
def adjust_stock(*, actor, slot_id, batch_id, quantity, revision, reason):
    require_owner(actor)
    reason = reason_text(reason)
    terminal_id = TerminalSlot.objects.values_list("terminal_id", flat=True).get(pk=slot_id)
    Terminal.objects.select_for_update().get(pk=terminal_id)
    slot = TerminalSlot.objects.select_for_update().get(pk=slot_id)
    batch = ProductBatch.objects.select_for_update().get(pk=batch_id)
    current = TerminalStock.objects.select_for_update().filter(terminal_slot=slot, batch=batch).first()
    if current:
        require_revision(current, revision)
    elif revision != 0:
        raise AuthError("Stock changed. Reload the inventory before adjusting it.", 409)
    before = current.quantity_on_hand if current else 0
    row = set_stock(slot_id=slot.pk, batch=batch, quantity=quantity)
    # Keep the Owner's justification in the privileged action record. The
    # telemetry-safe activity metadata carries quantities and its record ID,
    # never the entered reason text.
    action = OwnerAction.objects.create(actor=actor, target_type="stock", target_id=str(row.pk),
        action="stock-adjust", status="SUCCEEDED", reason=reason,
        fingerprint=sha256(json.dumps([str(actor.pk), row.pk, before, quantity, row.revision, reason]).encode()).hexdigest(),
        result={"stock_id": row.pk, "previous_quantity": before, "quantity": quantity, "revision": row.revision})
    record_activity(actor=actor, action="STOCK_ADJUST", target_type="stock", target_id=row.pk,
                    metadata={"previous_quantity": before, "quantity": quantity, "revision": row.revision,
                              "slot_id": slot.pk, "batch_id": batch.pk, "job_id": str(action.pk)})
    return row
