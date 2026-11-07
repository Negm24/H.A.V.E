from zoneinfo import ZoneInfo
from django.utils import timezone
from apps.terminals.models import TerminalStock


def expiry_today():
    return timezone.localdate(timezone=ZoneInfo('Africa/Cairo'))


def expired_slot_ids():
    return TerminalStock.objects.filter(quantity_on_hand__gt=0,
        batch__expiry_date__lt=expiry_today()).values('terminal_slot_id')
