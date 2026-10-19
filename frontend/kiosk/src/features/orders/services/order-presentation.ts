import type { PurchaseOrder } from '@have/shared/api/purchase'

export function requiresCollection(order: PurchaseOrder): boolean {
  // Older, already-issued order responses may predate the explicit field.
  return order.collection_required ?? order.channel === 'HUB'
}

export function isUnfinishedCheckout(order: PurchaseOrder): boolean {
  return !order.paid_at && ['PENDING', 'REVIEW_REQUIRED'].includes(order.status)
    && (!order.payment_state || ['AWAITING_PAYMENT', 'CHECKING_PAYMENT'].includes(order.payment_state))
}

export function checkoutSecondsRemaining(order: PurchaseOrder, now = Date.now()): number {
  const deadline = Date.parse(order.expires_at ?? '')
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1_000)) : 0
}

export function canResumeCheckout(order: PurchaseOrder, now = Date.now()): boolean {
  return isUnfinishedCheckout(order) && order.can_resume === true && checkoutSecondsRemaining(order, now) > 0
}
