import { useEffect, useState } from 'react'
import { hubPurchaseApi, type PurchaseOrder } from '@have/shared/api/purchase'
import { ApiError } from '@have/shared/api'
import { useSession } from '../../../app/providers'

export function useOrder(id: string) {
  const { session } = useSession(), [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, flight = false
    setOrder(null); setLoading(true); setError('')
    const load = async () => {
      if (flight || controller.signal.aborted || document.visibilityState !== 'visible') return
      flight = true; clearTimeout(timer)
      try {
        const result = await session.authorized(token => hubPurchaseApi.detail(token, id, controller.signal), true)
        if (!controller.signal.aborted) {
          setOrder(result); setError('')
          if (result.status === 'PENDING' || result.status === 'DISPENSING') timer = setTimeout(() => void load(), 3_000)
        }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof ApiError && failure.status === 404 ? 'orderNotFound' : 'unavailable') }
      finally { flight = false; if (!controller.signal.aborted) setLoading(false) }
    }
    const visible = () => { clearTimeout(timer); if (document.visibilityState === 'visible') void load() }
    void load(); document.addEventListener('visibilitychange', visible)
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [id, session, attempt])
  return { order, error, loading, setOrder, refresh: () => setAttempt(value => value + 1) }
}
