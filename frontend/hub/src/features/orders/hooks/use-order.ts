import { useEffect, useState } from 'react'
import { hubPurchaseApi, type PurchaseOrder } from '@have/shared/api/purchase'
import { ApiError } from '@have/shared/api'
import { useSession } from '../../../app/providers'

export function useOrder(id: string) {
  const { session, customer } = useSession(), key = `${customer?.id ?? ''}/${id}`
  const [snapshot, setSnapshot] = useState<{ key: string; order: PurchaseOrder | null }>({ key, order: null })
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, flight = false
    setSnapshot({ key, order: null }); setLoading(true); setError('')
    const load = async () => {
      if (flight || controller.signal.aborted || document.visibilityState !== 'visible') return
      flight = true; clearTimeout(timer)
      try {
        const result = await session.authorized(token => hubPurchaseApi.detail(token, id, controller.signal), true)
        if (!controller.signal.aborted) {
          setSnapshot({ key, order: result }); setError('')
          if (result.status === 'PENDING' || result.status === 'DISPENSING' || result.payment_state === 'CHECKING_PAYMENT') timer = setTimeout(() => void load(), 3_000)
        }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof ApiError && failure.status === 404 ? 'orderNotFound' : 'unavailable') }
      finally { flight = false; if (!controller.signal.aborted) setLoading(false) }
    }
    const visible = () => { clearTimeout(timer); if (document.visibilityState === 'visible') void load() }
    void load(); document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible)
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible) }
  }, [key, session, attempt])
  return { order: snapshot.key === key ? snapshot.order : null, error, loading, setOrder: (order: PurchaseOrder) => setSnapshot({ key, order }), refresh: () => setAttempt(value => value + 1) }
}
