// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { createServer, type IncomingMessage, type ServerResponse, type IncomingHttpHeaders } from 'node:http'
import type { ViteDevServer } from 'vite'
import { kioskProxy, resolveTerminalCredentials, terminalMethod, trustedKioskRequest } from './kiosk-proxy'

vi.mock('node:fs', async original => { const fs = await original<typeof import('node:fs')>(); return { ...fs, readFileSync: vi.fn(fs.readFileSync) } })
beforeEach(() => vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ hubPublicOrigin: 'https://laptop.example.ts.net', kioskPublicOrigin: 'https://laptop.example.ts.net:8443', kioskAccessPassword: 'private-test-password' })))

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('only grants device authority to the exact supported Terminal routes', () => {
  expect(terminalMethod('/api/v1/terminals/sessions/')).toBe('POST')
  expect(terminalMethod('/api/v1/auth/customers/terminal/me/')).toBe('GET')
  expect(terminalMethod('/api/v1/auth/customers/terminal/qr-login/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/complete/')).toBe('POST')
  expect(terminalMethod('/api/v1/terminals/cart/comparison/')).toBeUndefined()
  expect(terminalMethod('/api/v1/terminals/cart/choice/')).toBeUndefined()
  expect(terminalMethod('/api/v1/terminals/orders/checkout/')).toBe('POST')
  expect(terminalMethod('/api/v1/terminals/cart/version/')).toBe('GET')
  expect(terminalMethod('/api/v1/terminals/orders/summary/')).toBe('GET')
  expect(terminalMethod('/api/v1/terminals/orders/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/resume/')).toBe('POST')
  expect(terminalMethod('/api/v1/hub/cart/version/')).toBeUndefined()
  expect(terminalMethod('/api/v1/payments/return/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/')).toBeUndefined()
  expect(terminalMethod('/api/v1/terminals/orders/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/result/')).toBe('GET')
  expect(terminalMethod('/api/v1/terminals/orders/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/result/end/')).toBe('POST')
  expect(terminalMethod('/api/v1/terminals/orders/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/result/continue/')).toBe('POST')
  expect(terminalMethod('/api/v1/terminals/orders/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/result/activity/')).toBe('POST')
  expect(terminalMethod('/api/v1/hub/cart/')).toBeUndefined()
  expect(terminalMethod('/api/v1/terminals/cart/choice/anything/')).toBeUndefined()
  for (const path of ['/api/v1/auth/owners/login/', '/api/v1/terminals/sessions/../other/', '/api/v1/auth/customers/terminal/anything/']) expect(terminalMethod(path)).toBeUndefined()
})
it('requires a trusted loopback host and same origin', () => {
  expect(trustedKioskRequest({ method: 'POST', headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } })).toBe(true)
  expect(trustedKioskRequest({ method: 'POST', headers: { host: 'localhost:5173', origin: 'https://evil.example' } })).toBe(false)
  expect(trustedKioskRequest({ method: 'POST', headers: { host: 'localhost:5173' } })).toBe(false)
  expect(trustedKioskRequest({ method: 'GET', headers: { host: 'localhost:5173', 'sec-fetch-site': 'same-origin' } })).toBe(true)
  expect(trustedKioskRequest({ method: 'GET', headers: { host: 'evil.example:5173', 'sec-fetch-site': 'same-origin' } })).toBe(false)
})

const firstId = 'a'.repeat(32), secondId = 'b'.repeat(32)
const simulatorConfig = {
  TERMINAL_HAVE_TEST_001_SERIAL: 'TEST-001', TERMINAL_HAVE_TEST_001_KEY: 'first-private-key', TERMINAL_HAVE_TEST_001_SIMULATOR_ID: firstId,
  TERMINAL_HAVE_TEST_002_SERIAL: 'TEST-002', TERMINAL_HAVE_TEST_002_KEY: 'second-private-key', TERMINAL_HAVE_TEST_002_SIMULATOR_ID: secondId,
}

it('selects only an exact unique configured simulator; rejects serials, missing and duplicate aliases', () => {
  expect(resolveTerminalCredentials(simulatorConfig, firstId)?.serial).toBe('TEST-001')
  expect(resolveTerminalCredentials(simulatorConfig, secondId)?.serial).toBe('TEST-002')
  for (const id of [undefined, '', 'TEST-001', 'c'.repeat(32)]) expect(resolveTerminalCredentials(simulatorConfig, id)).toBeUndefined()
  expect(resolveTerminalCredentials({ ...simulatorConfig, TERMINAL_HAVE_TEST_002_SIMULATOR_ID: firstId }, firstId)).toBeUndefined()
  expect(resolveTerminalCredentials({ ...simulatorConfig, TERMINAL_SERIAL: 'legacy', TERMINAL_KEY: 'legacy-key' })).toBeUndefined()
})

