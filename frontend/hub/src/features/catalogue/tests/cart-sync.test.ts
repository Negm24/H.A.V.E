import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerCart } from '@have/shared/api/cart'
import type { PurchaseTerminal } from '@have/shared/api/purchase'
import { HubCatalogueProvider, useHubCatalogue } from '../hooks/use-catalogue'

const api = vi.hoisted(() => ({ get: vi.fn(), version: vi.fn(), categories: vi.fn(), products: vi.fn(), setQuantity: vi.fn(), clear: vi.fn() }))
const account = vi.hoisted(() => ({ customer: { id: 'CUSTOMER-A' }, status: 'authenticated', session: { authorized: async <T>(work: (token: string) => Promise<T>) => work('private-in-memory-token') } }))
vi.mock('../../../app/providers', () => ({ useSession: () => account }))
vi.mock('@have/shared/api/cart', () => ({ hubCartApi: { get: api.get, version: api.version, setQuantity: api.setQuantity, clear: api.clear } }))
vi.mock('@have/shared/api/catalogue', () => ({ hubCatalogueApi: { categories: api.categories, products: api.products } }))

let root: Root, host: HTMLDivElement, view: ReturnType<typeof useHubCatalogue>, visible = true
const terminal = { serial_number: 'HAVE-TEST-001', display_name: 'HAVE Mark I' } as PurchaseTerminal
const cart = (version: string) => ({ version, total_quantity: 1, items: [] }) as unknown as CustomerCart
function Probe() { view = useHubCatalogue(); return null }
const render = () => root.render(createElement(HubCatalogueProvider, null, createElement(Probe)))

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers(); vi.clearAllMocks(); visible = true; account.customer = { id: 'CUSTOMER-A' }
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden')
  api.get.mockResolvedValue(cart('v1')); api.version.mockResolvedValue({ version: 'v1' })
  api.categories.mockResolvedValue({ items: [] }); api.products.mockResolvedValue({ items: [], observed_at: '2026-10-18T12:00:00Z' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('Hub machine-specific cart synchronisation', () => {
  it('checks lightweight versions every two seconds and fetches only changed baskets', async () => {
    await act(async () => { render() }); await act(async () => { view.selectTerminal(terminal) })
    expect(api.get).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(api.version).toHaveBeenCalledWith('private-in-memory-token', 'HAVE-TEST-001', expect.any(AbortSignal))
    expect(api.get).toHaveBeenCalledTimes(1)
    api.version.mockResolvedValue({ version: 'v2' }); api.get.mockResolvedValue(cart('v2'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(api.get).toHaveBeenCalledTimes(2); expect(view.cart?.version).toBe('v2')
  })
  it('stops hidden polling and reports failed version reads as unavailable, never empty', async () => {
    await act(async () => { render() }); await act(async () => { view.selectTerminal(terminal) })
    api.version.mockRejectedValue(new Error('Redis unavailable'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(view.cartError).toBe(true); expect(view.cart?.version).toBe('v1')
    visible = false; await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(10_000) })
    expect(api.version).toHaveBeenCalledTimes(1)
  })
  it('drops the selected location, cart and pending data when the customer changes', async () => {
    await act(async () => { render() }); await act(async () => { view.selectTerminal(terminal) })
    expect(view.cart?.version).toBe('v1')
    account.customer = { id: 'CUSTOMER-B' }; await act(async () => { render() })
    expect(view.terminal).toBeNull(); expect(view.cart).toBeNull()
  })
})
