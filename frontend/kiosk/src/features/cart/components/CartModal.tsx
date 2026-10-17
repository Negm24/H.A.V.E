import { useTranslation } from '@have/shared/i18n'
import { CartContents, CatalogueModal } from '@have/shared/ui/catalogue'
import { useCatalogue } from '../../catalogue/hooks/use-catalogue'
import { useNavigate } from 'react-router-dom'

export function CartModal({ close }: { close: () => void }) {
  const { t } = useTranslation('catalogue')
  const { t: orders } = useTranslation('orders'), navigate = useNavigate()
  const { cart, setQuantity, busy } = useCatalogue()
  return <CatalogueModal wide title={t('cart')} close={close}>
    <CartContents cart={cart} busy={busy} onQuantity={(id, quantity) => void setQuantity(id, quantity)} onRemove={id => void setQuantity(id, 0)} onContinue={() => { close(); navigate('/checkout') }} continueLabel={orders('continue')} notice={orders('cartNotice')} />
  </CatalogueModal>
}
