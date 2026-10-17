import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { terminalPurchaseApi, type PurchaseOrder } from '@have/shared/api/purchase'
import { Alert, Button } from '@have/shared/ui/controls'
import { CatalogueModal } from '@have/shared/ui/catalogue'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'
import { useCatalogue } from '../../catalogue/hooks/use-catalogue'
import { OrderSummary } from '../components/OrderSummary'
import { useOrderOperation } from '../hooks/use-order-operation'
import '../styles/orders.css'

export function OrderDetailPage() {
  const { orderId = '' } = useParams(), navigate = useNavigate(), { t } = useTranslation('orders')
  const { controller, state } = useSession(), { cart, refresh, busy: cartBusy } = useCatalogue()
  const [order, setOrder] = useState<PurchaseOrder | null>(null), [confirm, setConfirm] = useState<'cancel' | 'reorder' | 'collect' | null>(null)
  const { run, busy, error } = useOrderOperation(orderId)
  const warning = state.remaining <= 30
  const load = useCallback(async (preserveError = false) => { const result = await run(() => controller.request((token, signal) => terminalPurchaseApi.detail(token, orderId, signal)), !preserveError); if (result) setOrder(result) }, [controller, orderId, run])
  useEffect(() => { setOrder(null); void load() }, [load])
  useEffect(() => { if (warning) setConfirm(null) }, [warning])
  useEffect(() => {
    if (!order || !['PENDING', 'DISPENSING'].includes(order.status)) return
    const timer = setInterval(() => { if (!document.hidden) void load(true) }, 3_000)
    return () => clearInterval(timer)
  }, [load, order?.status])
  async function act() {
    const action = confirm
    if (!action) return
    setConfirm(null)
    if (action === 'reorder') {
      const result = await run(() => controller.request((token, signal) => terminalPurchaseApi.reorder(token, orderId, cart.version, true, signal)))
      if (result) { await refresh(); navigate('/browse') }
    } else {
      const result = await run(() => controller.request((token, signal) => action === 'cancel' ? terminalPurchaseApi.cancel(token, orderId, signal) : terminalPurchaseApi.collect(token, orderId, signal)))
      if (result) setOrder(result)
      else void load(true)
    }
  }
  const collectible = !!order && order.channel === 'HUB' && !!order.paid_at && order.status === 'PENDING' && (order as PurchaseOrder & { can_collect?: boolean }).can_collect !== false
  return <KioskFrame title={t('details')} back="/profile/orders"><div className="terminal-orders">
    <div className="terminal-orders-toolbar"><h1>{t('details')}</h1><Button disabled={busy} onClick={() => void load()}>{t('refresh')}</Button></div>
    {error && <Alert>{t(error)}</Alert>}
    {!order ? <p role="status">{t('checking')}</p> : <><div className="terminal-order-scroll"><OrderSummary order={order} /></div><div className="terminal-order-actions">
      {order.status === 'PENDING' && <Button disabled={busy} onClick={() => setConfirm('cancel')}>{t('cancel')}</Button>}
      <Button disabled={busy || cartBusy} onClick={() => setConfirm('reorder')}>{t('reorder')}</Button>
      {collectible && <Button variant="primary" disabled={busy} onClick={() => setConfirm('collect')}>{t('collect')}</Button>}
    </div></>}
  </div>{confirm && !warning && <CatalogueModal title={t(confirm === 'cancel' ? 'cancelTitle' : confirm === 'reorder' ? 'reorderTitle' : 'collect')} close={() => setConfirm(null)}><p>{t(confirm === 'cancel' ? 'cancelBody' : confirm === 'reorder' ? 'reorderBody' : 'collectNotice')}</p><div className="terminal-order-confirm"><Button onClick={() => setConfirm(null)}>{t('back')}</Button><Button variant="primary" disabled={busy} onClick={() => void act()}>{t('confirm')}</Button></div></CatalogueModal>}</KioskFrame>
}
