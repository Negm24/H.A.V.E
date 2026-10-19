import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { hubPurchaseApi } from '@have/shared/api/purchase'
import { useSession } from '../../../app/providers'

type Summary = Awaited<ReturnType<typeof hubPurchaseApi.summary>>
interface CollectionSummaryContext { summary: Summary | null; unavailable: boolean; refresh: () => Promise<void> }
const Context = createContext<CollectionSummaryContext | null>(null)

// One account-scoped poll serves the dashboard/profile/history. A failed read is
// unknown, never a claim that the customer has no orders waiting for collection.
export function CollectionSummaryProvider({ children }: { children: ReactNode }) {
  const { customer, status, session } = useSession()
  const [snapshot, setSnapshot] = useState<{ customerId: string; summary: Summary | null; unavailable: boolean }>({ customerId: '', summary: null, unavailable: false })
  const read = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    const controller = new AbortController(), id = customer?.id
    let timer: ReturnType<typeof setTimeout>, flight: Promise<void> | null = null
    setSnapshot({ customerId: id ?? '', summary: null, unavailable: false })
    if (status !== 'authenticated' || !id) { read.current = async () => {}; return () => controller.abort() }
    const load = (): Promise<void> => {
      if (controller.signal.aborted || document.visibilityState !== 'visible') return Promise.resolve()
      if (flight) return flight
      clearTimeout(timer)
      const request = session.authorized(token => hubPurchaseApi.summary(token, controller.signal), true)
        .then(summary => { if (!controller.signal.aborted) setSnapshot({ customerId: id, summary, unavailable: false }) })
        .catch(() => { if (!controller.signal.aborted) setSnapshot({ customerId: id, summary: null, unavailable: true }) })
        .finally(() => {
          if (flight === request) flight = null
          if (!controller.signal.aborted && document.visibilityState === 'visible') timer = setTimeout(() => void load(), 15_000)
        })
      flight = request
      return request
    }
    const visible = () => { clearTimeout(timer); if (document.visibilityState === 'visible') void load() }
    read.current = load
    void load(); window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) }
  }, [customer?.id, status, session])
  const current = status === 'authenticated' && snapshot.customerId === customer?.id
  return <Context.Provider value={{ summary: current ? snapshot.summary : null, unavailable: current && snapshot.unavailable, refresh: () => read.current() }}>{children}</Context.Provider>
}

export function useCollectionSummary() {
  const value = useContext(Context)
  if (!value) throw new Error('Collection summary requires CollectionSummaryProvider')
  useEffect(() => { void value.refresh() }, [])
  return value
}
