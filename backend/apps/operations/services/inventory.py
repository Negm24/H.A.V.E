"""Owner inventory movements conserve batch quantities across both locations."""
from datetime import timedelta
import hashlib
import json
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from apps.terminals.services.expiry import expiry_today
from apps.accounts.security.errors import AuthError
from apps.catalogue.models import ProductBatch
from apps.orders.models import StockReservation
from apps.operations.models import ExternalStock, StockMovement, OwnerAction
from apps.operations.audit import record_activity
from apps.terminals.models import Terminal, TerminalSlot, TerminalStock
from .common import require_owner, require_revision, reason_text
from .records import stock_data, reserved


def external_data(batch):
    balance = ExternalStock.objects.filter(batch=batch).first()
    return {"id": batch.pk, "batch_id": batch.pk, "product_id": batch.product_id,
            "product_name": batch.product.name_en, "batch_number": batch.batch_number,
            "expiry_date": batch.expiry_date, "quantity": balance.quantity if balance else 0,
            "revision": balance.revision if balance else 0}


def _existing(actor, action_id, payload):
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    action = OwnerAction.objects.filter(pk=action_id).first()
    if action and (action.actor_id != actor.pk or action.fingerprint != fingerprint):
        raise AuthError("The action reference has already been used for a different operation.", 409)
    return action, fingerprint


def action_result(action):
    return {"id": str(action.pk), "status": action.status, "result": action.result}


@transaction.atomic
def adjust_external(*, actor, batch_id, quantity, revision, reason, action_id):
    require_owner(actor)
    reason = reason_text(reason)
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 0:
        raise AuthError("Quantity must be a nonnegative pack count.", 400)
    batch = ProductBatch.objects.select_for_update().get(pk=batch_id)
    previous, fingerprint = _existing(actor, action_id, dict(batch_id=batch_id, quantity=quantity, revision=revision, reason=reason))
    if previous:
        return action_result(previous)
    balance = ExternalStock.objects.select_for_update().filter(batch=batch).first()
    if revision != (balance.revision if balance else 0):
        raise AuthError("External stock changed. Refresh before correcting it.", 409)
    balance = balance or ExternalStock(batch=batch)
    before = balance.quantity
    balance.quantity = quantity
    balance.revision += 1
    balance.full_clean()
    balance.save()
    action = OwnerAction.objects.create(id=action_id, actor=actor, action="external-adjust", target_type="batch",
        target_id=str(batch_id), reason=reason, fingerprint=fingerprint, status="SUCCEEDED", result={"batch_id": batch_id, "quantity": quantity})
    StockMovement.objects.create(action=action, batch=batch, quantity=quantity-before, direction="EXTERNAL_CORRECTION")
    record_activity(actor=actor, action="EXTERNAL_ADJUST", target_type="batch", target_id=batch_id,
                    metadata={"before": before, "quantity": quantity, "action_id": str(action_id)})
    return action_result(action)


