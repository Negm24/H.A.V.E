import { useEffect, useRef, useState } from 'react'
import { hubPurchaseApi, type PurchaseOrder } from '@have/shared/api/purchase'
import { useSession } from '../../../app/providers'

export function useOrderHistory() {
  const { session, customer } = useSession()
  const [snapshot, setSnapshot] = useState<{ customerId: string; orders: PurchaseOrder[]; loading: boolean; failed: boolean }>({ customerId: '', orders: [], loading: true, failed: false })
  const read = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    const controller = new AbortController(), customerId = customer?.id ?? ''
    let timer: ReturnType<typeof setTimeout>, flight: Promise<void> | null = null
    setSnapshot({ customerId, orders: [], loading: true, failed: false })
    const load = (): Promise<void> => {
      if (controller.signal.aborted || document.visibilityState !== 'visible') return Promise.resolve()
      if (flight) return flight
      clearTimeout(timer)
      const request = session.authorized(token => hubPurchaseApi.list(token, controller.signal), true)
        .then(orders => { if (!controller.signal.aborted) setSnapshot({ customerId, orders, loading: false, failed: false }) })
        .catch(() => { if (!controller.signal.aborted) setSnapshot(current => ({ ...current, loading: false, failed: true })) })
        .finally(() => { if (flight === request) flight = null; if (!controller.signal.aborted && document.visibilityState === 'visible') timer = setTimeout(() => void load(), 15_000) })
      flight = request
      return request
    }
    const visible = () => { clearTimeout(timer); if (document.visibilityState === 'visible') void load() }
    read.current = load; void load(); window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) }
  }, [session, customer?.id])
  return { ...snapshot, orders: snapshot.customerId === customer?.id ? snapshot.orders : [], refresh: () => read.current() }
}
