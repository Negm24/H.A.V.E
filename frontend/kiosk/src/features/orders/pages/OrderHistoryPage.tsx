import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { terminalPurchaseApi, type PurchaseOrder } from '@have/shared/api/purchase'
import { Alert, Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'
import { useOrderOperation } from '../hooks/use-order-operation'
import '../styles/orders.css'

export function OrderHistoryPage() {
  const { t } = useTranslation('orders'), navigate = useNavigate(), { controller } = useSession()
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null), { run, busy, error } = useOrderOperation()
  const load = useCallback(async () => { const result = await run(() => controller.request((token, signal) => terminalPurchaseApi.list(token, signal))); if (result) setOrders(result) }, [controller, run])
  useEffect(() => { void load() }, [load])
  return <KioskFrame title={t('history')} back="/profile"><div className="terminal-orders"><div className="terminal-orders-toolbar"><h1>{t('history')}</h1><Button disabled={busy} onClick={() => void load()}>{t('refresh')}</Button></div>
    {error && <Alert>{t(error)}</Alert>}
    {!orders ? <p role="status">{t('checking')}</p> : !orders.length ? <p>{t('noOrders')}</p> : <div className="terminal-order-list">{orders.map(order => <Button className="terminal-order-row" key={order.id} onClick={() => navigate(`/profile/orders/${order.id}`)}><strong><bdi>{order.order_number}</bdi></strong><span>{order.terminal.display_name}</span><span>{t(`statuses.${order.status}`)}</span><b>{order.customer_payable_amount} {t('currency')}</b></Button>)}</div>}
  </div></KioskFrame>
}
