import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { terminalPurchaseApi, type PurchaseOrder } from '@have/shared/api/purchase'
import { Alert, Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'
import { useOrderOperation } from '../hooks/use-order-operation'
import { CheckoutRecovery } from '../components/CheckoutRecovery'
import { isUnfinishedCheckout } from '../services/order-presentation'
import { useCollectionSummary } from '../hooks/use-collection-summary'
import '../styles/orders.css'

export function OrderHistoryPage() {
  const { t } = useTranslation('orders'), navigate = useNavigate(), { controller, state } = useSession()
  const { refresh: refreshSummary } = useCollectionSummary()
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null), { run, busy, error } = useOrderOperation(state.customer?.id)
  const load = useCallback(async () => { const result = await run(() => controller.request((token, signal) => terminalPurchaseApi.list(token, signal))); if (result) setOrders(result) }, [controller, run])
  useEffect(() => {
    void load()
    const visible = () => { if (!document.hidden) void load() }
    const timer = setInterval(visible, 15_000)
    document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible) }
  }, [load])
  const updated = (value: PurchaseOrder) => { setOrders(previous => previous?.map(order => order.id === value.id ? value : order) ?? null); void refreshSummary() }
  const row = (order: PurchaseOrder) => <Button className="terminal-order-row" onClick={() => navigate(`/profile/orders/${order.id}`)}><strong><bdi>{order.order_number}</bdi></strong><span>{order.terminal.display_name}</span><span>{t(order.payment_state === 'CHECKING_PAYMENT' ? 'checkingPayment' : isUnfinishedCheckout(order) ? 'awaitingPayment' : `statuses.${order.status}`)}</span><b>{order.customer_payable_amount} {t('currency')}</b></Button>
  return <KioskFrame title={t('history')} back="/profile"><div className="terminal-orders"><div className="terminal-orders-toolbar"><h1>{t('history')}</h1><Button disabled={busy} onClick={() => void load()}>{t('refresh')}</Button></div>
    {error && <Alert>{t(error)}</Alert>}
    {!orders ? <p role="status">{t('checking')}</p> : !orders.length ? <p>{t('noOrders')}</p> : <div className="terminal-order-list">
      {orders.some(isUnfinishedCheckout) && <section className="terminal-unfinished"><h2>{t('unfinished')}</h2>{orders.filter(isUnfinishedCheckout).map(order => <article key={order.id}>{row(order)}<CheckoutRecovery order={order} updated={updated} /></article>)}</section>}
      {orders.filter(order => !isUnfinishedCheckout(order)).map(order => <div key={order.id}>{row(order)}</div>)}
    </div>}
  </div></KioskFrame>
}
