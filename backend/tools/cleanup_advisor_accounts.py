"""Guarded one-time cleanup authorized for the pre-registration demonstration.

Use preview() first and pass its exact result to execute(). This is deliberately
not an application endpoint or a routine maintenance operation.
"""
import hashlib
from pathlib import Path

from django.db import transaction
from django.core.management.base import CommandError

from apps.accounts.models import Doctor, RefreshToken, User
from apps.accounts.security import mfa
from apps.accounts.security.state import get_redis_client
from apps.prescriptions.models import ClinicLetterhead, Prescription, PrescriptionAction, PrescriptionLine


def preview():
    doctors = Doctor.objects.order_by('pk')
    ids = list(doctors.values_list('pk', flat=True))
    prescriptions = Prescription.objects.filter(doctor_id__in=ids)
    user_ids = list(User.objects.filter(account_type='DOCTOR').order_by('pk').values_list('pk', flat=True))
    if ids != user_ids:
        raise CommandError('Doctor profiles and doctor-only accounts differ; inspect before cleanup.')
    # User explicitly identified these two prescriptions as their own test data.
    if prescriptions.exclude(doctor__user__first_name__iexact='Youssef', doctor__user__last_name__iexact='Negm').exists():
        raise CommandError('Unexpected prescription issuer; cleanup stopped.')
    allowed = {'accounts.Doctor', 'accounts.RefreshToken'}
    for relation in User._meta.related_objects:
        model = relation.related_model
        if model._meta.label in allowed:
            continue
        if model.objects.filter(**{relation.field.name + '_id__in': ids}).exists():
            raise CommandError(f'Unexpected account reference in {model._meta.label}; nothing deleted.')
    from apps.accounts.models import DoctorRegistrationDraft, DoctorVerificationDocument
    if DoctorRegistrationDraft.objects.exists() or DoctorVerificationDocument.objects.exists():
        raise CommandError('Registration activity exists; inspect it before one-time cleanup.')
    return {
        'doctor_ids': ids,
        'prescription_ids': sorted(str(pk) for pk in prescriptions.values_list('pk', flat=True)),
        'doctors': len(ids), 'prescriptions': prescriptions.count(),
        'lines': PrescriptionLine.objects.filter(prescription__in=prescriptions).count(),
        'actions': PrescriptionAction.objects.filter(doctor_id__in=ids).count(),
        'letterheads': ClinicLetterhead.objects.filter(doctor_id__in=ids).count(),
        'refresh_sessions': RefreshToken.objects.filter(user_id__in=ids).count(),
    }


def execute(*, backup, expected):
    path = Path(backup)
    with path.open('rb') as source:
        if source.read(5) != b'PGDMP':
            raise CommandError('A verified PostgreSQL custom-format backup is required.')
    if expected.get('doctors') != 4 or expected.get('prescriptions') != 2:
        raise CommandError('Counts differ from the authorized four-doctor/two-prescription cleanup.')
    redis = get_redis_client()
    redis.ping()  # Abort before deletion if targeted authentication cleanup cannot run.
    with transaction.atomic():
        ids = expected['doctor_ids']
        list(User.objects.select_for_update().filter(pk__in=ids).order_by('pk'))
        list(Doctor.objects.select_for_update().filter(pk__in=ids).order_by('pk'))
        actual = preview()
        if actual != expected:
            raise CommandError('Cleanup references changed after preview; nothing deleted.')
        prescriptions = Prescription.objects.filter(doctor_id__in=ids)
        # Do not unlink an unexpected replacement issued outside this selected set.
        if Prescription.objects.exclude(doctor_id__in=ids).filter(replaces__in=prescriptions).exists():
            raise CommandError('Unexpected prescription replacement reference; nothing deleted.')
        PrescriptionAction.objects.filter(doctor_id__in=ids).delete()
        PrescriptionLine.objects.filter(prescription__in=prescriptions).delete()
        prescriptions.update(replaces=None)
        prescriptions.delete()
        ClinicLetterhead.objects.filter(doctor_id__in=ids).delete()
        sessions = RefreshToken.objects.filter(user_id__in=ids)
        sessions.update(replaced_by=None)
        sessions.delete()
        Doctor.objects.filter(pk__in=ids).delete()
        User.objects.filter(pk__in=ids, account_type='DOCTOR').delete()
    # Exact per-doctor MFA pointers only; never clear shared Redis namespaces.
    for doctor_id in ids:
        latest = mfa.latest_key(doctor_id)
        challenge = redis.get(latest)
        if challenge and challenge.startswith(mfa.auth_key('mfa:challenge:')):
            redis.delete(challenge)
        redis.delete(latest)
        used = list(redis.scan_iter(match=mfa.auth_key(f'mfa:used:{mfa._digest(doctor_id)}:*')))
        if used:
            redis.delete(*used)
    return {'deleted': {k: v for k, v in actual.items() if not k.endswith('_ids')},
            'backup_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
