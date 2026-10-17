import { describe, expect, it } from 'vitest'
import { isHostedCheckoutUrl } from '@have/shared/api/purchase'

describe('Hub hosted checkout boundary', () => {
  it('accepts only an HTTPS Kashier test session', () => {
    expect(isHostedCheckoutUrl('https://payments.kashier.io/session/test-session?mode=test')).toBe(true)
  })
  it.each([
    'http://payments.kashier.io/session/example?mode=test',
    'https://payments.kashier.io/session/example?mode=live',
    'https://payments.kashier.io/session/example?mode=test&mode=live',
    'https://payments.kashier.io/session/example?mode=test#untrusted',
    'https://payments.kashier.io/session/example',
    'https://payments.kashier.io.evil.example/session/example?mode=test',
    'https://evil.example/session/example?mode=test',
    'https://payments.kashier.io@evil.example/session/example?mode=test',
    'https://user:password@payments.kashier.io/session/example?mode=test',
    'https://payments.kashier.io:444/session/example?mode=test',
    'https://payments.kashier.io/other/example?mode=test',
    'javascript:alert(1)',
    '/orders/example?payment=return',
  ])('rejects an untrusted or live destination: %s', value => {
    expect(isHostedCheckoutUrl(value)).toBe(false)
  })
})
