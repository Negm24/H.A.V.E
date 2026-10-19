import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { hubPurchaseApi, isHostedCheckoutUrl, type PurchaseOrder } from '@have/shared/api/purchase'
import { ApiError } from '@have/shared/api'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { CatalogueModal } from '@have/shared/ui/catalogue'
import { useSession } from '../../../app/providers'
import { useHubCatalogue } from '../../catalogue/hooks/use-catalogue'
import { useCollectionSummary } from '../hooks/use-collection-summary'
import { useOrderHistory } from '../hooks/use-order-history'
import { useOrderClock } from '../hooks/use-order-clock'
import { canResumeCheckout, orderStatusLabel, unfinishedCheckout } from '../services/payment-status'
import { CheckoutDeadline } from '../components/CheckoutDeadline'
import '../styles/orders.css'

export function OrderHistoryPage() {
  const { t, i18n } = useTranslation('hubPurchase'), { session, customer } = useSession(), navigate = useNavigate(), catalogue = useHubCatalogue()
  const { refresh: refreshSummary } = useCollectionSummary(), { orders, loading, failed, refresh } = useOrderHistory()
  const [cancel, setCancel] = useState<PurchaseOrder | null>(null), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('')
  const active = useRef<AbortController | null>(null), pending = orders.filter(unfinishedCheckout), history = orders.filter(order => !unfinishedCheckout(order))
  const now = useOrderClock(pending.length > 0)
  useEffect(() => () => active.current?.abort(), [customer?.id])
  const resume = async (order: PurchaseOrder) => {
    if (busy || !canResumeCheckout(order, Date.now())) return
    const controller = new AbortController(); active.current = controller; setBusy(order.id); setError('')
    try {
      const result = await session.authorized(token => hubPurchaseApi.resume(token, order.id, controller.signal))
      if (controller.signal.aborted) return
      if (!result.checkout_url) { navigate(`/orders/${result.order.id}`); return }
      if (!isHostedCheckoutUrl(result.checkout_url)) { setError('unsafeCheckout'); return }
      window.location.assign(result.checkout_url)
    } catch (failure) {
      if (!controller.signal.aborted) { setError(failure instanceof ApiError && failure.status === 409 ? 'resumeConflict' : 'resumeUnconfirmed'); await refresh() }
    } finally { if (!controller.signal.aborted) { setBusy(null); void refreshSummary() } }
  }
  const cancelCheckout = async () => {
    if (!cancel || busy) return
    const controller = new AbortController(); active.current = controller; setBusy(cancel.id); setError('')
    try {
      await session.authorized(token => hubPurchaseApi.cancel(token, cancel.id, controller.signal))
      if (!controller.signal.aborted) { setCancel(null); await Promise.all([refresh(), refreshSummary(), catalogue.refresh()]) }
    } catch (failure) {
      if (!controller.signal.aborted) { setError(failure instanceof ApiError && failure.code === 'PAYMENT_CHECKING' ? 'checkingPaymentHelp' : failure instanceof ApiError && failure.status === 409 ? 'actionConflict' : 'actionUnconfirmed'); await refresh() }
    } finally { if (!controller.signal.aborted) setBusy(null) }
  }
  const card = (order: PurchaseOrder, unfinished = false) => <article className="hub-order-card" key={order.id}>
    <div><Link to={`/orders/${order.id}`}><strong dir="ltr">{order.order_number}</strong></Link><span>{new Date(order.created_at).toLocaleDateString(i18n.language)}</span></div><span className={`hub-order-status status-${order.status.toLowerCase()}`}>{t(orderStatusLabel(order))}</span><p>{order.terminal.display_name}</p><div><span>{t('items', { count: order.items.reduce((total, item) => total + item.quantity_requested, 0) })}</span><b>{order.customer_payable_amount} {order.currency}</b></div>
    {unfinished && <><CheckoutDeadline expiresAt={order.expires_at} now={now} /><p className="hub-muted">{t('checkoutSnapshot')}</p><div className="hub-order-actions">{canResumeCheckout(order, now) && <Button variant="primary" disabled={!!busy || failed} onClick={() => void resume(order)}>{busy === order.id ? t('working') : t('continuePayment')}</Button>}<Button disabled={!!busy || failed} onClick={() => { setError(''); setCancel(order) }}>{t('cancelCheckout')}</Button><Link to={`/orders/${order.id}`}>{t('viewDetails')}</Link></div></>}
  </article>
  return <section className="hub-orders"><Link to="/profile">← {t('profile')}</Link><h1>{t('history')}</h1><p className="hub-test-banner">{t('testMode')}</p>
    {failed && <Alert>{t('unavailable')} <Button onClick={() => void refresh()}>{t('refresh')}</Button></Alert>}
    {error && !cancel && <Alert>{t(error)}</Alert>}
    {loading ? <p role="status">{t('loading')}</p> : !failed && !orders.length ? <p>{t('emptyOrders')}</p> : <>
      {!!pending.length && <section aria-labelledby="hub-unfinished-title"><h2 id="hub-unfinished-title">{t('unfinishedCheckouts')}</h2><div className="hub-order-list">{pending.map(order => card(order, true))}</div></section>}
      {!!history.length && <section aria-labelledby="hub-purchases-title"><h2 id="hub-purchases-title">{t('purchases')}</h2><div className="hub-order-list">{history.map(order => card(order))}</div></section>}
    </>}
    {cancel && <CatalogueModal title={t('cancelCheckout')} close={busy ? undefined : () => setCancel(null)}><p>{t('cancelCheckoutConfirm')}</p>{error && <Alert>{t(error)}</Alert>}<div className="hub-order-actions"><Button disabled={!!busy} onClick={() => setCancel(null)}>{t('keep')}</Button><Button variant="primary" disabled={!!busy} onClick={() => void cancelCheckout()}>{busy ? t('working') : t('confirm')}</Button></div></CatalogueModal>}
  </section>
}
