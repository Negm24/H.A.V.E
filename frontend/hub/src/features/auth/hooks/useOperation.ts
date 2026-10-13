import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@have/shared/api'
import { useTranslation } from '@have/shared/i18n'

export function useCountdown(deadline: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [deadline])
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

export function useOperation() {
  const { t, i18n } = useTranslation('hub')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [fields, setFields] = useState<Record<string, string>>({})
  const [blockedUntil, setBlockedUntil] = useState(0)
  const controller = useRef<AbortController | null>(null), active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); controller.current = null } }, [])
  const remaining = useCountdown(blockedUntil)
  async function run<T>(work: (signal: AbortSignal) => Promise<T>, success: (result: T) => void) {
    if (controller.current || Date.now() < blockedUntil) return
    const request = new AbortController(); controller.current = request
    setBusy(true); setError(''); setFields({})
    try { const result = await work(request.signal); if (active.current && !request.signal.aborted) success(result) }
    catch (failure) {
      if (!active.current || request.signal.aborted || failure instanceof DOMException && failure.name === 'AbortError') return
      const api = failure instanceof ApiError ? failure : null
      if (api?.retryAfter) setBlockedUntil(Date.now() + api.retryAfter * 1000)
      const key = api?.status === 401 ? 'credentials' : api?.status === 409 ? 'conflict' : api?.status === 429 ? 'limited' : api?.status === 400 ? 'invalid' : 'network'
      setError(t(`errors.${key}`))
      if (api) setFields(Object.fromEntries(Object.entries(api.fields).map(([name, message]) => [name, i18n.language === 'en' ? message : t('errors.field')])))
    } finally { if (controller.current === request) { controller.current = null; if (active.current) setBusy(false) } }
  }
  return { run, busy, error, fields, remaining, clear: () => { setError(''); setFields({}) } }
}

export function useReloadWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}