@transaction.atomic
def transfer(*, actor, slot_id, batch_id, quantity, slot_revision, external_revision, reason, action_id):
    require_owner(actor)
    reason = reason_text(reason)
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
        raise AuthError("Choose a positive pack count.", 400)
    terminal_id = TerminalSlot.objects.values_list("terminal_id", flat=True).get(pk=slot_id)
    Terminal.objects.select_for_update().get(pk=terminal_id)
    slot = TerminalSlot.objects.select_for_update().get(pk=slot_id, is_operational=True)
    batch_ids = set(slot.stock.values_list("batch_id", flat=True)) | {batch_id}
    batches = {b.pk: b for b in ProductBatch.objects.select_for_update().filter(pk__in=sorted(batch_ids)).order_by("pk")}
    batch = batches.get(batch_id)
    if batch is None:
        raise AuthError("Batch not found.", 404)
    payload = dict(slot_id=slot_id, batch_id=batch_id, quantity=quantity, slot_revision=slot_revision,
                             external_revision=external_revision, reason=reason)
    previous, fingerprint = _existing(actor, action_id, payload)
    if previous:
        return action_result(previous)
    require_revision(slot, slot_revision)
    external = ExternalStock.objects.select_for_update().filter(batch=batch).first()
    if external_revision != (external.revision if external else 0):
        raise AuthError("External stock changed. Review the new balance.", 409)
    if not external or external.quantity < quantity:
        raise AuthError("External inventory has insufficient packs.", 409)
    if slot.stock.filter(quantity_on_hand__gt=0, batch__expiry_date__lt=expiry_today()).exists():
        raise AuthError('Remove expired packs before loading this slot.', 409)
    if batch.expiry_date < expiry_today() or not batch.product.is_active or not batch.product.category.is_active:
        raise AuthError("The incoming batch is expired or its product is unavailable.", 409)
    rows = list(slot.stock.select_for_update().order_by("batch_id"))
    replacement = slot.product_id != batch.product_id
    if replacement and StockReservation.objects.filter(status="ACTIVE", order_product__terminal_stock__terminal_slot=slot).exists():
        raise AuthError("Reserved packs prevent replacing this slot's product.", 409)
    from apps.orders.models import OrderProduct
    if replacement and OrderProduct.objects.filter(terminal_stock__terminal_slot=slot).filter(
            Q(dispense_status="UNKNOWN") | Q(order__status="DISPENSING")).exists():
        raise AuthError("Unconfirmed dispensing prevents replacing this slot's product.", 409)
    total = sum(row.quantity_on_hand for row in rows)
    if (quantity if replacement else quantity + total) > slot.capacity:
        raise AuthError("The transfer exceeds the slot capacity.", 409)
    action = OwnerAction.objects.create(id=action_id, actor=actor, action="stock-transfer", target_type="slot", target_id=str(slot_id),
        fingerprint=fingerprint, reason=reason, status="SUCCEEDED", result={"slot_id": slot_id, "batch_id": batch_id, "quantity": quantity, "replacement": replacement})
    if replacement:
        if total:
            raise AuthError(f"{slot.slot_code} contains {total} packs of {slot.product.name_en}. Remove them before adding {batch.product.name_en}.", 409)
        slot.product_id = batch.product_id
    external.quantity -= quantity
    external.revision += 1
    external.save()
    destination, _ = TerminalStock.objects.get_or_create(terminal_slot=slot, batch=batch)
    destination.quantity_on_hand += quantity
    destination.revision += 1
    destination.save()
    slot.revision += 1
    slot.save()
    StockMovement.objects.create(action=action, batch=batch, slot=slot, quantity=quantity, direction="LOAD")
    record_activity(actor=actor, action="STOCK_TRANSFER", target_type="slot", target_id=slot_id,
                    metadata={"quantity": quantity, "action_id": str(action_id)})
    return action_result(action)


def cabinet_data(terminal):
    slots = []
    today = expiry_today()
    for index, slot in enumerate(terminal.slots.filter(is_operational=True).select_related("product").order_by("slot_code", "pk")):
        batches = [stock_data(row) | {"available_quantity": max(0, row.quantity_on_hand-reserved(row))} for row in slot.stock.select_related("batch__product", "terminal_slot").order_by("batch__expiry_date")]
        dates = [b['expiry_date'] for b in batches if b['quantity'] > 0]
        expired = any(day < today for day in dates)
        soon = any(today <= day <= today + timedelta(days=30) for day in dates)
        slots.append({'expiry_state': 'expired' if expired else 'expiring_soon' if soon else 'normal', 'expiry_checked_date': today.isoformat(),"id": slot.pk, "slot_code": slot.slot_code, "product_id": slot.product_id,
            "product_name": slot.product.name_en if slot.product else "Empty", "image_url": slot.product.image.url if slot.product and slot.product.image else None,
            "strength": slot.product.strength if slot.product else "", "pack_description": slot.product.pack_description if slot.product else "",
            "capacity": slot.capacity, "revision": slot.revision,
            "row": slot.cabinet_row if terminal.layout_confirmed else index // 6 + 1 if index < 24 else None,
            "column": slot.cabinet_column if terminal.layout_confirmed else index % 6 + 1 if index < 24 else None,
            "quantity": sum(b["quantity"] for b in batches), "reserved_quantity": sum(b["reserved_quantity"] for b in batches), "batches": batches})
    for slot in slots:
        slot["position"] = f'{chr(64 + slot["row"])}{slot["column"]}' if slot["row"] and slot["column"] else slot["slot_code"]
    return {"serial_number": terminal.pk, "revision": terminal.layout_revision, "confirmed": terminal.layout_confirmed, "slots": slots}


def save_layout(**kwargs):
    raise AuthError("The 24 cabinet positions are fixed.", 405)
