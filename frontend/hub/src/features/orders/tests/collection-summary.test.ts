import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionSummaryProvider, useCollectionSummary } from '../hooks/use-collection-summary'

const api = vi.hoisted(() => ({ summary: vi.fn() }))
const account = vi.hoisted(() => ({ customer: { id: 'CUSTOMER-A' }, status: 'authenticated', session: { authorized: async <T>(work: (token: string) => Promise<T>) => work('in-memory-token') } }))
vi.mock('../../../app/providers', () => ({ useSession: () => account }))
vi.mock('@have/shared/api/purchase', () => ({ hubPurchaseApi: { summary: api.summary } }))
let root: Root, host: HTMLDivElement, view: ReturnType<typeof useCollectionSummary>, visible = true
const summary = { awaiting_collection_count: 2, at_terminal_count: 0, elsewhere_count: 2, collection_terminals: [{ serial_number: 'HAVE-TEST-001', display_name: 'HAVE Mark I', count: 2 }] }
function Probe() { view = useCollectionSummary(); return null }
const render = () => root.render(createElement(CollectionSummaryProvider, null, createElement(Probe)))
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers(); vi.clearAllMocks(); visible = true; account.customer = { id: 'CUSTOMER-A' }; account.status = 'authenticated'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden')
  api.summary.mockResolvedValue(summary); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('Hub collection indication', () => {
  it('loads on entry, refreshes every fifteen seconds and pauses when hidden', async () => {
    await act(async () => { render() })
    expect(view.summary?.awaiting_collection_count).toBe(2); expect(api.summary).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(api.summary).toHaveBeenCalledTimes(2)
    visible = false; await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(30_000) })
    expect(api.summary).toHaveBeenCalledTimes(2)
    visible = true; await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(api.summary).toHaveBeenCalledTimes(3)
  })
  it('does not turn a service failure into a zero-order claim', async () => {
    await act(async () => { render() }); api.summary.mockRejectedValue(new Error('unavailable'))
    await act(async () => { await view.refresh() })
    expect(view.summary).toBeNull(); expect(view.unavailable).toBe(true)
  })
  it('ignores a previous customer response and clears all counts on logout', async () => {
    let finish: (value: typeof summary) => void = () => {}
    api.summary.mockImplementationOnce(() => new Promise<typeof summary>(resolve => { finish = resolve }))
    await act(async () => { render() })
    account.customer = { id: 'CUSTOMER-B' }; api.summary.mockResolvedValue({ ...summary, awaiting_collection_count: 0 })
    await act(async () => { render() }); await act(async () => { finish(summary) })
    expect(view.summary?.awaiting_collection_count).toBe(0)
    account.status = 'anonymous'; await act(async () => { render() })
    expect(view.summary).toBeNull()
  })
})
