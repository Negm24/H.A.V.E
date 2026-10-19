import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@have/shared/api'

export function useOrderOperation(identity = '', unavailableMessage = 'unavailable') {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const alive = useRef(true), running = useRef<number | null>(null), generation = useRef(0)
  useEffect(() => { alive.current = true; generation.current++; return () => { alive.current = false; generation.current++ } }, [identity])
  const run = useCallback(async <T,>(work: () => Promise<T>, clearError = true): Promise<T | undefined> => {
    const current = generation.current
    if (running.current === current) return
    running.current = current; setBusy(true); if (clearError) setError('')
    try { const value = await work(); return alive.current && current === generation.current ? value : undefined }
    catch (cause) {
      if (alive.current && current === generation.current) setError(cause instanceof ApiError && cause.code === 'PAYMENT_CHECKING' ? 'checkingPaymentHelp' : cause instanceof ApiError && cause.code === 'CART_CHANGED' ? 'cartChanged' : cause instanceof ApiError && /saved.*card|card.*saved|payment method/i.test(cause.message) ? 'savedCard' : cause instanceof ApiError && cause.status === 409 ? 'conflict' : cause instanceof ApiError && cause.status === 0 ? 'uncertain' : unavailableMessage)
      return undefined
    } finally { if (running.current === current) running.current = null; if (alive.current && current === generation.current) setBusy(false) }
  }, [unavailableMessage])
  return { run, busy, error }
}
