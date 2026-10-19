import { describe, expect, it } from 'vitest'
import type { PurchaseOrder } from '@have/shared/api/purchase'
import { canResumeCheckout, checkoutSecondsRemaining, isUnfinishedCheckout, requiresCollection } from '../services/order-presentation'

const now = Date.parse('2026-10-18T10:00:00Z')
const order = (values: object = {}) => ({ status: 'PENDING', channel: 'TERMINAL', paid_at: null, expires_at: '2026-10-18T10:15:00Z', payment_state: 'AWAITING_PAYMENT', can_resume: true, collection_required: false, ...values }) as PurchaseOrder

describe('Terminal purchase presentation', () => {
  it('uses fulfilment eligibility, not original purchase channel', () => {
    expect(requiresCollection(order({ collection_required: true }))).toBe(true)
    expect(requiresCollection(order({ channel: 'HUB', collection_required: false }))).toBe(false)
  })
  it('keeps unpaid checkout distinct from paid orders and terminal failures', () => {
    expect(isUnfinishedCheckout(order())).toBe(true)
    expect(isUnfinishedCheckout(order({ status: 'REVIEW_REQUIRED', payment_state: 'CHECKING_PAYMENT' }))).toBe(true)
    expect(isUnfinishedCheckout(order({ paid_at: '2026-10-18T09:59:00Z', payment_state: 'PAID' }))).toBe(false)
    expect(isUnfinishedCheckout(order({ status: 'CANCELLED', payment_state: 'EXPIRED' }))).toBe(false)
  })
  it('honours both the fixed deadline and server-owned resumption eligibility', () => {
    expect(checkoutSecondsRemaining(order(), now)).toBe(900)
    expect(canResumeCheckout(order(), now)).toBe(true)
    expect(canResumeCheckout(order(), now + 900_000)).toBe(false)
    expect(canResumeCheckout(order({ can_resume: false }), now)).toBe(false)
    expect(canResumeCheckout(order({ expires_at: null }), now)).toBe(false)
    expect(canResumeCheckout(order({ paid_at: '2026-10-18T09:59:00Z' }), now)).toBe(false)
  })
})
