import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { hubPurchaseApi, type PurchaseOrder } from '@have/shared/api/purchase'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { useSession } from '../../../app/providers'
import '../styles/orders.css'

export function OrderHistoryPage() {
  const { t, i18n } = useTranslation('hubPurchase'), { session } = useSession()
  const [orders, setOrders] = useState<PurchaseOrder[]>([]), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [attempt, retry] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setFailed(false)
    void session.authorized(token => hubPurchaseApi.list(token, controller.signal), true)
      .then(result => { if (!controller.signal.aborted) setOrders(result) }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [session, attempt])
  return <section className="hub-orders"><Link to="/profile">← {t('profile')}</Link><h1>{t('history')}</h1><p className="hub-test-banner">{t('testMode')}</p>
    {failed && <Alert>{t('unavailable')} <Button onClick={() => retry(value => value + 1)}>{t('refresh')}</Button></Alert>}
    {loading ? <p role="status">{t('loading')}</p> : !failed && !orders.length ? <p>{t('emptyOrders')}</p> : <div className="hub-order-list">{orders.map(order => <Link className="hub-order-card" key={order.id} to={`/orders/${order.id}`}>
      <div><strong dir="ltr">{order.order_number}</strong><span>{new Date(order.created_at).toLocaleDateString(i18n.language)}</span></div><span className={`hub-order-status status-${order.status.toLowerCase()}`}>{t(order.cancellation_reason === 'COLLECTION_EXPIRED' ? 'expired' : `statuses.${order.status}`)}</span><p>{order.terminal.display_name}</p><div><span>{t('items', { count: order.items.reduce((total, item) => total + item.quantity_requested, 0) })}</span><b>{order.customer_payable_amount} {order.currency}</b></div>
    </Link>)}</div>}
  </section>
}
