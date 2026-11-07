import { afterEach, expect, it, vi } from 'vitest'
import { startTelemetry, telemetryRoute } from './telemetry'

afterEach(() => vi.unstubAllGlobals())

it('reduces record paths and search queries to a fixed route label', () => {
  expect(telemetryRoute('/orders/private-order-id?phone=01012345678')).toBe('orders')
  expect(telemetryRoute('/browse/search?q=sensitive-symptom')).toBe('catalogue')
  expect(telemetryRoute('/a-customer-name')).toBe('other')
})

it('uploads only anonymous allowlisted events without credentials or entered text', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }))
  vi.stubGlobal('fetch', fetch)
  const client = startTelemetry('hub', { release: 'not-persisted' })
  client.feature('qr_login')
  const input = document.createElement('input'); input.value = 'PIN 4826 and personal search'
  document.body.append(input); input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await client.flush(); client.stop(); input.remove()
  const [path, options] = fetch.mock.calls[0]
  expect(path).toBe('/api/v1/telemetry/events/')
  expect(options.credentials).toBe('omit')
  const body = JSON.parse(options.body)
  expect(Object.keys(body)).toEqual(['app', 'events'])
  expect(body.events.some((event: { metric: string }) => event.metric === 'feature.qr_login')).toBe(true)
  expect(options.body).not.toContain('4826')
  expect(options.body).not.toContain('not-persisted')
})

it('metrics failure never breaks the app or replays a request', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('Offline'))
  vi.stubGlobal('fetch', fetch)
  const client = startTelemetry('kiosk')
  await expect(client.flush()).resolves.toBeUndefined()
  expect(fetch).toHaveBeenCalledTimes(1)
  await client.flush()
  expect(fetch).toHaveBeenCalledTimes(1)
  client.stop()
})

it('ignores unknown feature names and drops buffers after stopping', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  const client = startTelemetry('admin')
  client.feature('typed-secret' as 'browse'); client.stop(); await client.flush()
  expect(fetch).not.toHaveBeenCalled()
})

it('measures screen readiness only against its matching mount, without user dwell time', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  const client = startTelemetry('hub')
  vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200).mockReturnValueOnce(225)
  client.screenReady('/orders/private-id')
  const old = client.beginScreen('/orders/old')
  const latest = client.beginScreen('/orders/new')
  client.screenReady('/orders/old', old)
  client.screenReady('/orders/new', latest)
  client.screenReady('/orders/new', latest)
  await client.flush(); client.stop()
  const events = JSON.parse(fetch.mock.calls[0][1].body).events
  expect(events.filter((event: { metric: string }) => event.metric === 'screen_load_ms')).toEqual([{ metric: 'screen_load_ms', route: 'orders', value: 25 }])
})

it('excludes routine polls and preserves actual journey errors without their payloads', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }))
  vi.stubGlobal('fetch', fetch)
  const client = startTelemetry('hub')
  for (const path of ['/terminals/availability/', '/terminals/heartbeat/', '/hub/cart/version/', '/auth/customers/hub/me/', '/owner/session/', '/auth/customers/terminal/qr-login/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/']) {
    await window.fetch('/api/v1' + path)
  }
  await window.fetch('/api/v1/hub/orders/private-order-id/?phone=01012345678', { method: 'POST', body: 'private payment payload' })
  await client.flush(); client.stop()
  const body = fetch.mock.calls.at(-1)?.[1]?.body
  const events = JSON.parse(body).events
  expect(events.filter((event: { metric: string }) => event.metric === 'client_request_ms')).toHaveLength(1)
  expect(events.filter((event: { metric: string }) => event.metric === 'api_error')).toEqual([{ metric: 'api_error', route: 'orders', value: 1 }])
  expect(body).not.toContain('01012345678')
  expect(body).not.toContain('private')
})

it('counts only recognized timeouts separately from network failures and cancellations', async () => {
  const fetch = vi.fn().mockRejectedValue(new DOMException('internal detail', 'TimeoutError'))
  vi.stubGlobal('fetch', fetch)
  const client = startTelemetry('hub')
  await expect(window.fetch('/api/v1/hub/orders/checkout/')).rejects.toBeInstanceOf(DOMException)
  fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
  const signal = AbortSignal.abort(new DOMException('deadline', 'TimeoutError'))
  await expect(window.fetch('/api/v1/hub/orders/checkout/', { signal })).rejects.toBeInstanceOf(TypeError)
  fetch.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
  await expect(window.fetch('/api/v1/hub/orders/checkout/')).rejects.toBeInstanceOf(DOMException)
  fetch.mockRejectedValueOnce(new TypeError('offline'))
  await expect(window.fetch('/api/v1/hub/orders/checkout/')).rejects.toBeInstanceOf(TypeError)
  fetch.mockResolvedValueOnce(new Response('{}'))
  await client.flush(); client.stop()
  const events = JSON.parse(fetch.mock.calls.at(-1)?.[1]?.body).events
  expect(events.filter((event: { metric: string }) => event.metric === 'client_timeout')).toHaveLength(2)
  expect(events.filter((event: { metric: string }) => event.metric === 'api_error')).toHaveLength(1)
  expect(events.filter((event: { metric: string }) => event.metric === 'client_request_ms')).toHaveLength(3)
})

it('omits marked background reads and CSRF plumbing while retaining explicit reads and every mutation', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }))
  vi.stubGlobal('fetch', fetch)
  const client = startTelemetry('hub')
  const paths = ['/hub/catalogue/products/', '/hub/cart/', '/hub/orders/', '/hub/orders/terminals/']
  for (const path of paths) await window.fetch('/api/v1' + path, { headers: { 'X-Have-Background': '1' } })
  await window.fetch(new Request(location.origin + '/api/v1/hub/orders/', { headers: { 'X-Have-Background': '1' } }))
  await window.fetch('/api/v1/auth/csrf/')
  fetch.mockRejectedValueOnce(new DOMException('deadline', 'TimeoutError'))
  await expect(window.fetch('/api/v1/hub/cart/', { headers: { 'X-Have-Background': '1' } })).rejects.toBeInstanceOf(DOMException)
  await window.fetch('/api/v1/hub/orders/')
  await window.fetch('/api/v1/hub/orders/', { headers: { 'X-Have-Background': '2' } })
  await window.fetch('/api/v1/hub/orders/checkout/', { method: 'POST', headers: { 'X-Have-Background': '1' } })
  await client.flush(); client.stop()
  const events = JSON.parse(fetch.mock.calls.at(-1)?.[1]?.body).events
  expect(events.filter((event: { metric: string }) => event.metric === 'client_request_ms')).toHaveLength(3)
  expect(events.filter((event: { metric: string }) => event.metric === 'api_error')).toHaveLength(3)
  expect(events.filter((event: { metric: string }) => event.metric === 'client_timeout')).toHaveLength(0)
})
