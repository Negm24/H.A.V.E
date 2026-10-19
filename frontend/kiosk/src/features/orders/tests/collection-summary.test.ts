import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const test = vi.hoisted(() => {
  const snapshot: { phase: string; customer: { id: string } | null } = { phase: 'customer', customer: { id: 'customer-1' } }
  return { snapshot, summary: vi.fn(), controller: { getSnapshot: vi.fn(), request: vi.fn() } }
})
vi.mock('@have/shared/api/purchase', () => ({ terminalPurchaseApi: { summary: test.summary } }))
vi.mock('../../session/hooks/use-session', () => ({ useSession: () => ({ state: test.snapshot, controller: test.controller }) }))
import { CollectionSummaryProvider, useCollectionSummary } from '../hooks/use-collection-summary'

let root: Root, output: ReturnType<typeof useCollectionSummary>
function Probe() { output = useCollectionSummary(); return null }
const draw = async () => { await act(async () => root.render(createElement(CollectionSummaryProvider, null, createElement(Probe)))) }
const summary = { awaiting_collection_count: 2, at_terminal_count: 1, elsewhere_count: 1, collection_terminals: [{ serial_number: 'HAVE-TEST-001', display_name: 'HAVE Mark I', count: 1 }, { serial_number: 'HAVE-TEST-002', display_name: 'HAVE Mark II', count: 1 }] }

describe('Kiosk collection count privacy and polling', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    test.snapshot = { phase: 'customer', customer: { id: 'customer-1' } }
    test.controller.getSnapshot.mockImplementation(() => test.snapshot)
    test.controller.request.mockReset().mockImplementation((work: (token: string, signal: AbortSignal) => unknown) => work('memory-token', new AbortController().signal))
    test.summary.mockReset().mockResolvedValue(summary)
    root = createRoot(document.createElement('div'))
  })
  afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })
  it('loads customer collection counts and distinguishes this machine from elsewhere', async () => {
    await draw(); expect(output.summary).toEqual(summary)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(test.summary).toHaveBeenCalledTimes(2)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(test.summary).toHaveBeenCalledTimes(2)
  })
  it('does not turn a failed read into a misleading zero count', async () => {
    await draw(); test.summary.mockRejectedValue(new Error('outage'))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(output.summary?.awaiting_collection_count).toBe(2)
  })
  it('clears the previous customer on reset and rejects their late response', async () => {
    let finish!: (value: typeof summary) => void
    test.summary.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await draw(); test.snapshot = { phase: 'guest', customer: null }; await draw()
    await act(async () => finish(summary))
    expect(output.summary).toBeNull()
  })
})
