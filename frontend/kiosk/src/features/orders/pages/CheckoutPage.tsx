import { useRef, useState } from 'react'
import { ApiError } from '@have/shared/api'
import { useTranslation } from '@have/shared/i18n'
import { terminalPurchaseApi, isHostedCheckoutUrl } from '@have/shared/api/purchase'
import { Alert, Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'
import { useCatalogue } from '../../catalogue/hooks/use-catalogue'
import { SearchKeyboard } from '../../catalogue/components/SearchKeyboard'
import '../../catalogue/styles/catalogue.css'
import '../styles/orders.css'
import { useOrderOperation } from '../hooks/use-order-operation'

export function CheckoutPage() {
  const { t, i18n } = useTranslation('orders')
  const { controller, state } = useSession(), { cart, busy: cartBusy } = useCatalogue()
  const [email, setEmail] = useState(state.customer?.email ?? ''), [review, setReview] = useState(state.phase === 'customer'), [print, setPrint] = useState(true)
  const key = useRef(crypto.randomUUID()), { run, error, busy } = useOrderOperation('', 'paymentUnavailable')
  const attemptedVersion = useRef<string | null>(null)
  const guest = state.phase === 'guest'
  async function checkout() {
    const result = await run(async () => {
      attemptedVersion.current = cart.version
      const response = await controller.request((token, signal) => terminalPurchaseApi.checkout(token, { cart_version: cart.version, email: email.trim(), language: i18n.language === 'ar' ? 'ar' : 'en', print_requested: guest || print, idempotency_key: key.current, return_simulator_id: new URLSearchParams(window.location.search).get('terminal') ?? undefined }, signal))
      if (!isHostedCheckoutUrl(response.checkout_url)) throw new ApiError('Invalid hosted payment URL.', 503)
      return response
    })
    if (result) window.location.assign(result.checkout_url)
  }
  return <KioskFrame title={t('checkout')} back="/browse"><div className="terminal-checkout">
    {!cart.items.length ? <p>{t('empty')}</p> : !review ? <div className="checkout-email-stage"><p>{t('emailRequired')}</p><form onSubmit={event => { event.preventDefault(); setReview(true) }}><label>{t('receiptEmail')}<input aria-label={t('receiptEmail')} value={email} onChange={event => setEmail(event.target.value)} type="email" required maxLength={254} dir="ltr" autoFocus autoComplete="off" /></label><Button type="submit" variant="primary">{t('reviewPay')}</Button></form><SearchKeyboard email label={t('emailKeyboard')} maxLength={254} value={email} change={setEmail} /></div> : <>
      <div className="checkout-review"><section><h1>{t('reviewPay')}</h1><p>{t('paymentNotice')}</p><div className="checkout-items">{cart.items.map(line => <div key={line.product_id}><strong>{line.product ? i18n.language === 'ar' ? line.product.name_ar : line.product.name_en : '—'}</strong><bdi>× {line.quantity}</bdi><b>{line.line_total} {t('currency')}</b></div>)}</div></section><aside><label>{t('receiptEmail')}<input aria-label={t('receiptEmail')} type="email" value={email} readOnly dir="ltr" /></label>{guest ? <><p>{t('guestPrint')}</p><Button onClick={() => setReview(false)}>{t('changeEmail')}</Button></> : <fieldset><legend>{t('receipt')}</legend><label><input type="radio" name="receipt-print" checked={print} onChange={() => setPrint(true)} />{t('print')}</label><label><input type="radio" name="receipt-print" checked={!print} onChange={() => setPrint(false)} />{t('green')}</label></fieldset>}<p>{t('receiptNotice')}</p><strong className="checkout-total">{t('total')}: {cart.total} {t('currency')}</strong></aside></div>
      {error && <Alert>{t(error)}</Alert>}
      <Button variant="primary" disabled={busy || cartBusy || cart.has_issues && attemptedVersion.current !== cart.version} onClick={() => void checkout()}>{t('pay')}</Button>
    </>}
  </div></KioskFrame>
}
