"""Restart-safe database work discovery; no queue-only financial work."""
import logging

from django.db import close_old_connections
from django.db.models import F, Q
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.carts.security.state import clear_purchased_cart
from apps.orders.models import Order, Receipt
from apps.orders.services.notification_services import send_order_notice
from apps.orders.services.order_services import expire_orders, fulfil_order
from apps.orders.services.receipt_services import deliver_receipt
from apps.payments.models import PaymentTransaction
from apps.payments.services.payment_services import reconcile, process_refund, request_refund

logger = logging.getLogger(__name__)


def _run(work, stats, name):
    try:
        work()
        stats[name] += 1
    except AuthError:
        # Domain operations persist review/deadline outcomes where required.
        stats["errors"] += 1
    except Exception:
        stats["errors"] += 1
        # Do not log provider responses, credentials or personal recipient data.
        logger.error("Order maintenance operation failed; durable work remains pending (%s).", name)


def run_cycle():
    close_old_connections()
    now = timezone.now()
    stats = {name: 0 for name in ("reconciled", "fulfilled", "expired", "refund_requested", "refunded", "receipts", "notices", "cart_cleanups", "errors")}
    due = PaymentTransaction.objects.filter(status__in=["PENDING", "UNKNOWN"], next_attempt_at__lte=now).filter(
        Q(lease_until__isnull=True) | Q(lease_until__lte=now))
    for pk in list(due.filter(operation="CAPTURE").values_list("pk", flat=True)[:100]):
        _run(lambda pk=pk: reconcile(pk), stats, "reconciled")
    for order in Order.objects.filter(paid_at__isnull=False, cart_cleanup_completed_at__isnull=True).order_by("paid_at", "pk")[:100]:
        _run(lambda order=order: _clear_paid_cart(order), stats, "cart_cleanups")
    # A process may stop after verified payment commit but before simulated dispense.
    for pk in list(Order.objects.filter(channel="TERMINAL", status="PENDING", paid_at__isnull=False).values_list("pk", flat=True)[:100]):
        _run(lambda pk=pk: fulfil_order(pk), stats, "fulfilled")
    try:
        stats["expired"] = len(expire_orders(now=now))
    except Exception:
        stats["errors"] += 1
        logger.error("Order expiry maintenance failed; it will be retried.")
    for order in Order.objects.filter(status="CANCELLED", paid_at__isnull=False, total_paid__gt=F("total_refunded")).exclude(
            payments__operation="REFUND")[:100]:
        _run(lambda order=order: request_refund(order), stats, "refund_requested")
    for pk in list(due.filter(operation="REFUND").values_list("pk", flat=True)[:100]):
        _run(lambda pk=pk: process_refund(pk), stats, "refunded")
    for pk in list(Receipt.objects.filter(email_sent_at__isnull=True).filter(
            Q(next_email_at__isnull=True) | Q(next_email_at__lte=now)).values_list("pk", flat=True)[:100]):
        _run(lambda pk=pk: deliver_receipt(pk), stats, "receipts")
    expiry_notices = Order.objects.filter(status="CANCELLED", cancellation_reason="COLLECTION_EXPIRED",
        paid_at__isnull=False, expiry_email_sent_at__isnull=True).filter(
        Q(expiry_email_next_attempt_at__isnull=True) | Q(expiry_email_next_attempt_at__lte=now)).filter(
        Q(expiry_email_lease_until__isnull=True) | Q(expiry_email_lease_until__lte=now))
    for pk in list(expiry_notices.values_list("pk", flat=True)[:100]):
        _run(lambda pk=pk: send_order_notice(pk, "expiry"), stats, "notices")
    refund_notices = Order.objects.filter(status="CANCELLED", total_paid__gt=0, total_refunded=F("total_paid"),
        refund_email_sent_at__isnull=True).filter(
        Q(refund_email_next_attempt_at__isnull=True) | Q(refund_email_next_attempt_at__lte=now)).filter(
        Q(refund_email_lease_until__isnull=True) | Q(refund_email_lease_until__lte=now))
    for pk in list(refund_notices.values_list("pk", flat=True)[:100]):
        _run(lambda pk=pk: send_order_notice(pk, "refund"), stats, "notices")
    return stats


def _clear_paid_cart(order):
    # CAS protects later browser changes/new visitors; no TTL is extended. A
    # crash between Redis and this marker only repeats that same harmless CAS.
    clear_purchased_cart(order)
    Order.objects.filter(pk=order.pk, cart_cleanup_completed_at__isnull=True).update(cart_cleanup_completed_at=timezone.now())