async function proxyResponse(contentType = 'application/json', configured = true, simulator?: string, publicRequest = false, paymentRead = false) {
  vi.stubEnv('TERMINAL_SERIAL', 'TEST-001')
  vi.stubEnv('TERMINAL_KEY', configured ? 'test-installation-secret' : '')
  const calls: IncomingHttpHeaders[] = []
  const upstream = createServer((req, res) => {
    calls.push(req.headers)
    res.setHeader('Content-Type', contentType)
    res.end(contentType === 'application/json' ? '{"session_token":"guest"}' : '<html>debug</html>')
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('No test server')
  vi.stubEnv('BACKEND_ORIGIN', `http://127.0.0.1:${address.port}`)
  let handler!: (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>
  const plugin = kioskProxy(simulator === undefined ? { TERMINAL_SERIAL: 'TEST-001', TERMINAL_KEY: configured ? 'test-installation-secret' : '' } : simulatorConfig)
  const hook = plugin.configureServer
  if (typeof hook === 'function') hook.call({} as never, { middlewares: { use: (fn: typeof handler) => { handler = fn } } } as unknown as ViteDevServer)
  const req = Readable.from([]) as IncomingMessage
  req.url = '/api/v1/terminals/sessions/'; req.method = 'POST'
  req.headers = { host: 'localhost:5173', origin: 'http://localhost:5173', cookie: 'sessionid=owner', 'x-terminal-key': 'spoof', 'x-terminal-serial': 'spoof' }
  if (publicRequest) {
    req.headers.host = 'laptop.example.ts.net:8443'
    req.headers.origin = 'https://laptop.example.ts.net:8443'
    req.headers['x-have-forwarded-proto'] = 'spoofed'
    req.headers['x-forwarded-proto'] = 'http'
  }
  if (paymentRead) {
    req.method = 'GET'
    req.url = '/api/v1/terminals/orders/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/result/'
    req.headers.cookie = 'sessionid=owner; have_hub_refresh=private-hub; __Host-have_kiosk_test=gate; have_payment_' + 'a'.repeat(32) + '=receipt'
  }
  if (simulator !== undefined) req.headers['x-terminal-simulator'] = simulator
  let body = '', status = 200
  const res = {
    statusCode: 200, setHeader: () => {}, writeHead: (value: number) => { status = value },
    end: (value: string | Buffer) => { body = String(value) },
  } as unknown as ServerResponse
  try { await handler(req, res, () => { throw new Error('Unexpected fallback') }) }
  finally {
    await new Promise<void>(resolve => upstream.close(() => resolve()))
  }
  return { calls, body, status: status === 200 ? res.statusCode : status }
}

it('injects the installation key, drops cookies/spoofed headers and never returns the key', async () => {
  const { calls, body } = await proxyResponse()
  const headers = calls[0]!
  expect(headers['x-terminal-key']).toBe('test-installation-secret')
  expect(headers['x-terminal-serial']).toBe('TEST-001')
  expect(headers.host).toBe('localhost:5173')
  expect(headers.cookie).toBeUndefined()
  expect(body).not.toContain('test-installation-secret')
})
it('missing configuration fails closed without forwarding a request', async () => {
  const { calls, status } = await proxyResponse('application/json', false)
  expect(status).toBe(503); expect(calls).toHaveLength(0)
})
it('does not relay debug HTML from Django', async () => {
  const { status, body } = await proxyResponse('text/html')
  expect(status).toBe(503); expect(body).not.toContain('<html>')
})

it('forwards only the trusted HTTPS marker for an exact public Kiosk request', async () => {
  const { calls, body } = await proxyResponse('application/json', true, firstId, true)
  expect(calls[0]?.['x-have-forwarded-proto']).toBe('https')
  expect(calls[0]?.['x-forwarded-proto']).toBeUndefined()
  expect(calls[0]?.host).toBe('laptop.example.ts.net:8443')
  expect(calls[0]?.['x-terminal-key']).toBe('first-private-key')
  expect(calls[0]?.cookie).toBeUndefined()
  expect(body).not.toContain('first-private-key')
})

it('does not forward Hub, owner or gate cookies shared by hostname across HTTPS ports', async () => {
  const { calls } = await proxyResponse('application/json', true, firstId, true, true)
  expect(calls[0]?.cookie).toBe('have_payment_' + 'a'.repeat(32) + '=receipt')
})

it('routes two simulator selectors to different server-held credentials without leaking the selector upstream', async () => {
  for (const [id, serial, key] of [[firstId, 'TEST-001', 'first-private-key'], [secondId, 'TEST-002', 'second-private-key']]) {
    const { calls, body } = await proxyResponse('application/json', true, id)
    expect(calls[0]?.['x-terminal-serial']).toBe(serial)
    expect(calls[0]?.['x-terminal-key']).toBe(key)
    expect(calls[0]?.['x-terminal-simulator']).toBeUndefined()
    expect(body).not.toContain(key!)
  }
  const unknown = await proxyResponse('application/json', true, 'c'.repeat(32))
  expect(unknown.status).toBe(503)
  expect(unknown.calls).toHaveLength(0)
})
