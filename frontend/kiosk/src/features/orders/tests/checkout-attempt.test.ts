import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const test = vi.hoisted(() => ({ snapshot: { phase: 'guest', customer: null as { id: string } | null } }))
vi.mock('../../session/hooks/use-session', () => ({ useSession: () => ({ state: test.snapshot }) }))
import { CheckoutAttemptProvider, useCheckoutAttempt } from '../hooks/use-checkout-attempt'

let root: Root, output: ReturnType<typeof useCheckoutAttempt>
function Probe() { output = useCheckoutAttempt(); return null }
const draw = async (show = true) => { await act(async () => root.render(createElement(CheckoutAttemptProvider, null, show ? createElement(Probe) : null))) }
const input = { cart_version: 'v1', email: 'guest@example.test', language: 'en' as const, print_requested: true }

describe('Kiosk memory-only checkout draft', () => {
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); test.snapshot = { phase: 'guest', customer: null }; root = createRoot(document.createElement('div')) })
  afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })
  it('preserves the original idempotency and reviewed request when leaving and returning', async () => {
    await draw(); await act(async () => { output.begin(input) })
    const first = output.attempt!.input
    await draw(false); await draw()
    await act(async () => { output.begin({ ...input, cart_version: 'newer-basket' }) })
    expect(output.attempt!.input).toEqual(first)
    expect(first.idempotency_key).toMatch(/^[a-f0-9-]{36}$/)
  })
  it('does not carry guest payment drafts into a customer identity or a new session', async () => {
    await draw(); await act(async () => { output.begin(input) })
    test.snapshot = { phase: 'customer', customer: { id: 'customer-1' } }; await draw()
    expect(output.attempt).toBeNull()
    await act(async () => { output.begin(input) }); test.snapshot = { phase: 'attract', customer: null }; await draw()
    expect(output.attempt).toBeNull()
  })
})
