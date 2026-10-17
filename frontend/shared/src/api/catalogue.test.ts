import { afterEach, expect, it, vi } from 'vitest'
import { hubCatalogueApi } from './catalogue'
import { hubCartApi } from './cart'
import { terminalApi } from './terminal'

afterEach(() => vi.unstubAllGlobals())

it('uses only customer bearer authentication for Hub business reads', async () => {
  const fetch = vi.fn(async (_path: string, _options: RequestInit) => new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  await hubCatalogueApi.categories('hub-token')
  await hubCatalogueApi.products('hub-token')
  await hubCatalogueApi.product('hub-token', 12)
  await hubCartApi.get('hub-token')
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/hub/catalogue/categories/', '/api/v1/hub/catalogue/products/',
    '/api/v1/hub/catalogue/products/12/', '/api/v1/hub/cart/',
  ])
  for (const [, options] of fetch.mock.calls) {
    const headers = options.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer hub-token')
    expect(headers.has('X-Terminal-Key')).toBe(false)
    expect(headers.has('X-Terminal-Serial')).toBe(false)
  }
})

it('includes reviewed versions and never retries a conflicting cart mutation', async () => {
  const fetch = vi.fn(async (_path: string, _options: RequestInit) => new Response('{"detail":"Cart changed."}', { status: 409 }))
  vi.stubGlobal('fetch', fetch)
  await expect(hubCartApi.setQuantity('token', 12, 2, 'reviewed')).rejects.toMatchObject({ status: 409 })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ quantity: 2, expected_version: 'reviewed' })
})

it('sends versions for separate Hub and Terminal carts without adoption', async () => {
  const fetch = vi.fn(async (_path: string, _options: RequestInit) => new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  await hubCartApi.clear('hub', 'v1', undefined, 'HAVE-TEST-001')
  await terminalApi.setQuantity('terminal', 12, 0, 'v2')
  expect(fetch.mock.calls[0]![0]).toBe('/api/v1/hub/cart/?terminal_serial=HAVE-TEST-001')
  expect(fetch.mock.calls[0]![1].method).toBe('DELETE')
  expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ expected_version: 'v1' })
  expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual({ quantity: 0, expected_version: 'v2' })
  expect(fetch).toHaveBeenCalledTimes(2)
})
