import { afterEach, expect, it, vi } from 'vitest'
import { customerApi } from './customer'
afterEach(() => vi.unstubAllGlobals())

it('uses the existing signup contract and no automatic CSRF/auth or retries', async () => {
  const fetch = vi.fn(async (_path: string, _options: RequestInit) => new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  await customerApi.signup({ first_name: 'Ahmed', last_name: 'Sherif', phone_number: '1203218887', email: 'a@example.test', date_of_birth: '24-01-2005', pin: '0482' })
  await customerApi.verifySignup({ phone_number: '1203218887', challenge_id: 'id', code: '012345' })
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/v1/auth/customers/signup/', '/api/v1/auth/customers/signup/verify/'])
  expect(JSON.parse(fetch.mock.calls[1][1].body as string).code).toBe('012345')
})
it('obtains CSRF for Hub cookie and anonymous recovery mutations', async () => {
  const fetch = vi.fn(async (path: string, _options: RequestInit) => new Response(JSON.stringify(path.endsWith('/csrf/') ? { csrf_token: 'csrf' } : {})))
  vi.stubGlobal('fetch', fetch)
  await customerApi.login({ phone_number: '01012345678', pin: '4826', remember_me: false })
  await customerApi.refresh(); await customerApi.logout(); await customerApi.requestReset('01012345678')
  await customerApi.verifyReset({ phone_number: '01012345678', challenge_id: 'id', code: '012345' })
  await customerApi.completeReset({ reset_token: 'proof', new_pin: '4826', confirm_pin: '4826' })
  expect(fetch).toHaveBeenCalledTimes(12)
  for (let i = 1; i < 12; i += 2) expect((fetch.mock.calls[i][1] as RequestInit).headers).toBeInstanceOf(Headers)
})
it('uses customer bearer authorization, not device or owner credentials, for QR operations', async () => {
  const fetch = vi.fn(async (_path: string, _options: { headers: Headers }) => new Response('{}')); vi.stubGlobal('fetch', fetch)
  await customerApi.me('access'); await customerApi.scanQr('access', 'payload'); await customerApi.qrStatus('access', 'id'); await customerApi.confirmQr('access', 'id', false)
  expect(fetch).toHaveBeenCalledTimes(4)
  for (const [, options] of fetch.mock.calls) {
    expect(options.headers.get('Authorization')).toBe('Bearer access')
    expect(options.headers.has('X-Terminal-Key')).toBe(false)
    expect(options.headers.has('X-CSRFToken')).toBe(false)
  }
})
