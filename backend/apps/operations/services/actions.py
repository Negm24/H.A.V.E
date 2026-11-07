"""Owner commands: idempotent submission and bounded, non-replayed financial work."""
from datetime import timedelta
from hashlib import sha256
import json
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import RefreshToken, User
from apps.accounts.security.errors import AuthError
from apps.orders.models import Order, Receipt
from apps.orders.services.receipt_services import deliver_receipt
from apps.payments.models import PaymentTransaction
from apps.payments.services.payment_services import cancel_purchase, reconcile, process_refund
from apps.operations.models import OwnerAction
from apps.operations.audit import record_activity
from .common import require_owner, reason_text


def action_data(row):
    return {field: getattr(row, field) for field in (
        "id", "status", "result", "error", "action", "target_type", "target_id", "reason", "created_at", "updated_at")}


def _action(*, actor, target_type, target_id, action, action_id, reason=""):
    require_owner(actor)
    try:
        action_id = UUID(str(action_id))
    except (TypeError, ValueError):
        raise AuthError("A valid action_id UUID is required.", 400) from None
    fingerprint = sha256(json.dumps([str(actor.pk), target_type, str(target_id), action, reason]).encode()).hexdigest()
    row, created = OwnerAction.objects.get_or_create(pk=action_id, defaults={
        "actor": actor, "target_type": target_type, "target_id": str(target_id), "action": action,
        "fingerprint": fingerprint, "reason": reason})
    if row.fingerprint != fingerprint:
        raise AuthError("This action ID belongs to a different operation.", 409)
    return row, created


@transaction.atomic
def account_action(*, actor, account_id, action, reason, action_id):
    require_owner(actor)
    if action not in {"block", "unblock", "sign-out"}:
        raise AuthError("Unknown account action.", 400)
    reason = reason_text(reason)
    user = User.objects.select_for_update().filter(pk=account_id, account_type__in=["CUSTOMER", "DOCTOR"]).first()
    if not user:
        raise AuthError("Account not found.", 404)
    if user.account_type == "DOCTOR" and user.doctor.approval_status != "APPROVED":
        raise AuthError("Only approved doctor access can be blocked or restored. Review pending applications separately.", 409)
    row, created = _action(actor=actor, target_type="account", target_id=user.pk,
                          action=action, action_id=action_id, reason=reason)
    if not created:
        return row
    profile = type(user.credential_profile).objects.select_for_update().get(pk=user.pk)
    if action != "unblock":
        # This field is the existing authentication generation, also checked by
        # Terminal sessions and QR proofs. No password/PIN/MFA secret is changed.
        profile.credential_changed_at = max(timezone.now(), profile.credential_changed_at + timedelta(microseconds=1))
        profile.save(update_fields=["credential_changed_at"])
        RefreshToken.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())
    if action != "sign-out":
        user.is_disabled = action == "block"
        user.save(update_fields=["is_disabled"])
    row.status = "SUCCEEDED"
    row.result = {"account_id": user.pk, "is_disabled": user.is_disabled}
    row.save(update_fields=["status", "result", "updated_at"])
    record_activity(actor=actor, action="ACCOUNT_" + action.upper().replace("-", "_"), target_type="account",
                    target_id=user.pk, metadata={"is_disabled": user.is_disabled})
    return row


@transaction.atomic
def submit_order_action(*, actor, order_id, action, action_id):
    require_owner(actor)
    if action not in {"cancel", "reconcile", "retry-receipt"}:
        raise AuthError("Unknown order action.", 400)
    order = Order.objects.select_for_update().filter(pk=order_id).first()
    if order is None:
        raise AuthError("Order not found.", 404)
    row = OwnerAction.objects.filter(pk=action_id).first()
    if row:
        return _action(actor=actor, target_type="order", target_id=order_id, action=action, action_id=action_id)[0]
    if action == "cancel" and order.status == "COMPLETED":
        raise AuthError("Completed orders cannot be cancelled.", 409)
    if action == "retry-receipt" and not Receipt.objects.filter(order=order).exists():
        raise AuthError("This order has no receipt to deliver.", 409)
    if action == "reconcile" and not order.payments.filter(operation="CAPTURE").exists():
        raise AuthError("This order has no payment attempt to reconcile.", 409)
    row, _ = _action(actor=actor, target_type="order", target_id=order_id, action=action, action_id=action_id)
    record_activity(actor=actor, action="ORDER_" + action.upper().replace("-", "_"), target_type="order",
                    target_id=order_id, outcome="QUEUED", metadata={"job_id": str(row.pk)})
    return row


