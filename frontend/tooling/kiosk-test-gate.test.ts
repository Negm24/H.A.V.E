// @vitest-environment node
import { expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createKioskTestGate, safeReturnPath } from './kiosk-test-gate'

const host = 'kiosk-test.trycloudflare.com', password = 'test-access-only-not-a-real-password'
function fixture(secret = password) {
  let clock = 1_790_000_000_000
  const gate = createKioskTestGate({ host, password: secret, now: () => clock })
  async function request({ method = 'GET', path = '/', cookie = '', origin = `https://${host}`, body = '', headers = {} as Record<string, string> } = {}) {
    const req = Readable.from(body ? [Buffer.from(body)] : []) as IncomingMessage
    req.url = path; req.method = method
    req.headers = { host, origin, cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers }
    let status = 200, content = '', continued = false
    const responseHeaders: Record<string, string> = {}
    const res = {
      writeHead: (value: number, values: Record<string, string> = {}) => { status = value; Object.assign(responseHeaders, values) },
      setHeader: (name: string, value: string) => { responseHeaders[name] = value },
      end: (value = '') => { content = value },
    } as unknown as ServerResponse
    await gate.middleware(req, res, () => { continued = true })
    return { status, content, continued, headers: responseHeaders, req }
  }
  const unlock = (secret = password, returnTo = '/?terminal=' + 'a'.repeat(32)) => request({ method: 'POST', path: '/_test-access/unlock', body: new URLSearchParams({ password: secret, return_to: returnTo }).toString() })
  return { gate, request, unlock, advance: (ms: number) => { clock += ms } }
}

it('protects documents, modules, API routes and WebSocket upgrades before device authority', async () => {
  const f = fixture()
  const page = await f.request({ headers: { accept: 'text/html' } })
  expect(page.status).toBe(200); expect(page.content).toContain('Unlock test Kiosk'); expect(page.content).not.toContain(password)
  expect(page.headers['Referrer-Policy']).toBe('same-origin')
  for (const path of ['/src/main.tsx', '/@vite/client', '/@fs/workspace/shared/src/api/http.ts', '/api/v1/terminals/sessions/']) {
    const response = await f.request({ path })
    expect(response.status).toBe(401); expect(response.continued).toBe(false)
    expect(response.headers.Location).toBeUndefined()
    expect(f.gate.upgradeAllowed(response.req)).toBe(false)
  }
})

it('issues a secure host-only cookie and preserves the simulator/payment return path', async () => {
  const f = fixture(), path = '/payment-return?order_id=123&terminal=' + 'a'.repeat(32)
  const unlocked = await f.unlock(password, path)
  expect(unlocked.status).toBe(303); expect(unlocked.headers.Location).toBe(path)
  const setCookie = unlocked.headers['Set-Cookie']!
  expect(setCookie).toContain('__Host-have_kiosk_test='); expect(setCookie).toContain('Secure; HttpOnly; SameSite=Lax')
  expect(setCookie).toContain('Path=/;'); expect(setCookie).not.toContain('Domain='); expect(setCookie).not.toContain(password)
  const cookie = setCookie.split(';')[0]!
  for (const path of ['/', '/src/main.tsx', '/node_modules/.vite/deps/react.js', '/api/v1/terminals/sessions/']) {
    const response = await f.request({ path, cookie })
    expect(response.continued).toBe(true)
  }
  const upgrade = await f.request({ cookie })
  expect(f.gate.upgradeAllowed(upgrade.req)).toBe(true)
  upgrade.req.headers.origin = 'https://evil.example'
  expect(f.gate.upgradeAllowed(upgrade.req)).toBe(false)
  f.advance(10_000)
  expect((await f.request({ path: '/src/main.tsx', cookie })).continued).toBe(true)
  f.advance(4 * 60 * 60 * 1000)
  expect((await f.request({ cookie })).status).toBe(401)
})

it('rejects wrong passwords, cross-origin unlocks, malformed cookies and restarts', async () => {
  const f = fixture()
  expect((await f.unlock('wrong')).status).toBe(401)
  const foreign = await f.request({ method: 'POST', path: '/_test-access/unlock', origin: 'https://evil.example', body: new URLSearchParams({ password }).toString() })
  expect(foreign.status).toBe(403)
  const unlocked = await f.unlock(), cookie = unlocked.headers['Set-Cookie']!.split(';')[0]!
  expect((await fixture().request({ cookie })).status).toBe(401)
  expect((await f.request({ cookie: cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a') })).status).toBe(401)
  expect((await f.request({ cookie: '__Host-have_kiosk_test=garbage' })).status).toBe(401)
  expect((await f.request({ headers: { host: 'evil.example' } })).status).toBe(403)
})

it('fails closed without a strong server password, while localhost remains unchanged', async () => {
  const f = fixture('')
  expect((await f.request()).status).toBe(503)
  expect((await f.request({ headers: { host: 'localhost:5173' } })).continued).toBe(true)
  expect((await f.request({ headers: { host: '127.0.0.1:5173' } })).continued).toBe(true)
})

it('limits password guessing, rejects oversized forms and disallows open redirects', async () => {
  const f = fixture()
  for (let i = 0; i < 10; i++) expect((await f.unlock('wrong')).status).toBe(401)
  const limited = await f.unlock()
  expect(limited.status).toBe(429); expect(limited.headers['Retry-After']).toBe('60')
  f.advance(60_000)
  expect((await f.unlock()).status).toBe(303)
  expect((await f.request({ method: 'POST', path: '/_test-access/unlock', body: 'password=' + 'x'.repeat(4096) })).status).toBe(413)
  for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/\r\nLocation:evil']) expect(safeReturnPath(value)).toBe('/')
  expect((await f.unlock(password, '//evil.example')).headers.Location).toBe('/')
})
