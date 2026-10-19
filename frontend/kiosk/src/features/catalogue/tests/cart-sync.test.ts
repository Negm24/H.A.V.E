import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const test = vi.hoisted(() => {
  const request = vi.fn()
  return { snapshot: { phase: 'customer', customer: { id: 'customer-1' } }, api: { categories: vi.fn(), products: vi.fn(), cart: vi.fn(), setQuantity: vi.fn() }, version: vi.fn(), request, controller: { getSnapshot: vi.fn(), request } }
})
vi.mock('@have/shared/api/terminal', () => ({ terminalApi: test.api, terminalCartApi: { version: test.version } }))
vi.mock('../../session/hooks/use-session', () => ({ useSession: () => ({ state: test.snapshot, controller: test.controller }) }))
import { CatalogueProvider, useCatalogue } from '../hooks/use-catalogue'

const basket = (version = 'v1') => ({ items: [], total_quantity: 0, subtotal: '0.00', total: '0.00', currency: 'EGP', has_issues: false, version, created_at: null, updated_at: null, expires_at: null, comparison_required: false, adoption_notice: null })
let root: Root, output: ReturnType<typeof useCatalogue>
function Probe() { output = useCatalogue(); return null }
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }) }

describe('Kiosk shared-cart version polling', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    test.snapshot = { phase: 'customer', customer: { id: 'customer-1' } }
    test.controller.getSnapshot.mockImplementation(() => test.snapshot)
    test.api.categories.mockReset().mockResolvedValue([]); test.api.products.mockReset().mockResolvedValue([])
    test.api.cart.mockReset().mockResolvedValue(basket()); test.version.mockReset().mockResolvedValue({ version: 'v1' })
    test.api.setQuantity.mockReset()
    test.request.mockReset().mockImplementation((work: (token: string, signal: AbortSignal) => unknown) => work('private-token', new AbortController().signal))
    root = createRoot(document.createElement('div'))
  })
  afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })
  const mount = async () => { await act(async () => root.render(createElement(CatalogueProvider, null, createElement(Probe)))); await flush() }
  it('checks revisions every two seconds and only fetches changed baskets', async () => {
    await mount()
    expect(test.api.cart).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(test.version).toHaveBeenCalledTimes(1); expect(test.api.cart).toHaveBeenCalledTimes(1)
    test.version.mockResolvedValue({ version: 'hub-change' }); test.api.cart.mockResolvedValue(basket('hub-change'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(output.cart.version).toBe('hub-change'); expect(test.api.cart).toHaveBeenCalledTimes(2)
  })
  it('pauses hidden reads and recovers on focus without renewing activity', async () => {
    await mount()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(test.version).not.toHaveBeenCalled(); expect(test.api.categories).toHaveBeenCalledTimes(1)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    await act(async () => window.dispatchEvent(new Event('focus'))); await flush()
    expect(test.api.categories).toHaveBeenCalledTimes(2)
    expect(test.request.mock.calls.every(([work]) => typeof work === 'function')).toBe(true)
  })
  it('reports a cart outage rather than an empty saved basket', async () => {
    await mount(); test.version.mockRejectedValue(new Error('Redis unavailable'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(output.cartAvailable).toBe(false); expect(output.error).toBe('cartUnavailable')
    expect(output.cart.version).toBe('v1')
    test.version.mockResolvedValue({ version: 'v1' })
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(test.api.cart).toHaveBeenCalledTimes(2)
    expect(output.cartAvailable).toBe(true)
  })
  it('does not let an older background basket overwrite a confirmed mutation', async () => {
    await mount()
    let finish!: (value: ReturnType<typeof basket>) => void
    test.api.cart.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => { void output.refresh(); for (let i = 0; i < 12; i++) await Promise.resolve() })
    test.api.setQuantity.mockResolvedValue(basket('after-write'))
    await act(async () => { await output.setQuantity(1, 2) })
    await act(async () => finish(basket('old-read')))
    expect(output.cart.version).toBe('after-write')
  })
})
