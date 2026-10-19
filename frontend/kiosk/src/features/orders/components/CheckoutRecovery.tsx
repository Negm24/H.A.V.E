import { useEffect, useState } from 'react'
import { ApiError } from '@have/shared/api'
import { terminalPurchaseApi, isHostedCheckoutUrl, type PurchaseOrder } from '@have/shared/api/purchase'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { CatalogueModal } from '@have/shared/ui/catalogue'
import { useSession } from '../../session/hooks/use-session'
import { useCollectionSummary } from '../hooks/use-collection-summary'
import { useOrderOperation } from '../hooks/use-order-operation'
import { canResumeCheckout, checkoutSecondsRemaining } from '../services/order-presentation'

export function CheckoutRecovery({ order, updated }: { order: PurchaseOrder; updated: (order: PurchaseOrder) => void }) {
  const { t } = useTranslation('orders'), { controller, state } = useSession(), { refresh } = useCollectionSummary()
  const { run, busy, error } = useOrderOperation(`${state.customer?.id}:${order.id}`, 'paymentUnavailable')
  const [now, setNow] = useState(Date.now), [confirm, setConfirm] = useState(false)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(timer) }, [])
  useEffect(() => { if (state.remaining <= 30) setConfirm(false) }, [state.remaining])
  const remaining = checkoutSecondsRemaining(order, now)
  const resume = async () => {
    const result = await run(async () => {
      const response = await controller.request((token, signal) => terminalPurchaseApi.resume(token, order.id, { return_simulator_id: new URLSearchParams(window.location.search).get('terminal') ?? undefined }, signal))
      if (response.checkout_url && !isHostedCheckoutUrl(response.checkout_url)) throw new ApiError('Invalid hosted payment URL.', 503)
      return response
    })
    if (!result) return
    updated(result.order); void refresh()
    if (result.checkout_url) window.location.assign(result.checkout_url)
  }
  const cancel = async () => {
    setConfirm(false)
    const result = await run(() => controller.request((token, signal) => terminalPurchaseApi.cancel(token, order.id, signal)))
    if (result) { updated(result); void refresh() }
  }
  const checkStatus = async () => {
    const result = await run(() => controller.request((token, signal) => terminalPurchaseApi.detail(token, order.id, signal)))
    if (result) { updated(result); void refresh() }
  }
  return <div className="checkout-recovery">
    <span className="checkout-deadline" role="timer">{remaining > 0 ? t('checkoutRemaining', { minutes: Math.floor(remaining / 60), seconds: String(remaining % 60).padStart(2, '0') }) : t('checkoutExpired')}</span>
    <p>{t(order.payment_state === 'CHECKING_PAYMENT' ? 'checkingPaymentHelp' : 'resumeNotice')}</p>
    {error && <Alert>{t(error)}</Alert>}
    <div className="terminal-order-actions">{canResumeCheckout(order, now) && <Button variant="primary" disabled={busy} onClick={() => void resume()}>{t('resume')}</Button>}<Button disabled={busy} onClick={() => void checkStatus()}>{t('refresh')}</Button><Button disabled={busy} onClick={() => setConfirm(true)}>{t('cancelCheckout')}</Button></div>
    {confirm && state.remaining > 30 && <CatalogueModal title={t('cancelCheckout')} close={() => setConfirm(false)}><p>{t('cancelCheckoutBody')}</p><div className="terminal-order-confirm"><Button onClick={() => setConfirm(false)}>{t('back')}</Button><Button variant="primary" disabled={busy} onClick={() => void cancel()}>{t('confirm')}</Button></div></CatalogueModal>}
  </div>
}
