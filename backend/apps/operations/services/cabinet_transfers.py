"""Fixed-cabinet loading and returns with conserved batch balances."""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from apps.accounts.security.errors import AuthError
from apps.catalogue.models import Product, ProductBatch
from apps.orders.models import OrderProduct, StockReservation
from apps.operations.audit import record_activity
from apps.operations.models import ExternalStock, OwnerAction, StockMovement
from apps.terminals.models import Terminal, TerminalSlot, TerminalStock
from apps.terminals.services.expiry import expiry_today
from .common import require_owner, require_revision
from .inventory import _existing, action_result
from .records import reserved


def _slot(slot_id, lock=False):
    terminal_id = TerminalSlot.objects.values_list('terminal_id', flat=True).get(pk=slot_id)
    if lock:
        Terminal.objects.select_for_update().get(pk=terminal_id)
    query = TerminalSlot.objects.select_related('product')
    if lock:
        query = query.select_for_update(of=('self',))
    return query.get(pk=slot_id, is_operational=True)


def _unsafe(slot):
    return OrderProduct.objects.filter(terminal_stock__terminal_slot=slot).filter(
        Q(dispense_status='UNKNOWN') | Q(order__status='DISPENSING')).exists()


def load_plan(*, slot_id, product_id, quantity):
    slot = _slot(slot_id)
    product = Product.objects.select_related('category').get(pk=product_id)
    if slot.stock.filter(quantity_on_hand__gt=0, batch__expiry_date__lt=expiry_today()).exists():
        raise AuthError('Remove expired packs before loading this slot.', 409)
    physical = sum(slot.stock.values_list('quantity_on_hand', flat=True))
    if physical and slot.product_id != product_id:
        raise AuthError(f'{slot.slot_code} contains {physical} packs of {slot.product.name_en}. Remove them before adding {product.name_en}.', 409)
    if not product.is_active or not product.category.is_active or _unsafe(slot):
        raise AuthError('This slot or product is unavailable for loading.', 409)
    if slot.product_id != product_id and StockReservation.objects.filter(status='ACTIVE', order_product__terminal_stock__terminal_slot=slot).exists():
        raise AuthError('Active allocations prevent changing this slot product.', 409)
    balances = ExternalStock.objects.filter(batch__product_id=product_id, batch__expiry_date__gte=expiry_today(), quantity__gt=0).select_related('batch').order_by('batch__expiry_date', 'batch_id')
    maximum = min(max(0, slot.capacity-physical), sum(row.quantity for row in balances))
    if quantity < 1 or quantity > maximum:
        raise AuthError(f'Choose between 1 and {maximum} packs for this slot.', 409)
    remaining, allocations = quantity, []
    for row in balances:
        take = min(remaining, row.quantity)
        if take:
            allocations.append({'batch_id': row.batch_id, 'quantity': take, 'revision': row.revision,
                                'batch_number': row.batch.batch_number, 'expiry_date': row.batch.expiry_date.isoformat()})
            remaining -= take
    return {'slot_id': slot_id, 'product_id': product_id, 'quantity': quantity,
            'slot_revision': slot.revision, 'batches': allocations, 'maximum': maximum}


