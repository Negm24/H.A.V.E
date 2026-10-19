import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { hubPurchaseApi, isHostedCheckoutUrl } from '@have/shared/api/purchase'
import { ApiError } from '@have/shared/api'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { CatalogueModal } from '@have/shared/ui/catalogue'
import { useSession } from '../../../app/providers'
import { useHubCatalogue } from '../../catalogue/hooks/use-catalogue'
import { useOrder } from '../hooks/use-order'
import { OrderSummary } from '../components/OrderSummary'
import { useCollectionSummary } from '../hooks/use-collection-summary'
import { useOrderClock } from '../hooks/use-order-clock'
import { canResumeCheckout, requiresCollection, unfinishedCheckout } from '../services/payment-status'
import '../styles/orders.css'

export function OrderDetailPage() {
  const { orderId = '' } = useParams(), { t } = useTranslation('hubPurchase'), location = useLocation(), navigate = useNavigate()
  const { order, loading, error: readError, setOrder, refresh } = useOrder(orderId), { session, customer } = useSession(), catalogue = useHubCatalogue()
  const { refresh: refreshSummary } = useCollectionSummary(), now = useOrderClock(!!order && unfinishedCheckout(order))
  const [action, setAction] = useState<'cancel' | 'reorder' | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [orderId, customer?.id])
  useEffect(() => { if (order) { void refreshSummary(); void catalogue.refresh() } }, [order?.paid_at, order?.status])
  useEffect(() => {
    if (order && !catalogue.terminal && new URLSearchParams(location.search).get('payment') === 'return') catalogue.selectTerminal(order.terminal)
  }, [order?.terminal.serial_number, catalogue.terminal?.serial_number, location.search])
  const act = async () => {
    if (!order || busy || !action) return
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('')
    try {
      if (action === 'cancel') {
        const result = await session.authorized(token => hubPurchaseApi.cancel(token, order.id, controller.signal))
        if (!controller.signal.aborted) { setOrder(result); setAction(null); await Promise.all([catalogue.refresh(), refreshSummary()]) }
      } else {
        if (!catalogue.cart || catalogue.cartError) { setError('cartUnavailable'); return }
        await session.authorized(token => hubPurchaseApi.reorder(token, order.id, catalogue.cart!.version, true, controller.signal))
        if (!controller.signal.aborted) { await catalogue.refresh(); setAction(null); navigate('/browse/categories'); catalogue.openCart() }
      }
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(failure instanceof ApiError && failure.code === 'PAYMENT_CHECKING' ? 'checkingPaymentHelp' : failure instanceof ApiError && failure.status === 409 ? 'actionConflict' : 'actionUnconfirmed')
      refresh(); await catalogue.refresh()
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const reorder = () => {
    if (!order) return
    catalogue.selectTerminal(order.terminal)
    setError(''); setAction('reorder')
  }
  const resume = async () => {
    if (!order || busy || !canResumeCheckout(order, Date.now())) return
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('')
    try {
      const result = await session.authorized(token => hubPurchaseApi.resume(token, order.id, controller.signal))
      if (controller.signal.aborted) return
      setOrder(result.order)
      if (!result.checkout_url) { await refreshSummary(); await catalogue.refresh(); return }
      if (!isHostedCheckoutUrl(result.checkout_url)) { setError('unsafeCheckout'); return }
      window.location.assign(result.checkout_url)
    } catch (failure) {
      if (!controller.signal.aborted) { setError(failure instanceof ApiError && failure.status === 409 ? 'resumeConflict' : 'resumeUnconfirmed'); refresh() }
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <section className="hub-order-detail"><Link to="/orders">← {t('history')}</Link>
    {new URLSearchParams(location.search).get('payment') === 'return' && <p role="status" className="hub-muted">{t('returnChecking')}</p>}
    {location.state?.notice === 'unsafeCheckout' && <Alert>{t('unsafeCheckout')}</Alert>}
    {readError && <Alert>{t(readError)} <Button onClick={refresh}>{t('refresh')}</Button></Alert>}
    {loading && !order ? <p role="status">{t('loading')}</p> : order && <>
      <OrderSummary order={order} />
      {order.status === 'PENDING' && <p className="hub-order-note">{t(order.paid_at ? requiresCollection(order) ? 'readyForCollection' : 'paymentConfirmed' : 'paymentPending')}</p>}
      {unfinishedCheckout(order) && <p className="hub-muted">{t('checkoutSnapshot')} {t('resumeInfo')}</p>}
      {!!order.paid_at && order.cart_preserved && <p role="status" className="hub-order-note">{t('cartAfterPayment')}</p>}
      {order.status === 'REVIEW_REQUIRED' && <Alert>{t('reviewRequired')}</Alert>}
      {order.status === 'CANCELLED' && <p>{t('cancelledNote')}</p>}
      {error && !action && <Alert>{t(error)}</Alert>}
      <div className="hub-order-actions">{canResumeCheckout(order, now) && <Button variant="primary" disabled={busy || !!readError} onClick={() => void resume()}>{busy ? t('working') : t('continuePayment')}</Button>}{['PENDING', 'REVIEW_REQUIRED'].includes(order.status) && <Button disabled={busy || !!readError} onClick={() => { setError(''); setAction('cancel') }}>{t(unfinishedCheckout(order) ? 'cancelCheckout' : 'cancelOrder')}</Button>}{['COMPLETED', 'CANCELLED'].includes(order.status) && <Button variant="primary" disabled={busy} onClick={reorder}>{t('reorder')}</Button>}<Button disabled={busy} onClick={refresh}>{t('refresh')}</Button></div>
    </>}
    {action && order && <CatalogueModal title={t(action === 'cancel' ? 'cancelOrder' : 'reorder')} close={busy ? undefined : () => setAction(null)}>
      <p>{t(action === 'cancel' ? unfinishedCheckout(order) ? 'cancelCheckoutConfirm' : 'cancelConfirm' : catalogue.cart?.items.length ? 'replaceCartConfirm' : 'reorderConfirm')}</p>
      {action === 'reorder' && <p>{t('collectionTerminal')}: <strong>{order.terminal.display_name}</strong></p>}
      {error && <Alert>{t(error)}</Alert>}
      <div className="hub-order-actions"><Button disabled={busy} onClick={() => setAction(null)}>{t('keep')}</Button><Button variant="primary" disabled={busy || action === 'reorder' && (!catalogue.cart || catalogue.cartError || catalogue.loading)} onClick={() => void act()}>{busy ? t('working') : t('confirm')}</Button></div>
    </CatalogueModal>}
  </section>
}
