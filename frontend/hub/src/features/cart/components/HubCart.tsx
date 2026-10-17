import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { CartContents, CatalogueModal } from '@have/shared/ui/catalogue'
import { useHubCatalogue } from '../../catalogue/hooks/use-catalogue'
import '../styles/cart.css'
import { useNavigate } from 'react-router-dom'

export function HubCartButton() {
  const { t } = useTranslation('catalogue'), { cart, openCart, cartError, terminal } = useHubCatalogue(), navigate = useNavigate()
  return <Button className="hub-cart-button" onClick={() => terminal ? openCart() : navigate('/browse')}>{cartError || !cart ? t('cart') : t('cartCount', { count: cart.total_quantity })}</Button>
}

export function HubCartModal() {
  const { t } = useTranslation('catalogue'), { t: hub } = useTranslation('hubCatalogue')
  const { t: purchase } = useTranslation('hubPurchase'), navigate = useNavigate()
  const { cartOpen, closeCart, cart, busy, cartError, mutationError, setQuantity, clearCart, refresh } = useHubCatalogue()
  if (!cartOpen) return null
  return <CatalogueModal title={t('cart')} close={closeCart} wide className="hub-cart-modal">
    {cartError ? <Alert>{hub('cartUnavailable')} <Button onClick={() => void refresh()}>{t('retry')}</Button></Alert> : !cart ? <p role="status">{t('loading')}</p> : <>
      {mutationError && <Alert>{mutationError === 'conflict' ? hub('conflict') : mutationError === 'limited' ? hub('limited') : t(mutationError)}</Alert>}
      <p className="hub-cart-notice">{hub('savedCart')}</p>
      <CartContents cart={cart} busy={busy} onQuantity={(id, quantity) => void setQuantity(id, quantity)} onRemove={id => void setQuantity(id, 0)} onContinue={() => { closeCart(); navigate('/checkout') }} continueLabel={purchase('checkout')} notice={purchase('cartNotice')} />
      {!!cart.items.length && <div className="hub-cart-clear"><Button disabled={busy} onClick={() => void clearCart()}>{hub('clearCart')}</Button></div>}
    </>}
  </CatalogueModal>
}
