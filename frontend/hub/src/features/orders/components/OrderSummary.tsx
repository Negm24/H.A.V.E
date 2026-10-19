import { useTranslation } from '@have/shared/i18n'
import type { PurchaseOrder } from '@have/shared/api/purchase'
import { useOrderClock } from '../hooks/use-order-clock'
import { orderStatusLabel, requiresCollection, unfinishedCheckout } from '../services/payment-status'
import { CheckoutDeadline } from './CheckoutDeadline'

export function OrderSummary({ order }: { order: PurchaseOrder }) {
  const { t, i18n } = useTranslation('hubPurchase'), arabic = i18n.language === 'ar'
  const awaiting = requiresCollection(order) && !!order.paid_at && order.status === 'PENDING' && !!order.collection_deadline
  const now = useOrderClock(awaiting || unfinishedCheckout(order))
  const minutes = Math.max(0, Math.ceil((Date.parse(order.collection_deadline ?? '') - now) / 60_000))
  const refundMessage = order.refund_status === 'SUCCEEDED' ? 'refundConfirmed' : order.refund_status === 'FAILED' ? 'refundFailed' : order.refund_status ? 'refundProcessing' : null
  const date = (value: string) => new Date(value).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  return <>
    <div className="hub-order-heading"><div><span className="hub-eyebrow">{t('order')}</span><h1 dir="ltr">{order.order_number}</h1></div><span className={`hub-order-status status-${order.status.toLowerCase()}`}>{t(orderStatusLabel(order))}</span></div>
    <p className="hub-test-banner">{t('testMode')}</p>
    <div className="hub-order-terminal"><strong>{t('collectionTerminal')}: {order.terminal.display_name}</strong><p>{arabic ? order.terminal.address_ar : order.terminal.address_en}</p><small dir="ltr">{order.terminal.serial_number}</small></div>
    <dl className="hub-order-dates"><div><dt>{t('created')}</dt><dd>{date(order.created_at)}</dd></div>
      {!!order.expires_at && !order.paid_at && order.status === 'PENDING' && <div><dt>{t('payBefore')}</dt><dd>{date(order.expires_at)}</dd></div>}
      {!!order.collection_deadline && order.paid_at && !order.completed_at && <div><dt>{t('collectBefore')}</dt><dd>{date(order.collection_deadline)}</dd></div>}
      {!!order.paid_at && <div><dt>{t('paid')}</dt><dd>{date(order.paid_at)}</dd></div>}
      {!!order.completed_at && <div><dt>{t('completed')}</dt><dd>{date(order.completed_at)}</dd></div>}
    </dl>
    {unfinishedCheckout(order) && <CheckoutDeadline expiresAt={order.expires_at} now={now} />}
    {awaiting && <p role="status">{minutes > 0 ? t('collectionRemaining', { hours: Math.floor(minutes / 60), minutes: minutes % 60 }) : t('collectionWindowEnded')}</p>}
    <div className="hub-order-lines">{order.items.map(item => <article className="hub-order-line" key={item.id}><div><strong>{arabic ? item.name_ar : item.name_en}</strong><span>{item.pack_description}</span><small>{item.quantity_requested} × {item.unit_price} {order.currency}</small></div><div><b>{item.line_total} {order.currency}</b>{(item.quantity_dispensed > 0 || order.status === 'COMPLETED' || order.status === 'REVIEW_REQUIRED') && <small>{t('dispensed', { count: item.quantity_dispensed })}</small>}</div></article>)}</div>
    <dl className="hub-order-totals"><div><dt>{t('subtotal')}</dt><dd>{order.subtotal} {order.currency}</dd></div><div><dt>{t('total')}</dt><dd>{order.customer_payable_amount} {order.currency}</dd></div><div><dt>{t('paidAmount')}</dt><dd>{order.total_paid} {order.currency}</dd></div>{Number(order.total_refunded) > 0 && <div><dt>{t('refunded')}</dt><dd>{order.total_refunded} {order.currency}</dd></div>}</dl>
    {refundMessage && <p role="status">{t(refundMessage)}</p>}
    {order.receipt && <section className="hub-order-receipt"><h2>{t('receipt')}</h2><p>{order.receipt.receipt_number}</p><p>{date(order.receipt.issued_at)}</p>{order.email_receipt_to && <p>{t(order.receipt.email_sent_at ? 'emailSent' : 'emailPending')}: <bdi>{order.email_receipt_to}</bdi></p>}</section>}
  </>
}
