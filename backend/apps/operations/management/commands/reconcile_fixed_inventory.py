"""One-time, conserved physical-cabinet correction and fixture cleanup."""
import json
from uuid import uuid4
from django.core.management.base import BaseCommand, CommandError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Q, Sum
from apps.accounts.models import User
from apps.catalogue.models import Category, Product, ProductBatch
from apps.orders.models import Order, OrderProduct, StockReservation
from apps.operations.models import ExternalStock, FixtureArchive, OwnerAction, StockMovement
from apps.terminals.models import Terminal, TerminalSlot, TerminalStock

FIXTURES = ['ADMIN-ACCEPTANCE-ONLY', 'ADMIN-REDESIGN-ONLY']


def totals():
    values = {}
    for row in TerminalStock.objects.exclude(batch__product__sku__in=FIXTURES).values('batch_id').annotate(total=Sum('quantity_on_hand')):
        values[row['batch_id']] = row['total']
    for row in ExternalStock.objects.exclude(batch__product__sku__in=FIXTURES):
        values[row.batch_id] = values.get(row.batch_id,0)+row.quantity
    return {key:value for key,value in values.items() if value}


class Command(BaseCommand):
    help = 'Preview or apply fixed 24-slot inventory reconciliation.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    @transaction.atomic
    def handle(self, *args, **options):
        terminals = list(Terminal.objects.select_for_update().exclude(pk='ADMIN-ACCEPTANCE-ONLY').order_by('pk'))
        fixture_products = Product.objects.filter(sku__in=FIXTURES)
        if OrderProduct.objects.filter(product__in=fixture_products).exists() or Order.objects.filter(terminal_id='ADMIN-ACCEPTANCE-ONLY').exists():
            raise CommandError('Fixture order references require review before cleanup.')
        mappings, surplus = {}, []
        for terminal in terminals:
            slots = list(terminal.slots.select_for_update().order_by('slot_code','pk'))
            confirmed = [slot for slot in slots if slot.cabinet_row and slot.cabinet_column and slot.is_operational]
            if terminal.pk == 'HAVE-TEST-002':
                chosen = [next((slot for slot in slots if slot.slot_code == f'EG-{index:03}'),None) for index in range(1,25)]
            elif len(confirmed) == 24:
                chosen = sorted(confirmed,key=lambda slot:(slot.cabinet_row,slot.cabinet_column))
            else:
                chosen = slots[:24]
            if len(chosen) != 24 or any(slot is None for slot in chosen):
                raise CommandError(f'{terminal.pk} needs 24 identifiable slots before reconciliation.')
            mappings[terminal.pk] = chosen
            extra = [slot for slot in slots if slot not in chosen]
            ids = [slot.pk for slot in extra]
            if StockReservation.objects.filter(status='ACTIVE',order_product__terminal_stock__terminal_slot_id__in=ids).exists() or OrderProduct.objects.filter(terminal_stock__terminal_slot_id__in=ids).filter(Q(dispense_status='UNKNOWN')|Q(order__status='DISPENSING')).exists():
                raise CommandError(f'{terminal.pk} surplus slots contain active or uncertain work.')
            surplus.extend(extra)
        self.stdout.write(json.dumps({'machines':{key:[slot.slot_code for slot in value] for key,value in mappings.items()},'surplus_slots':len(surplus),'packs_to_external':TerminalStock.objects.filter(terminal_slot__in=surplus).aggregate(total=Sum('quantity_on_hand'))['total'] or 0,'fixture_products':fixture_products.count(),'fixture_movements':StockMovement.objects.filter(batch__product__in=fixture_products).count()}))
        if not options['apply']:
            self.stdout.write('Preview only. Use --apply after backup.')
            return
        before = totals()
        actor = User.objects.filter(account_type='OWNER',is_disabled=False).first()
        if not actor:
            raise CommandError('An active Owner is required to attribute reconciliation.')
        batch_ids = list(TerminalStock.objects.filter(terminal_slot__in=surplus).values_list('batch_id',flat=True).distinct())
        list(ProductBatch.objects.select_for_update().filter(pk__in=batch_ids).order_by('pk'))
        action = OwnerAction.objects.create(actor=actor,action='cabinet-reconcile',target_type='inventory',target_id='fixed24',fingerprint=uuid4().hex,reason='Reconcile seeded slots with physical 24-position cabinets',status='SUCCEEDED')
        for slot in surplus:
            for stock in slot.stock.select_for_update():
                if stock.quantity_on_hand:
                    external, _ = ExternalStock.objects.get_or_create(batch_id=stock.batch_id)
                    external.quantity += stock.quantity_on_hand
                    external.revision += 1
                    external.save()
                    StockMovement.objects.create(action=action,batch_id=stock.batch_id,slot=slot,quantity=stock.quantity_on_hand,direction='RETURN')
                    stock.quantity_on_hand = 0
                    stock.revision += 1
                    stock.save()
            slot.is_operational = False
            slot.is_enabled = False
            slot.cabinet_row = slot.cabinet_column = None
            slot.revision += 1
            slot.save()
        for terminal in terminals:
            for index, slot in enumerate(mappings[terminal.pk]):
                slot.is_operational = True
                slot.cabinet_row, slot.cabinet_column = index//6+1,index%6+1
                slot.save()
            terminal.layout_confirmed = True
            terminal.layout_revision += 1
            terminal.save()
        if before != totals():
            raise CommandError('Batch conservation failed; transaction rolled back.')
        if fixture_products.exists():
            fixture_slots = TerminalSlot.objects.filter(Q(terminal_id='ADMIN-ACCEPTANCE-ONLY')|Q(product__in=fixture_products))
            if OrderProduct.objects.filter(terminal_stock__terminal_slot__in=fixture_slots).exists():
                raise CommandError('A fixture slot has an order reference; transaction rolled back.')
            if fixture_slots.exclude(terminal_id='ADMIN-ACCEPTANCE-ONLY').exists() or TerminalStock.objects.filter(terminal_slot__in=fixture_slots).exclude(batch__product__in=fixture_products).exists() or StockMovement.objects.filter(slot__in=fixture_slots).exclude(batch__product__in=fixture_products).exists():
                raise CommandError('Fixture cleanup intersects real machine or medicine records; transaction rolled back.')
            payload = {'products':list(fixture_products.values()),'batches':list(ProductBatch.objects.filter(product__in=fixture_products).values()),'movements':list(StockMovement.objects.filter(batch__product__in=fixture_products).values()),'slots':list(fixture_slots.values()),'stock':list(TerminalStock.objects.filter(terminal_slot__in=fixture_slots).values()),'external':list(ExternalStock.objects.filter(batch__product__in=fixture_products).values())}
            payload = json.loads(json.dumps(payload,cls=DjangoJSONEncoder))
            FixtureArchive.objects.create(key='admin-inventory-fixtures-v1',payload=payload)
            StockMovement.objects.filter(Q(batch__product__in=fixture_products)|Q(slot__in=fixture_slots)).delete()
            TerminalStock.objects.filter(terminal_slot__in=fixture_slots).delete()
            fixture_slots.delete()
            Terminal.objects.filter(pk='ADMIN-ACCEPTANCE-ONLY').delete()
            ExternalStock.objects.filter(batch__product__in=fixture_products).delete()
            ProductBatch.objects.filter(product__in=fixture_products).delete()
            fixture_products.delete()
        if before != totals():
            raise CommandError('Final batch conservation failed; transaction rolled back.')
        categories = Category.objects.filter(name_en='Admin acceptance category', products__isnull=True)
        if categories.exists():
            FixtureArchive.objects.create(key='admin-inventory-fixture-categories-v1', payload={'categories': list(categories.values())})
            categories.delete()
        self.stdout.write('Applied: 24 operational positions per machine; per-batch totals conserved; fixture archive preserved.')