@transaction.atomic
def load(*, actor, slot_id, product_id, quantity, slot_revision, batches, action_id):
    require_owner(actor)
    slot = _slot(slot_id, True)
    payload = {'operation': 'load', 'slot_id': slot_id, 'product_id': product_id, 'quantity': quantity,
               'slot_revision': slot_revision, 'batches': batches}
    previous, fingerprint = _existing(actor, action_id, payload)
    if previous:
        return action_result(previous)
    locked = list(ProductBatch.objects.select_for_update().filter(product_id=product_id).order_by('pk'))
    list(ExternalStock.objects.select_for_update().filter(batch__in=locked).order_by('batch_id'))
    require_revision(slot, slot_revision)
    plan = load_plan(slot_id=slot_id, product_id=product_id, quantity=quantity)
    expected = [{key: row[key] for key in ('batch_id', 'quantity', 'revision')} for row in plan['batches']]
    if expected != batches:
        raise AuthError('External stock changed. Review the updated batch allocation.', 409)
    action = OwnerAction.objects.create(id=action_id, actor=actor, action='cabinet-load', target_type='slot', target_id=str(slot_id), fingerprint=fingerprint, reason='Load external packs into cabinet', status='SUCCEEDED', result=plan)
    for allocation in expected:
        balance = ExternalStock.objects.get(batch_id=allocation['batch_id'])
        balance.quantity -= allocation['quantity']
        balance.revision += 1
        balance.save()
        stock, _ = TerminalStock.objects.get_or_create(terminal_slot=slot, batch_id=allocation['batch_id'])
        stock.quantity_on_hand += allocation['quantity']
        stock.revision += 1
        stock.save()
        StockMovement.objects.create(action=action, batch_id=balance.batch_id, slot=slot, quantity=allocation['quantity'], direction='LOAD')
    slot.product_id = product_id
    slot.revision += 1
    slot.save()
    record_activity(actor=actor, action='CABINET_LOAD', target_type='slot', target_id=slot_id, metadata={'quantity': quantity, 'action_id': str(action_id)})
    return action_result(action)


@transaction.atomic
def return_packs(*, actor, slot_id, slot_revision, batches, action_id, expired_removal_confirmed=False):
    require_owner(actor)
    slot = _slot(slot_id, True)
    payload = {'operation': 'return', 'slot_id': slot_id, 'slot_revision': slot_revision, 'batches': batches}
    if expired_removal_confirmed:
        payload['expired_removal_confirmed'] = True
    previous, fingerprint = _existing(actor, action_id, payload)
    if previous:
        return action_result(previous)
    require_revision(slot, slot_revision)
    if _unsafe(slot):
        raise AuthError('Unconfirmed dispensing prevents removing these packs.', 409)
    ids = [row['batch_id'] for row in batches]
    if len(ids) != len(set(ids)) or not ids:
        raise AuthError('Select each batch only once.', 400)
    list(ProductBatch.objects.select_for_update().filter(pk__in=ids).order_by('pk'))
    stocks = {row.batch_id: row for row in slot.stock.select_for_update().filter(batch_id__in=ids)}
    expired_ids = set(ProductBatch.objects.filter(pk__in=ids, expiry_date__lt=expiry_today()).values_list('pk', flat=True))
    if expired_ids and not expired_removal_confirmed:
        raise AuthError('Confirm that you physically removed the selected expired packs from the machine.', 400)
    for allocation in batches:
        stock = stocks.get(allocation['batch_id'])
        if stock is None:
            raise AuthError('The selected batch is not in this slot.', 409)
        require_revision(stock, allocation['revision'])
        if allocation['quantity'] < 1 or allocation['quantity'] > stock.quantity_on_hand-reserved(stock):
            raise AuthError('Reserved packs must remain in the slot. Review the available quantity.', 409)
    total = sum(row['quantity'] for row in batches)
    action = OwnerAction.objects.create(id=action_id, actor=actor, action='cabinet-return', target_type='slot', target_id=str(slot_id), fingerprint=fingerprint, reason='Return cabinet packs to external inventory', status='SUCCEEDED', result={'slot_id':slot_id, 'quantity':total})
    for allocation in batches:
        stock = stocks[allocation['batch_id']]
        balance, _ = ExternalStock.objects.get_or_create(batch_id=stock.batch_id)
        balance.quantity += allocation['quantity']
        balance.revision += 1
        balance.save()
        stock.quantity_on_hand -= allocation['quantity']
        stock.revision += 1
        stock.save()
        StockMovement.objects.create(action=action, batch_id=stock.batch_id, slot=slot, quantity=allocation['quantity'], direction='RETURN')
    slot.revision += 1
    slot.save()
    record_activity(actor=actor, action='CABINET_RETURN', target_type='slot', target_id=slot_id, metadata={'quantity':total, 'action_id':str(action_id), 'expired_removal_confirmed': expired_removal_confirmed, 'expired_batch_ids': sorted(expired_ids)})
    return action_result(action)
