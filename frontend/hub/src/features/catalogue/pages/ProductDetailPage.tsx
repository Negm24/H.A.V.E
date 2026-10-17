import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { hubCatalogueApi, type CatalogueProduct } from '@have/shared/api/catalogue'
import { Button } from '@have/shared/ui/controls'
import { ImagePlaceholder, QuantityControl, StockBadge } from '@have/shared/ui/catalogue'
import { useSession } from '../../../app/providers'
import { CatalogueLayout } from '../components/CatalogueLayout'
import { useHubCatalogue } from '../hooks/use-catalogue'

export function ProductDetailPage() {
  const { productId } = useParams(), location = useLocation(), { session } = useSession()
  const { t, i18n } = useTranslation('catalogue'), { products, cart, cartError, catalogueError, loading, busy, setQuantity, terminal } = useHubCatalogue()
  const [detail, setDetail] = useState<CatalogueProduct | null>(null), [failed, setFailed] = useState(false), [quantity, setSelected] = useState(1)
  useEffect(() => {
    const controller = new AbortController(); setDetail(null); setFailed(false); setSelected(1)
    void session.authorized(token => hubCatalogueApi.product(token, Number(productId), controller.signal, terminal?.serial_number), true)
      .then(result => { if (!controller.signal.aborted) setDetail(result.product) }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [productId, session, terminal?.serial_number])
  const product = products.find(item => item.id === Number(productId)) ?? (loading || catalogueError ? detail : null)
  const existing = cart?.items.find(item => item.product_id === Number(productId))?.quantity ?? 0
  const limit = Math.max(0, (product?.quantity_limit ?? 0) - existing), selected = Math.min(quantity, Math.max(1, limit)), arabic = i18n.language === 'ar'
  return <CatalogueLayout title={t('details')} back={typeof location.state?.from === 'string' && location.state.from.startsWith('/browse') ? location.state.from : '/browse/categories'}>
    {!product ? <p role="status">{t(failed || !loading && !catalogueError ? 'unavailableProduct' : 'loading')}</p> : <article className="hub-product-detail">
      <ImagePlaceholder className="hub-product-detail-image" src={product.image_url} label={t('image')} />
      <div className="hub-product-copy"><h2>{arabic ? product.name_ar : product.name_en} <bdi>{product.strength}</bdi></h2><p>{product.pack_description}</p>
        <div className="hub-detail-price"><strong>{product.price} {t('currency')}</strong><StockBadge quantity={product.stock_quantity} label={t(product.stock_quantity ? 'left' : 'outOfStock', { count: product.stock_quantity })} /><span className="prescription-badge">{t(product.requires_prescription ? 'prescription' : 'noPrescription')}</span></div>
        <dl><div><dt>{t('ingredient')}</dt><dd>{product.active_ingredient || '—'}</dd></div><div><dt>{t('form')}</dt><dd>{product.dosage_form || '—'}</dd></div></dl>
        <section className="hub-product-instructions"><h3>{t('instructions')}</h3><p>{arabic ? product.usage_instructions_ar : product.usage_instructions_en}</p></section>
        <section className="hub-product-warnings"><h3>{t('warnings')}</h3><p>{(arabic ? product.warnings_ar : product.warnings_en) || '—'}</p></section>
        <div className="hub-detail-actions"><QuantityControl quantity={selected} limit={limit} busy={busy || cartError || !cart} onChange={value => setSelected(Math.max(1, value))} /><Button variant="primary" disabled={busy || cartError || !cart || !limit} onClick={() => void setQuantity(product.id, existing + selected)}>{t('addToCart')}</Button></div>
      </div>
    </article>}
  </CatalogueLayout>
}
