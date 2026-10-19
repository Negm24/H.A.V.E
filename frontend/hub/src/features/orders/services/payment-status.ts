import type { PurchaseOrder } from '@have/shared/api/purchase'

export function orderPaymentState(order: PurchaseOrder) {
  if (order.payment_state) return order.payment_state
  // Older checkout returns remain readable while clients/schema roll forward.
  if (order.paid_at) return 'PAID'
  if (order.status === 'REVIEW_REQUIRED') return 'CHECKING_PAYMENT'
  if (order.status === 'CANCELLED') return 'EXPIRED'
  return 'AWAITING_PAYMENT'
}

export function unfinishedCheckout(order: PurchaseOrder) {
  return !order.paid_at && ['PENDING', 'REVIEW_REQUIRED'].includes(order.status)
}

export function checkoutSecondsRemaining(expiresAt: string | null, now: number) {
  if (!expiresAt) return 0
  const expires = Date.parse(expiresAt)
  return Number.isFinite(expires) ? Math.max(0, Math.ceil((expires - now) / 1_000)) : 0
}

export function canResumeCheckout(order: PurchaseOrder, now: number) {
  return order.can_resume === true && unfinishedCheckout(order) && orderPaymentState(order) === 'AWAITING_PAYMENT' && checkoutSecondsRemaining(order.expires_at, now) > 0
}

export function requiresCollection(order: PurchaseOrder) {
  return order.collection_required ?? order.channel === 'HUB'
}

export function orderStatusLabel(order: PurchaseOrder) {
  if (unfinishedCheckout(order)) return `paymentStates.${orderPaymentState(order)}`
  if (order.status === 'PENDING' && order.paid_at && requiresCollection(order)) return 'awaitingCollection'
  return order.cancellation_reason === 'COLLECTION_EXPIRED' ? 'expired' : `statuses.${order.status}`
}
