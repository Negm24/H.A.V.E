"""Extend only the dedicated Admin fixture with 24 cabinet slots and external stock.
Run the existing acceptance fixture first. ADMIN_ACCEPTANCE_CLEANUP=true disables
only this extension's product; no balances or movement history are deleted.
"""
import os
from datetime import timedelta
from django.db import connection, transaction
from django.utils import timezone
from apps.catalogue.models import Product, ProductBatch
from apps.terminals.models import Terminal, TerminalSlot
from apps.operations.models import ExternalStock

if not str(connection.settings_dict["NAME"]).startswith("test_"):
    raise RuntimeError("Admin acceptance fixtures require an isolated Django test database.")

with transaction.atomic():
    if os.environ.get('ADMIN_ACCEPTANCE_CLEANUP') == 'true':
        Product.objects.filter(sku='ADMIN-REDESIGN-ONLY').update(is_active=False)
        print('Admin redesign fixture product deactivated.')
    else:
        terminal = Terminal.objects.get(pk='ADMIN-ACCEPTANCE-ONLY')
        original = Product.objects.get(sku='ADMIN-ACCEPTANCE-ONLY')
        second, _ = Product.objects.get_or_create(sku='ADMIN-REDESIGN-ONLY', defaults={
            'category': original.category, 'name_en':'Admin replacement product', 'name_ar':'منتج بديل للاختبار',
            'pack_description':'Fictional packs', 'usage_instructions_en':'Acceptance only',
            'usage_instructions_ar':'للاختبار', 'price':'5.00', 'is_active':True})
        second.is_active = True
        second.save(update_fields=['is_active'])
        batch, _ = ProductBatch.objects.get_or_create(product=second, batch_number='ADMIN-REDESIGN-ONLY', defaults={'expiry_date':timezone.localdate()+timedelta(days=180)})
        ExternalStock.objects.get_or_create(batch=batch, defaults={'quantity':50})
        first_batch = original.batches.first() if hasattr(original,'batches') else ProductBatch.objects.filter(product=original).first()
        ExternalStock.objects.get_or_create(batch=first_batch, defaults={'quantity':50})
        for index in range(2,25):
            TerminalSlot.objects.get_or_create(terminal=terminal, slot_code=f'ACCEPT-{index:02}',defaults={'product':original,'capacity':20})
        print('Admin redesign fixture ready: 24 slots and two external batch balances.')
