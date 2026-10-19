import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { hubPurchaseApi, isHostedCheckoutUrl } from '@have/shared/api/purchase'
import { ApiError } from '@have/shared/api'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { Field } from '@have/shared/ui/forms'
import { useSession } from '../../../app/providers'
import { useHubCatalogue } from '../../catalogue/hooks/use-catalogue'
import '../styles/orders.css'

export function CheckoutPage() {
  const { t, i18n } = useTranslation('hubPurchase'), { customer, session } = useSession(), navigate = useNavigate()
  const { terminal, cart, cartError, loading, refresh } = useHubCatalogue()
  const [email, setEmail] = useState(customer?.email ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const key = useRef<{ terminal: string; version: string; id: string } | null>(null), active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  if (!terminal) return <Navigate to="/browse" replace />
  const pay = async (event: FormEvent) => {
    event.preventDefault()
    const retrying = key.current?.version === cart?.version && key.current?.terminal === terminal.serial_number
    if (!cart?.items.length || cart.has_issues && !retrying || busy || cartError) return
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('')
    if (!key.current || key.current.version !== cart.version || key.current.terminal !== terminal.serial_number) key.current = { terminal: terminal.serial_number, version: cart.version, id: crypto.randomUUID() }
    try {
      const result = await session.authorized(token => hubPurchaseApi.checkout(token, { terminal_serial: terminal.serial_number, cart_version: cart.version, email: email.trim(), language: i18n.language === 'ar' ? 'ar' : 'en', print_requested: false, idempotency_key: key.current!.id }, controller.signal))
      if (controller.signal.aborted) return
      if (!result.checkout_url) { navigate(`/orders/${result.order.id}`, { replace: true }); return }
      if (!isHostedCheckoutUrl(result.checkout_url)) { navigate(`/orders/${result.order.id}`, { replace: true, state: { notice: 'unsafeCheckout' } }); return }
      // Kashier alone collects test card information. No PAN/CVV field exists in Hub.
      window.location.assign(result.checkout_url)
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(failure instanceof ApiError && failure.status === 409 ? 'checkoutConflict' : failure instanceof ApiError && failure.status === 503 ? 'paymentUnavailable' : 'checkoutUnconfirmed')
      await refresh()
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <section className="hub-checkout"><Link to="/browse/categories">← {t('backToBrowse')}</Link><h1>{t('checkout')}</h1><p className="hub-test-banner">{t('testMode')}</p>
    <div className="hub-order-terminal"><strong>{t('collectionTerminal')}: {terminal.display_name}</strong><p>{i18n.language === 'ar' ? terminal.address_ar : terminal.address_en}</p><Link to="/browse">{t('changeTerminal')}</Link></div>
    {error && <Alert>{t(error)} <Link to="/orders">{t('history')}</Link></Alert>}
    {cartError && <Alert>{t('cartUnavailable')} <Button onClick={() => void refresh()}>{t('refresh')}</Button></Alert>}
    {loading || !cart ? <p role="status">{t('loading')}</p> : <>
      {!cart.items.length ? <p>{t('emptyCart')}</p> : <div className="hub-checkout-items">{cart.items.map(item => <div key={item.product_id}><span>{i18n.language === 'ar' ? item.product?.name_ar : item.product?.name_en} × {item.quantity}</span><b>{item.line_total} {cart.currency}</b></div>)}</div>}
      {cart.has_issues && <Alert>{t('cartIssues')}</Alert>}
      <form className="hub-form" onSubmit={event => void pay(event)}><Field type="email" label={t('email')} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" dir="ltr" />
        <p className="hub-muted">{t('hostedInfo')}</p><div className="hub-checkout-total"><span>{t('total')}</span><strong>{cart.total} {cart.currency}</strong></div>
        <Button variant="primary" disabled={busy || cartError || !cart.items.length || cart.has_issues && key.current?.version !== cart.version}>{busy ? t('working') : t('payKashier')}</Button>
      </form>
    </>}
  </section>
}
