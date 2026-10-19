import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { useCheckoutAttempt } from '../hooks/use-checkout-attempt'
import { CheckoutRecovery } from '../components/CheckoutRecovery'
import { OrderSummary } from '../components/OrderSummary'
import { isUnfinishedCheckout } from '../services/order-presentation'

export function CheckoutPage() {
  const { t, i18n } = useTranslation('orders')
  const { controller, state } = useSession(), { cart, busy: cartBusy, ready, cartAvailable, refresh } = useCatalogue()
  const { attempt, begin, update, clear } = useCheckoutAttempt(), navigate = useNavigate()
  const reviewedCart = attempt?.basket ?? cart
  const [email, setEmail] = useState(attempt?.input.email ?? state.customer?.email ?? ''), [review, setReview] = useState(state.phase === 'customer' || !!attempt), [print, setPrint] = useState(true)
  const { run, error, busy } = useOrderOperation(`${state.phase}:${state.customer?.id ?? ''}`, 'paymentUnavailable')
  const guest = state.phase === 'guest'
  async function checkout() {
    const result = await run(async () => {
      const pending = begin({ cart_version: cart.version, email: email.trim(), language: i18n.language === 'ar' ? 'ar' : 'en', print_requested: guest || print, return_simulator_id: new URLSearchParams(window.location.search).get('terminal') ?? undefined }, cart)
      let response
      try { response = await controller.request((token, signal) => terminalPurchaseApi.checkout(token, pending.input, signal)) }
      catch (failure) {
        // This explicit server rejection proves no attempt was started. Let the
        // user review the refreshed basket and submit a fresh request manually.
        if (failure instanceof ApiError && failure.code === 'CART_CHANGED') { clear(); await refresh() }
        throw failure
      }
      update(response.order)
      if (response.checkout_url && !isHostedCheckoutUrl(response.checkout_url)) throw new ApiError('Invalid hosted payment URL.', 503)
      return response
    })
    if (result?.checkout_url) window.location.assign(result.checkout_url)
  }
  return <KioskFrame title={t('checkout')} back="/browse"><div className="terminal-checkout">
    {attempt?.order ? <><div className="terminal-order-scroll"><OrderSummary order={attempt.order} />{isUnfinishedCheckout(attempt.order) && <CheckoutRecovery order={attempt.order} updated={update} />}</div>{error && <Alert>{t(error)}</Alert>}{!isUnfinishedCheckout(attempt.order) && <Button onClick={() => { clear(); void refresh(); navigate('/browse') }}>{t('back')}</Button>}</> : !ready && !attempt ? <p role="status">{t('cartLoading')}</p> : !cartAvailable && !attempt ? <><Alert>{t('cartReadFailed')}</Alert><Button onClick={() => void refresh()}>{t('refresh')}</Button></> : !reviewedCart.items.length ? <p>{t('empty')}</p> : !review ? <div className="checkout-email-stage"><p>{t('emailRequired')}</p><form onSubmit={event => { event.preventDefault(); setReview(true) }}><label>{t('receiptEmail')}<input aria-label={t('receiptEmail')} value={email} onChange={event => setEmail(event.target.value)} type="email" required maxLength={254} dir="ltr" autoFocus autoComplete="off" /></label><Button type="submit" variant="primary">{t('reviewPay')}</Button></form><SearchKeyboard email label={t('emailKeyboard')} maxLength={254} value={email} change={setEmail} /></div> : <>
      <div className="checkout-review"><section><h1>{t('reviewPay')}</h1><p>{t('paymentNotice')}</p>{attempt && <p role="status">{t('checkoutUncertainDraft')}</p>}<div className="checkout-items">{reviewedCart.items.map(line => <div key={line.product_id}><strong>{line.product ? i18n.language === 'ar' ? line.product.name_ar : line.product.name_en : '—'}</strong><bdi>× {line.quantity}</bdi><b>{line.line_total} {t('currency')}</b></div>)}</div></section><aside><label>{t('receiptEmail')}<input aria-label={t('receiptEmail')} type="email" value={attempt?.input.email ?? email} readOnly dir="ltr" /></label>{guest ? <><p>{t('guestPrint')}</p><Button disabled={!!attempt} onClick={() => setReview(false)}>{t('changeEmail')}</Button></> : <fieldset disabled={!!attempt}><legend>{t('receipt')}</legend><label><input type="radio" name="receipt-print" checked={attempt?.input.print_requested ?? print} onChange={() => setPrint(true)} />{t('print')}</label><label><input type="radio" name="receipt-print" checked={!(attempt?.input.print_requested ?? print)} onChange={() => setPrint(false)} />{t('green')}</label></fieldset>}<p>{t('receiptNotice')}</p><strong className="checkout-total">{t('total')}: {reviewedCart.total} {t('currency')}</strong></aside></div>
      {error && <Alert>{t(error)}</Alert>}
      <Button variant="primary" disabled={busy || !attempt && (cartBusy || cart.has_issues)} onClick={() => void checkout()}>{t('pay')}</Button>
      {!!error && !guest && <Button onClick={() => navigate('/profile/orders')}>{t('viewExistingCheckout')}</Button>}
    </>}
  </div></KioskFrame>
}
