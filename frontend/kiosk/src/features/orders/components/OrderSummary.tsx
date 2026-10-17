import { useEffect, useState } from 'react'
import { useTranslation } from '@have/shared/i18n'
import type { PurchaseOrder } from '@have/shared/api/purchase'

export function OrderSummary({ order }: { order: PurchaseOrder }) {
  const { t, i18n } = useTranslation('orders')
  const arabic = i18n.language === 'ar'
  const [now, setNow] = useState(Date.now)
  const awaitingCollection = order.channel === 'HUB' && !!order.paid_at && order.status === 'PENDING' && !!order.collection_deadline
  useEffect(() => {
    if (!awaitingCollection) return
    const clock = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(clock)
  }, [awaitingCollection])
  const minutes = Math.max(0, Math.ceil((Date.parse(order.collection_deadline ?? '') - now) / 60_000))
  const expired = order.cancellation_reason === 'COLLECTION_EXPIRED'
  const refundMessage = order.refund_status === 'SUCCEEDED' ? 'refundConfirmed' : order.refund_status === 'FAILED' ? 'refundFailed' : order.refund_status ? 'refundProcessing' : null
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(arabic ? 'ar-EG' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
  return <div className="terminal-order-summary">
    <div className="terminal-order-heading"><strong><bdi>{order.order_number}</bdi></strong><span className={`order-status order-status-${order.status.toLowerCase()}`}>{t(expired ? 'expired' : `statuses.${order.status}`)}</span></div>
    <dl className="terminal-order-meta"><div><dt>{t('created')}</dt><dd>{date(order.created_at)}</dd></div><div><dt>{t('terminal')}</dt><dd>{order.terminal.display_name} · {arabic ? order.terminal.address_ar : order.terminal.address_en}</dd></div><div><dt>{t('email')}</dt><dd><bdi>{order.email_receipt_to}</bdi></dd></div>{order.collection_deadline && <div><dt>{t('collectionBy')}</dt><dd>{date(order.collection_deadline)}{awaitingCollection && <span className="terminal-collection-remaining">{minutes > 0 ? t('collectionRemaining', { hours: Math.floor(minutes / 60), minutes: minutes % 60 }) : t('collectionWindowEnded')}</span>}</dd></div>}</dl>
    <div className="terminal-order-lines">{order.items.map(item => <article key={item.id}><strong>{arabic ? item.name_ar : item.name_en}</strong><span>{item.pack_description}</span><span>{t('requested')}: {item.quantity_requested} · {t('dispensed')}: {item.quantity_dispensed}</span><b>{item.line_total} {t('currency')}</b></article>)}</div>
    <div className="terminal-order-totals"><span>{t('total')}: <b>{order.customer_payable_amount} {t('currency')}</b></span><span>{t('paid')}: <b>{order.total_paid} {t('currency')}</b></span>{Number(order.total_refunded) > 0 && <span>{t('refunded')}: <b>{order.total_refunded} {t('currency')}</b></span>}</div>
    {refundMessage && <p role="status" className={`terminal-refund-notice ${order.refund_status === 'FAILED' ? 'terminal-refund-review' : ''}`}>{t(refundMessage)}</p>}
    {order.receipt ? <section className="terminal-receipt"><strong>{t('receipt')}: <bdi>{order.receipt.receipt_number}</bdi></strong><span>{date(order.receipt.issued_at)}</span><p>{t(order.receipt.email_sent_at ? 'emailSent' : 'emailPending')}</p>{order.print_requested && <p>{t('printStub')}</p>}</section> : <p>{t('receiptPending')}</p>}
    <p className="terminal-order-simulation">{t('simulation')}</p>
  </div>
}
