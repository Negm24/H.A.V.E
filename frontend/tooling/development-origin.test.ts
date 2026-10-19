// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { forwardingHeaders, publicHost, requestOrigin } from './development-access'
import { trustedKioskRequest } from './kiosk-proxy'

vi.mock('node:fs', async original => { const fs = await original<typeof import('node:fs')>(); return { ...fs, readFileSync: vi.fn(fs.readFileSync) } })
const hub = 'laptop.example.ts.net', kiosk = hub + ':8443'
beforeEach(() => vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ hubPublicOrigin: `https://${hub}`, kioskPublicOrigin: `https://${kiosk}`, kioskAccessPassword: 'private-test-password' })))

it('only trusts the exact configured authority, port and HTTPS origin', () => {
  expect(publicHost(5173)).toBe(hub)
  expect(requestOrigin(kiosk, 5173)).toBe(`https://${kiosk}`)
  expect(trustedKioskRequest({ method: 'POST', headers: { host: kiosk, origin: `https://${kiosk}` } })).toBe(true)
  for (const origin of [`http://${kiosk}`, `https://${hub}`, 'https://evil.example', undefined]) {
    expect(trustedKioskRequest({ method: 'POST', headers: { host: kiosk, origin } })).toBe(false)
  }
  for (const host of [hub, 'other.example.ts.net:8443', kiosk + '.evil.example', hub + ':10000']) expect(requestOrigin(host, 5173)).toBeUndefined()
  expect(requestOrigin(kiosk, 5174)).toBeUndefined()
  expect(requestOrigin('localhost:5173', 5173)).toBe('http://localhost:5173')
  expect(requestOrigin('127.0.0.1:5173', 5173)).toBe('http://127.0.0.1:5173')
})
it('requires same-origin fetch metadata for GET without Origin', () => {
  expect(trustedKioskRequest({ method: 'GET', headers: { host: kiosk, 'sec-fetch-site': 'same-origin' } })).toBe(true)
  for (const site of ['cross-site', 'none', undefined]) expect(trustedKioskRequest({ method: 'GET', headers: { host: kiosk, 'sec-fetch-site': site } })).toBe(false)
})
it('strips spoofed forwarding headers and supplies HTTPS only for the exact app authority', () => {
  for (const host of [hub, 'localhost:5174', kiosk, 'evil.example']) {
    const headers = new Map(['x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-for', 'forwarded', 'x-have-forwarded-proto'].map(name => [name, 'spoofed']))
    forwardingHeaders({ removeHeader: name => { headers.delete(name.toLowerCase()) }, setHeader: (name, value) => { headers.set(name.toLowerCase(), value) } }, host, 5174)
    expect([...headers.entries()]).toEqual(host === hub ? [['x-have-forwarded-proto', 'https']] : [])
  }
})
