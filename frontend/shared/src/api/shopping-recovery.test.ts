import { afterEach, expect, it, vi } from 'vitest'
import { hubCartApi } from './cart'
import { configureTerminalSimulator, terminalCartApi } from './terminal'
import { hubPurchaseApi, terminalPurchaseApi } from './purchase'
import { request } from './http'

afterEach(() => { configureTerminalSimulator(undefined); vi.unstubAllGlobals() })

it('retains purchase-specific recovery codes without replaying a rejection', async () => {
  const fetch = vi.fn(async () => new Response('{"detail":"Cart changed","code":"CART_CHANGED"}', { status: 409 }))
  vi.stubGlobal('fetch', fetch)
  await expect(request('/api/v1/terminals/orders/checkout/', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 409, code: 'CART_CHANGED' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('keeps version/summary reads scoped without giving Hub device authority', async () => {
  const fetch = vi.fn(async (_path: string, _options: RequestInit) => new Response('{}'))
  vi.stubGlobal('fetch', fetch); configureTerminalSimulator('a'.repeat(32))
  await hubCartApi.version('hub-token', 'HAVE-TEST-001')
  await terminalCartApi.version('kiosk-token')
  await hubPurchaseApi.summary('hub-token')
  await terminalPurchaseApi.summary('kiosk-token')
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/hub/cart/version/?terminal_serial=HAVE-TEST-001', '/api/v1/terminals/cart/version/',
    '/api/v1/hub/orders/summary/', '/api/v1/terminals/orders/summary/',
  ])
  for (const [index, [, options]] of fetch.mock.calls.entries()) {
    const headers = options.headers as Headers
    expect(headers.has('X-Terminal-Simulator')).toBe(index % 2 === 1)
    expect(headers.has('X-Terminal-Key')).toBe(false)
    expect(headers.has('X-Terminal-Serial')).toBe(false)
    expect(options.method ?? 'GET').toBe('GET')
  }
})

it('resumes only by an explicit POST and never retries an unavailable provider', async () => {
  const fetch = vi.fn(async (_path: string, _options: RequestInit) => new Response('{"detail":"Checking payment"}', { status: 503 }))
  vi.stubGlobal('fetch', fetch)
  await expect(hubPurchaseApi.resume('hub-token', 'order-id')).rejects.toMatchObject({ status: 503 })
  expect(fetch).toHaveBeenCalledTimes(1)
  await expect(terminalPurchaseApi.resume('kiosk-token', 'order-id', { return_simulator_id: 'a'.repeat(32) })).rejects.toMatchObject({ status: 503 })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[0]![0]).toBe('/api/v1/hub/orders/order-id/resume/')
  expect(fetch.mock.calls[1]![0]).toBe('/api/v1/terminals/orders/order-id/resume/')
  for (const [, options] of fetch.mock.calls) expect(options.method).toBe('POST')
  expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual({ return_simulator_id: 'a'.repeat(32) })
})
