import { describe, expect, it } from 'vitest'
import type { PurchaseOrder } from '@have/shared/api/purchase'
import { canResumeCheckout, checkoutSecondsRemaining, orderStatusLabel, requiresCollection, unfinishedCheckout } from '../services/payment-status'

const now = Date.parse('2026-10-18T12:00:00Z')
const pending = { status: 'PENDING', paid_at: null, channel: 'HUB', can_resume: true, payment_state: 'AWAITING_PAYMENT', expires_at: '2026-10-18T12:15:00Z', collection_required: true } as PurchaseOrder

describe('Hub recoverable checkout presentation', () => {
  it('shows a fixed deadline and refuses resumption at or after it', () => {
    expect(checkoutSecondsRemaining(pending.expires_at, now)).toBe(900)
    expect(checkoutSecondsRemaining(pending.expires_at, now + 60_000)).toBe(840)
    expect(canResumeCheckout(pending, now)).toBe(true)
    expect(canResumeCheckout(pending, now + 900_000)).toBe(false)
    expect(canResumeCheckout(pending, now + 901_000)).toBe(false)
  })
  it('never offers payment again for paid, ambiguous or non-resumable attempts', () => {
    expect(canResumeCheckout({ ...pending, paid_at: '2026-10-18T12:01:00Z', payment_state: 'PAID' }, now)).toBe(false)
    expect(canResumeCheckout({ ...pending, payment_state: 'CHECKING_PAYMENT' }, now)).toBe(false)
    expect(canResumeCheckout({ ...pending, can_resume: false }, now)).toBe(false)
    expect(canResumeCheckout({ ...pending, expires_at: '' }, now)).toBe(false)
  })
  it('separates unpaid checkout from collection and uses fulfilment, not channel', () => {
    expect(unfinishedCheckout(pending)).toBe(true)
    expect(orderStatusLabel(pending)).toBe('paymentStates.AWAITING_PAYMENT')
    expect(unfinishedCheckout({ ...pending, paid_at: '2026-10-18T12:01:00Z' })).toBe(false)
    expect(requiresCollection({ ...pending, channel: 'TERMINAL', collection_required: true })).toBe(true)
    expect(requiresCollection({ ...pending, channel: 'TERMINAL', collection_required: false })).toBe(false)
  })
  it('does not invent a valid deadline for malformed input', () => {
    expect(checkoutSecondsRemaining('not-a-date', now)).toBe(0)
  })
})
