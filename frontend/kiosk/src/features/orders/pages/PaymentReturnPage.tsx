import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { ApiError } from '@have/shared/api'
import { terminalPurchaseApi, type PurchaseOrder } from '@have/shared/api/purchase'
import { Alert, Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'
import { OrderSummary } from '../components/OrderSummary'
import '../styles/orders.css'

export function PaymentReturnPage() {
  const [query] = useSearchParams(), id = query.get('order_id') ?? '', navigate = useNavigate()
  const { t, i18n } = useTranslation('orders'), { controller } = useSession()
  const [order, setOrder] = useState<PurchaseOrder | null>(null), [error, setError] = useState('')
  const lastTouch = useRef(Date.now()), ending = useRef(false), inFlight = useRef<number | null>(null), generation = useRef(0), privateEnded = useRef(false)
  const privacyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const activityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), lastActivity = useRef(-Infinity)
  const activityAbort = useRef<AbortController | null>(null)
  const finish = useCallback(() => {
    if (ending.current) return
    ending.current = true; generation.current++; clearTimeout(activityTimer.current); activityAbort.current?.abort(); setOrder(null); controller.reset()
    // The restricted return cookie authorizes this receipt only, never an account.
    void terminalPurchaseApi.endResult(id).catch(() => {})
    navigate('/', { replace: true })
  }, [controller, id, navigate])
  const schedulePrivacy = useCallback(() => {
    lastTouch.current = Date.now(); clearTimeout(privacyTimer.current)
    privacyTimer.current = setTimeout(finish, 60_000)
  }, [finish])
  const touch = useCallback(() => {
    schedulePrivacy()
    const renew = () => {
      activityTimer.current = undefined
      if (ending.current || privateEnded.current) return
      lastActivity.current = Date.now()
      const current = generation.current, abort = new AbortController()
      activityAbort.current?.abort(); activityAbort.current = abort
      // Only real pointer/key input renews this receipt's short private window.
      // This cookie-scoped operation cannot restore or renew a Terminal login.
      void terminalPurchaseApi.resultActivity(id, abort.signal).catch(cause => {
        if (current !== generation.current || abort.signal.aborted) return
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) finish()
      })
    }
    if (Date.now() - lastActivity.current >= 5_000) { clearTimeout(activityTimer.current); renew() }
    else if (activityTimer.current === undefined) activityTimer.current = setTimeout(renew, 5_000 - (Date.now() - lastActivity.current))
  }, [finish, id, schedulePrivacy])
  const read = useCallback(async () => {
    const current = generation.current
    if (inFlight.current === current || document.hidden || ending.current || privateEnded.current) return
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) { setError('privateResult'); return }
    inFlight.current = current
    try {
      const result = await terminalPurchaseApi.result(id)
      if (current !== generation.current || ending.current) return
      setOrder(result); setError(''); void i18n.changeLanguage(result.language)
    } catch (cause) {
      if (current !== generation.current) return
      if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) { privateEnded.current = true; setOrder(null); setError('privateResult') }
      else setError('unavailable')
    } finally { if (inFlight.current === current) inFlight.current = null }
  }, [id, i18n])
  useEffect(() => {
    ending.current = false; privateEnded.current = false; generation.current++; lastActivity.current = -Infinity; schedulePrivacy(); void read()
    const timer = setInterval(() => { if (Date.now() - lastTouch.current >= 60_000) finish(); else void read() }, 3_000)
    const visible = () => { if (!document.hidden) { if (Date.now() - lastTouch.current >= 60_000) finish(); else void read() } }
    document.addEventListener('visibilitychange', visible)
    return () => { generation.current++; clearInterval(timer); clearTimeout(privacyTimer.current); clearTimeout(activityTimer.current); activityTimer.current = undefined; activityAbort.current?.abort(); document.removeEventListener('visibilitychange', visible) }
  }, [finish, read, schedulePrivacy])
  return <KioskFrame title={t('result')} onReset={finish} onInteraction={touch}><div className="terminal-orders">
    <h1>{t('result')}</h1><p>{t('resultNotice')}</p>
    {error && <Alert>{t(error)}</Alert>}
    <div className="terminal-order-scroll">{order ? <OrderSummary order={order} /> : !error && <p role="status">{t('checking')}</p>}</div>
    <div className="terminal-order-result-actions"><p>{t('privacy')}</p><Button onClick={() => void read()}>{t('refresh')}</Button><Button variant="primary" onClick={finish}>{t('done')}</Button></div>
  </div></KioskFrame>
}
