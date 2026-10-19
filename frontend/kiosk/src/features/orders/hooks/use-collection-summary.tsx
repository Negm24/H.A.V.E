import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { terminalPurchaseApi } from '@have/shared/api/purchase'
import { useSession } from '../../session/hooks/use-session'

type CollectionSummary = Awaited<ReturnType<typeof terminalPurchaseApi.summary>>
type SummaryState = { summary: CollectionSummary | null; refresh: () => Promise<void> }
const Context = createContext<SummaryState | null>(null)

export function CollectionSummaryProvider({ children }: { children: ReactNode }) {
  const { controller, state } = useSession()
  const customerId = state.phase === 'customer' ? state.customer?.id ?? '' : ''
  const [value, setValue] = useState<{ customerId: string; data: CollectionSummary } | null>(null)
  const generation = useRef(0), reading = useRef<number | null>(null)
  const refresh = useCallback(async () => {
    const current = generation.current
    if (document.hidden || reading.current === current || controller.getSnapshot().phase !== 'customer') return
    const identity = controller.getSnapshot().customer?.id ?? ''
    reading.current = current
    try {
      const data = await controller.request((token, signal) => terminalPurchaseApi.summary(token, signal))
      if (current === generation.current && controller.getSnapshot().customer?.id === identity) setValue({ customerId: identity, data })
    } catch {
      // A failed read is not a zero collection count. Keep the last verified
      // result only for this identity; session reset clears it immediately.
    } finally { if (reading.current === current) reading.current = null }
  }, [controller])
  useEffect(() => {
    generation.current++; setValue(null)
    if (!customerId) return
    void refresh()
    const timer = setInterval(() => void refresh(), 15_000)
    const visible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    return () => { generation.current++; clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible) }
  }, [customerId, refresh])
  return <Context.Provider value={{ summary: value?.customerId === customerId ? value.data : null, refresh }}>{children}</Context.Provider>
}

export function useCollectionSummary() {
  const state = useContext(Context)
  if (!state) throw new Error('CollectionSummaryProvider is required')
  return state
}