def run_pending_actions(limit=20):
    """Persist claims before external effects. A stale claim becomes UNKNOWN,
    never blindly replayed after a crash. Existing payment/SMTP leases still apply.
    """
    cutoff = timezone.now() - timedelta(minutes=5)
    OwnerAction.objects.filter(status="RUNNING", started_at__lt=cutoff).update(
        status="UNKNOWN", updated_at=timezone.now(),
        error="The operation was interrupted. Check the authoritative order status before requesting recovery.")
    processed = 0
    for pk in list(OwnerAction.objects.filter(status="QUEUED", target_type="order").order_by("created_at").values_list("pk", flat=True)[:limit]):
        from apps.observability.worker_state import check_stop
        check_stop()
        with transaction.atomic():
            job = OwnerAction.objects.select_for_update().select_related("actor").get(pk=pk)
            if job.status != "QUEUED":
                continue
            job.status, job.started_at = "RUNNING", timezone.now()
            job.save(update_fields=["status", "started_at", "updated_at"])
        try:
            require_owner(job.actor)
            order = Order.objects.get(pk=job.target_id)
            if job.action == "cancel":
                order = cancel_purchase(order, reason="OWNER_CANCELLED")
            elif job.action == "reconcile":
                capture = order.payments.filter(operation="CAPTURE").first()
                reconcile(capture.pk, force=True)
                refund = order.payments.filter(operation="REFUND").first()
                if refund:
                    # Reopen for read-only status reconciliation, preserving the
                    # attempt count which forbids another refund submission.
                    PaymentTransaction.objects.filter(pk=refund.pk, status="FAILED").update(status="UNKNOWN")
                    process_refund(refund.pk)
            else:
                receipt = Receipt.objects.get(order=order)
                if not deliver_receipt(receipt.pk):
                    raise AuthError("Receipt delivery is pending or already in progress. Its durable retry remains scheduled.", 409)
            order.refresh_from_db()
            capture_status = order.payments.filter(operation="CAPTURE").values_list("status", flat=True).first()
            refund_status = order.payments.filter(operation="REFUND").values_list("status", flat=True).first()
            job.status = "SUCCEEDED"
            job.result = {"order_id": str(order.pk), "order_status": order.status,
                          "paid_at": order.paid_at.isoformat() if order.paid_at else None,
                          "total_paid": format(order.total_paid, ".2f"), "total_refunded": format(order.total_refunded, ".2f"),
                          "payment_status": capture_status, "refund_status": refund_status}
            if (job.action == "cancel" and order.status != "CANCELLED") or (
                    job.action == "reconcile" and (capture_status not in {"SUCCEEDED", "FAILED"}
                    or refund_status is not None and refund_status not in {"SUCCEEDED", "FAILED"})):
                job.status = "UNKNOWN"
                job.error = "The financial outcome is still pending. Check the order before requesting recovery."
        except AuthError as exc:
            job.status = "UNKNOWN" if exc.status >= 500 or "pending" in exc.detail.lower() else "FAILED"
            job.error = str(exc.detail)[:300]
        except Exception:
            job.status = "UNKNOWN"
            job.error = "The outcome could not be confirmed. Check the order; do not repeat a financial request blindly."
        job.save(update_fields=["status", "result", "error", "updated_at"])
        record_activity(actor=job.actor, action="ORDER_ACTION_RESULT", target_type="order", target_id=job.target_id,
                        outcome=job.status, metadata={"job_id": str(job.pk), "action": job.action})
        processed += 1
    return processed
