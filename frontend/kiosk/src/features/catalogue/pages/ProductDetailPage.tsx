import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { Button, ImagePlaceholder, StockBadge } from '@have/shared/ui/controls'
import { terminalApi } from '@have/shared/api/terminal'
import { useSession } from '../../session/hooks/use-session'
import { useCatalogue } from '../hooks/use-catalogue'
import { CatalogueFrame } from '../components/CatalogueFrame'

export function ProductDetailPage() {
  const { productId } = useParams(), location = useLocation()
  const { t, i18n } = useTranslation('catalogue')
  const { controller } = useSession()
  const { products, cart, setQuantity, busy, ready } = useCatalogue()
  const product = products.find(item => item.id === Number(productId))
  const [quantity, selectQuantity] = useState(1)
  const [failed, setFailed] = useState(false)
  const [detail, setDetail] = useState<typeof product>()
  useEffect(() => {
    let current = true
    void controller.request((token, signal) => terminalApi.product(token, Number(productId), signal)).then(value => { if (current) setDetail(value) }).catch(() => { if (current) setFailed(true) })
    return () => { current = false }
  }, [controller, productId])
  const item = ready ? product : detail
  const arabic = i18n.language === 'ar'
  const name = item ? (arabic ? item.name_ar : item.name_en) : ''
  const existing = cart.items.find(line => line.product_id === Number(productId))?.quantity || 0
  const limit = Math.max(0, (item?.quantity_limit || 0) - existing)
  return <CatalogueFrame title={t('details')} back={location.state?.from?.startsWith('/browse') ? location.state.from : '/browse'}>
    {!item || failed ? <p className="catalogue-empty">{t('unavailableProduct')}</p> : <div className="product-detail">
      <ImagePlaceholder className="product-detail-image" src={item.image_url} label={t('image')} />
      <div className="product-detail-main"><div className="product-detail-copy catalogue-scroll"><h1>{name} <bdi>{item.strength}</bdi></h1><p>{item.pack_description}</p>
        <div className="detail-price"><b>{item.price} {t('currency')}</b><StockBadge quantity={item.stock_quantity} label={item.stock_quantity ? t('left', { count: item.stock_quantity }) : t('outOfStock')} /><span className="prescription-badge">{t(item.requires_prescription ? 'prescription' : 'noPrescription')}</span></div>
        <dl><dt>{t('ingredient')}</dt><dd>{item.active_ingredient || '—'}</dd><dt>{t('form')}</dt><dd>{item.dosage_form || '—'}</dd></dl>
        <section className="product-instructions"><h3>{t('instructions')}</h3><p>{arabic ? item.usage_instructions_ar : item.usage_instructions_en}</p></section>
        <section className="product-warnings"><h3>{t('warnings')}</h3><p>{(arabic ? item.warnings_ar : item.warnings_en) || '—'}</p></section>
      </div><div className="detail-actions"><div className="quantity-control"><Button aria-label={t('decrease')} disabled={quantity <= 1} onClick={() => selectQuantity(q => q - 1)}>−</Button><output>{Math.min(quantity, Math.max(1, limit))}</output><Button aria-label={t('increase')} disabled={quantity >= limit} onClick={() => selectQuantity(q => q + 1)}>+</Button></div><Button variant="primary" disabled={busy || limit === 0} onClick={() => void setQuantity(item.id, existing + Math.min(quantity, limit))}>{t('addToCart')}</Button></div></div>
    </div>}
  </CatalogueFrame>
}
