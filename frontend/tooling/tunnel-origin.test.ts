// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { forwardingHeaders, publicHost, requestOrigin } from './tunnel-origin'
import { trustedKioskRequest } from './kiosk-proxy'

afterEach(() => vi.unstubAllEnvs())

it('only trusts the exact configured HTTPS Kiosk host and matching origin', () => {
  vi.stubEnv('KIOSK_PUBLIC_HOST', 'test-kiosk.trycloudflare.com')
  expect(requestOrigin('test-kiosk.trycloudflare.com', 5173)).toBe('https://test-kiosk.trycloudflare.com')
  expect(trustedKioskRequest({ method: 'POST', headers: { host: 'test-kiosk.trycloudflare.com', origin: 'https://test-kiosk.trycloudflare.com' } })).toBe(true)
  for (const origin of ['http://test-kiosk.trycloudflare.com', 'https://evil.example', undefined]) {
    expect(trustedKioskRequest({ method: 'POST', headers: { host: 'test-kiosk.trycloudflare.com', origin } })).toBe(false)
  }
  for (const host of ['other.trycloudflare.com', 'test-kiosk.trycloudflare.com.evil.example', 'test-kiosk.trycloudflare.com:5173']) expect(requestOrigin(host, 5173)).toBeUndefined()
  expect(requestOrigin('localhost:5173', 5173)).toBe('http://localhost:5173')
  expect(requestOrigin('127.0.0.1:5173', 5173)).toBe('http://127.0.0.1:5173')
  expect(requestOrigin('test-kiosk.trycloudflare.com', 5174)).toBeUndefined()
})

it('requires same-origin fetch metadata for GET without Origin', () => {
  vi.stubEnv('KIOSK_PUBLIC_HOST', 'test-kiosk.trycloudflare.com')
  const headers = { host: 'test-kiosk.trycloudflare.com' }
  expect(trustedKioskRequest({ method: 'GET', headers: { ...headers, 'sec-fetch-site': 'same-origin' } })).toBe(true)
  for (const site of ['cross-site', 'none', undefined]) expect(trustedKioskRequest({ method: 'GET', headers: { ...headers, 'sec-fetch-site': site } })).toBe(false)
})

it('rejects wildcard, URL, port and suffix configuration rather than broadening trust', () => {
  for (const host of ['*.trycloudflare.com', 'https://test.trycloudflare.com', 'test.trycloudflare.com/path', 'test.trycloudflare.com:443', 'test.trycloudflare.com.evil.example']) {
    vi.stubEnv('HUB_PUBLIC_HOST', host)
    expect(() => publicHost(5174)).toThrow()
  }
})

it('strips spoofed forwarding headers and supplies HTTPS only for the exact public host', () => {
  vi.stubEnv('HUB_PUBLIC_HOST', 'test-hub.trycloudflare.com')
  for (const host of ['test-hub.trycloudflare.com', 'localhost:5174', 'evil.example']) {
    const headers = new Map(['x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-for', 'forwarded', 'x-have-forwarded-proto'].map(name => [name, 'spoofed']))
    forwardingHeaders({ removeHeader: name => { headers.delete(name.toLowerCase()) }, setHeader: (name, value) => { headers.set(name.toLowerCase(), value) } }, host, 5174)
    expect([...headers.entries()]).toEqual(host === 'test-hub.trycloudflare.com' ? [['x-have-forwarded-proto', 'https']] : [])
  }
})
