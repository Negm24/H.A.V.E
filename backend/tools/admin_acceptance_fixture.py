"""Explicit live acceptance fixtures. No shared database/Redis reset or external I/O.

Run through manage.py shell after migrations. Private generated credentials are
read from /development/admin-acceptance.local.json and never printed. Cleanup
deactivates only fixture records and revokes their login generations.
"""
import json
import os
from datetime import date, timedelta
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.security.tokens import token_hash
from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.services.customer_services.registration import create_customer_account
from apps.accounts.services.doctor_services.registration import create_doctor_account
from apps.catalogue.models import Category, Product, ProductBatch
from apps.terminals.models import Terminal, TerminalSlot
from apps.terminals.services.inventory_services import set_stock

if not str(connection.settings_dict["NAME"]).startswith("test_"):
    raise RuntimeError("Admin acceptance fixtures require an isolated Django test database.")

path = Path('/development/admin-acceptance.local.json')
if not path.exists():
    path = settings.BASE_DIR.parent / 'development' / 'admin-acceptance.local.json'
data = json.loads(path.read_text(encoding='utf-8-sig'))
cleanup = os.environ.get('ADMIN_ACCEPTANCE_CLEANUP') == 'true'
sku = 'ADMIN-ACCEPTANCE-ONLY'
serial = 'ADMIN-ACCEPTANCE-ONLY'


def known_user(role, phone, email):
    user = User.objects.filter(account_type=role, phone_number=phone).first()
    if user and user.email != email:
        raise RuntimeError('Fixture phone collides with another account; no changes made.')
    return user


with transaction.atomic():
    owner = known_user('OWNER', data['owner_phone'], 'admin-acceptance@example.test')
    customer = known_user('CUSTOMER', data['customer_phone'], 'admin-customer@example.test')
    doctor = known_user('DOCTOR', data['doctor_phone'], 'admin-doctor@example.test')
    if cleanup:
        for user in (owner, customer, doctor):
            if user:
                user.is_disabled = True
                user.save(update_fields=['is_disabled'])
                profile = user.credential_profile
                profile.credential_changed_at = timezone.now()
                profile.save(update_fields=['credential_changed_at'])
        Terminal.objects.filter(pk=serial).update(is_disabled=True, maintenance_enabled=False)
        Product.objects.filter(sku=sku).update(is_active=False)
        print('Dedicated Admin acceptance fixtures deactivated; existing records preserved.')
    else:
        if owner is None:
            owner = create_owner_account(first_name='Acceptance', last_name='Owner',
                phone_number=data['owner_phone'], email='admin-acceptance@example.test', password=data['owner_password'])
        elif not owner.check_password(data['owner_password']):
            raise RuntimeError('Fixture credential mismatch; no password reset performed.')
        if customer is None:
            customer = create_customer_account(first_name='Acceptance', last_name='Customer',
                phone_number=data['customer_phone'], email='admin-customer@example.test', date_of_birth=date(2000, 1, 1), pin='4826')
            customer.phone_verified_at = timezone.now()
            customer.save(update_fields=['phone_verified_at'])
        if doctor is None:
            doctor = create_doctor_account(first_name='Acceptance', last_name='Doctor',
                phone_number=data['doctor_phone'], email='admin-doctor@example.test', password=data['doctor_password'],
                professional_license_number='ADMIN-ACCEPTANCE-ONLY', specialty='Fictional acceptance',
                clinic_name='Fictional acceptance clinic', clinic_address='Fictional acceptance address')
        for user in (owner, customer, doctor):
            user.is_disabled = False
            user.save(update_fields=['is_disabled'])
        terminal, _ = Terminal.objects.get_or_create(serial_number=serial, defaults={
            'display_name': 'Admin acceptance kiosk', 'address_en': 'Fictional acceptance site',
            'address_ar': 'موقع اختبار وهمي', 'latitude': 0, 'longitude': 0,
            'device_credential_hash': token_hash(data['terminal_key'])})
        if terminal.device_credential_hash != token_hash(data['terminal_key']):
            raise RuntimeError('Fixture Kiosk credential mismatch; no key rotation performed.')
        terminal.is_disabled = False
        terminal.save(update_fields=['is_disabled'])
        category, _ = Category.objects.get_or_create(name_en='Admin acceptance category',
            defaults={'name_ar': 'فئة اختبار الإدارة', 'is_active': True})
        product, _ = Product.objects.get_or_create(sku=sku, defaults={
            'category': category, 'name_en': 'Admin acceptance product', 'name_ar': 'منتج اختبار الإدارة',
            'pack_description': 'Fictional test item', 'usage_instructions_en': 'Acceptance testing only',
            'usage_instructions_ar': 'للاختبار فقط', 'price': '10.00', 'is_active': True})
        if product.category_id != category.pk:
            raise RuntimeError('Fixture product collides with another category; no changes made.')
        product.is_active = True
        product.save(update_fields=['is_active'])
        batch, _ = ProductBatch.objects.get_or_create(product=product, batch_number='ADMIN-ACCEPTANCE-ONLY',
            defaults={'expiry_date': timezone.localdate() + timedelta(days=180)})
        slot, _ = TerminalSlot.objects.get_or_create(terminal=terminal, slot_code='ACCEPT-1',
            defaults={'product': product, 'capacity': 20})
        if not slot.stock.exists():
            set_stock(slot_id=slot.pk, batch=batch, quantity=5)
        print(json.dumps({'owner_id': owner.pk, 'customer_id': customer.pk, 'doctor_id': doctor.pk,
                          'terminal_serial': serial, 'product_id': product.pk, 'category_id': category.pk,
                          'batch_id': batch.pk, 'slot_id': slot.pk}))
