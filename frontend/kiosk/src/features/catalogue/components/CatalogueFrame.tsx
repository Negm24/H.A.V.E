import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { Button, Alert } from '@have/shared/ui/controls'
import { CartButton } from '@have/shared/ui/catalogue'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'
import { useCatalogue } from '../hooks/use-catalogue'
import { CartModal } from '../../cart/components/CartModal'
import { GuidanceModal } from '../../guidance/components/GuidanceModal'
import '../styles/catalogue.css'

export function CatalogueFrame({ title, back, children, search = true, controls }: { title: string; back: string; children: ReactNode; search?: boolean; controls?: ReactNode }) {
  const { t } = useTranslation('catalogue')
  const { state } = useSession()
  const { cart, error, ready, refresh, cartAvailable } = useCatalogue()
  const [modal, setModal] = useState<'cart' | 'guidance' | null>(null)
  const navigate = useNavigate(), location = useLocation()
  const warning = state.remaining <= 30
  useEffect(() => { if (warning) setModal(null) }, [warning])
  return <KioskFrame title={title} back={back}><div className="catalogue-shell">
    <div className="catalogue-toolbar"><span className="catalogue-demo">{t('demo')}</span>
      {controls}
      <Button onClick={() => setModal('guidance')}>{t('help')}</Button>
      {search && <Button aria-label={t('search')} onClick={() => navigate('/browse/search', { state: { from: location.pathname } })}>⌕ {t('search')}</Button>}
      <CartButton count={cart.total_quantity} revision={cartAvailable ? cart.version : undefined} disabled={!cartAvailable} onClick={() => setModal('cart')} />
    </div>
    {error && <div className="catalogue-error"><Alert>{t(error)}</Alert><Button onClick={() => void refresh()}>{t('retry')}</Button></div>}
    {!ready ? <div className="catalogue-empty" role="status">{t('loading')}</div> : children}
  </div>
    {!warning && modal === 'cart' && <CartModal close={() => setModal(null)} />}
    {!warning && modal === 'guidance' && <GuidanceModal close={() => setModal(null)} />}
  </KioskFrame>
}
