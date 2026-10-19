import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PurchaseOrder, terminalPurchaseApi } from '@have/shared/api/purchase'
import type { TerminalCart } from '@have/shared/api/terminal'
import { useSession } from '../../session/hooks/use-session'

type CheckoutInput = Parameters<typeof terminalPurchaseApi.checkout>[1]
type Attempt = { input: CheckoutInput; order: PurchaseOrder | null; basket: TerminalCart | null }
type AttemptState = { attempt: Attempt | null; begin: (input: Omit<CheckoutInput, 'idempotency_key'>, basket?: TerminalCart) => Attempt; update: (order: PurchaseOrder) => void; clear: () => void }
const Context = createContext<AttemptState | null>(null)

// This draft intentionally lives only in the running app. Reload/reset must not
// expose a previous visitor's checkout or restore their session.
export function CheckoutAttemptProvider({ children }: { children: ReactNode }) {
  const { state } = useSession()
  const identity = state.phase === 'customer' ? state.customer?.id ?? '' : state.phase === 'guest' ? 'guest' : ''
  const current = useRef<{ identity: string; attempt: Attempt } | null>(null)
  const [, render] = useState(0)
  useEffect(() => { current.current = null; render(value => value + 1) }, [identity])
  const begin = (input: Omit<CheckoutInput, 'idempotency_key'>, basket?: TerminalCart) => {
    if (!current.current || current.current.identity !== identity) current.current = { identity, attempt: { input: { ...input, idempotency_key: crypto.randomUUID() }, order: null, basket: basket ?? null } }
    render(value => value + 1)
    return current.current.attempt
  }
  const update = (order: PurchaseOrder) => {
    if (!current.current || current.current.identity !== identity) return
    current.current.attempt = { ...current.current.attempt, order }; render(value => value + 1)
  }
  const clear = () => { current.current = null; render(value => value + 1) }
  return <Context.Provider value={{ attempt: current.current?.identity === identity ? current.current.attempt : null, begin, update, clear }}>{children}</Context.Provider>
}

export function useCheckoutAttempt() {
  const state = useContext(Context)
  if (!state) throw new Error('CheckoutAttemptProvider is required')
  return state
}
