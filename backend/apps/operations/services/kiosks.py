from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.orders.models import Order
from apps.payments.models import PaymentTransaction
from apps.terminals.models import Terminal
from apps.terminals.services.maintenance import live_session
from apps.operations.audit import record_activity
from .common import require_owner, require_revision, reason_text


def paid_collections(terminal):
    return [{"id": str(row.pk), "order_number": row.order_number,
             "collection_deadline": row.collection_deadline, "total_paid": format(row.total_paid, ".2f")}
            for row in Order.objects.filter(terminal=terminal, collection_required=True,
                paid_at__isnull=False, status="PENDING", collection_deadline__gt=timezone.now()).order_by("collection_deadline")]


def kiosk_blocker(terminal):
    active = live_session(terminal)
    if active is None:
        return "The Kiosk session state is unavailable. Try again when Redis is healthy."
    if active:
        return "A customer session is active. Wait until it ends."
    financial = Order.objects.filter(terminal=terminal, status__in=["PENDING", "DISPENSING", "REVIEW_REQUIRED"])
    if financial.filter(Q(paid_at__isnull=True) | Q(collection_required=False) | Q(payment_uncertain=True)).exists():
        return "A payment or fulfilment operation needs completion or reconciliation."
    if PaymentTransaction.objects.filter(order__terminal=terminal, lease_until__gt=timezone.now()).exists():
        return "A financial operation is currently in progress."
    return None


def kiosk_service_blocker():
    for terminal in Terminal.objects.order_by("pk"):
        reason = kiosk_blocker(terminal)
        if reason:
            return f"{terminal.pk}: {reason}"
    return None


def maintenance_preview(terminal):
    reason = kiosk_blocker(terminal) if not terminal.maintenance_enabled else None
    return {"serial_number": terminal.pk, "enabled": terminal.maintenance_enabled,
            "eligible": reason is None, "blocking_reason": reason, "revision": terminal.revision,
            "paid_waiting_orders": paid_collections(terminal),
            "warning": "Maintenance stops all customer access, including collection. Existing collection deadlines and expiry/refund rules remain unchanged."}


@transaction.atomic
def set_maintenance(*, actor, serial, enabled, reason, revision, acknowledge_paid_orders=False):
    require_owner(actor)
    if not isinstance(enabled, bool):
        raise AuthError("enabled must be a boolean.", 400)
    terminal = Terminal.objects.select_for_update().get(pk=serial)
    require_revision(terminal, revision)
    reason = reason_text(reason)
    if enabled:
        blocker = kiosk_blocker(terminal)
        if blocker:
            raise AuthError(blocker, 409)
        if paid_collections(terminal) and acknowledge_paid_orders is not True:
            raise AuthError("Acknowledge the paid collection orders and their unchanged deadlines before entering maintenance.", 409)
    terminal.maintenance_enabled = enabled
    terminal.maintenance_reason = reason
    terminal.maintenance_at = timezone.now()
    terminal.maintenance_by_id = actor.pk
    terminal.revision += 1
    terminal.save(update_fields=["maintenance_enabled", "maintenance_reason", "maintenance_at", "maintenance_by", "revision"])
    record_activity(actor=actor, action="KIOSK_MAINTENANCE", target_type="kiosk", target_id=serial,
                    metadata={"maintenance_enabled": enabled, "revision": terminal.revision})
    return terminal
