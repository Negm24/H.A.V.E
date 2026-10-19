import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from '../i18n'
import { Button } from './button'
import type { CatalogueProduct } from '../api/catalogue'
import type { CustomerCart } from '../api/cart'
export { CartButton } from './cart-button'

export function ImagePlaceholder({ src, label, className = '' }: { src?: string | null; label: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return <div className={`have-image-placeholder ${className}`}>{src && !failed ? <img src={src} alt={label} onError={() => setFailed(true)} /> : <><span aria-hidden="true">✚</span><span>{label}</span></>}</div>
}
export function StockBadge({ quantity, label }: { quantity: number; label: string }) {
  return <span className={`have-stock ${quantity === 0 ? 'empty' : quantity <= 5 ? 'low' : 'available'}`}>{label}</span>
}

// Presentation only: the calling app supplies its session-scoped state/actions.
export function QuantityControl({ quantity, limit, busy = false, onChange }: { quantity: number; limit: number; busy?: boolean; onChange: (quantity: number) => void }) {
  const { t } = useTranslation('catalogue')
  const previous = useRef(quantity)
  const [animating, setAnimating] = useState(false)
  useEffect(() => {
    const animate = previous.current === 0 && quantity > 0
    previous.current = quantity
    setAnimating(animate)
    const timer = animate ? setTimeout(() => setAnimating(false), 250) : undefined
    return () => clearTimeout(timer)
  }, [quantity])
  return <div className={`quantity-control ${quantity > 0 ? 'has-quantity' : ''} ${animating ? 'is-animating' : ''}`} onClick={event => event.stopPropagation()}>
    {quantity === 0 ? <Button variant="primary" disabled={busy || limit === 0} onClick={() => onChange(1)}>{t('add')}</Button> : <>
      <Button aria-label={t('decrease')} disabled={busy} onClick={() => onChange(Math.max(0, quantity - 1))}>−</Button>
      <output aria-live="polite">{quantity}</output>
      <Button aria-label={t('increase')} disabled={busy || quantity >= limit} onClick={() => onChange(quantity + 1)}>+</Button>
    </>}
  </div>
}

export function PriceSort({ descending, toggle }: { descending: boolean; toggle: () => void }) {
  const { t } = useTranslation('catalogue')
  return <button className={`price-sort ${descending ? 'descending' : ''}`} onClick={toggle} aria-label={t('sortPrice')} aria-pressed={descending}>
    <span className="price-sort-orbit" aria-hidden="true">↗</span><span>{t(descending ? 'highLow' : 'lowHigh')}</span>
  </button>
}

export function ProductCard({ product, quantity, busy = false, onOpen, onQuantity }: { product: CatalogueProduct; quantity: number; busy?: boolean; onOpen: () => void; onQuantity: (quantity: number) => void }) {
  const { t, i18n } = useTranslation('catalogue')
  const name = i18n.language === 'ar' ? product.name_ar : product.name_en
  return <article className="product-card" data-product-id={product.id}>
    <button className="product-open" onClick={onOpen}>
      <ImagePlaceholder src={product.image_url} label={t('image')} />
      <strong title={name}>{name} <bdi>{product.strength}</bdi></strong>
      <span className="product-pack">{product.pack_description}</span>
      {product.requires_prescription && <span className="prescription-badge">{t('prescription')}</span>}
    </button>
    <div className="product-price"><b>{product.price} <small>{t('currency')}</small></b><StockBadge quantity={product.stock_quantity} label={product.stock_quantity ? t('left', { count: product.stock_quantity }) : t('outOfStock')} /></div>
    <QuantityControl quantity={quantity} limit={product.quantity_limit} busy={busy} onChange={onQuantity} />
  </article>
}

export function CatalogueModal({ title, close, children, wide = false, className = '' }: { title: string; close?: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { t } = useTranslation('catalogue')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return <dialog ref={ref} className={`catalogue-modal ${wide ? 'wide' : ''} ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); close?.() }}>
    <div className="catalogue-modal-heading"><h2>{title}</h2>{close && <Button onClick={close}>{t('close')}</Button>}</div>
    {children}
  </dialog>
}

export function GuidanceModal({ close }: { close: () => void }) {
  const { t } = useTranslation('catalogue')
  return <CatalogueModal title={t('help')} close={close}><p>{t('guidanceLater')}</p>
    <div className="guidance-skeleton" aria-hidden="true"><div /><div /><div /><div /></div>
  </CatalogueModal>
}

export function CartContents({ cart, busy = false, onQuantity, onRemove, onContinue, continueDisabled = false, continueLabel, notice }: { cart: CustomerCart; busy?: boolean; onQuantity: (id: number, quantity: number) => void; onRemove: (id: number) => void; onContinue?: () => void; continueDisabled?: boolean; continueLabel?: string; notice?: string }) {
  const { t, i18n } = useTranslation('catalogue')
  const name = (product: { name_en: string; name_ar: string }) => i18n.language === 'ar' ? product.name_ar : product.name_en
  return <div className="cart-layout"><div className="cart-items">
    {!cart.items.length && <p className="catalogue-empty">{t('emptyCart')}</p>}
    {cart.items.map(item => <article className="cart-line" key={item.product_id}>
      <ImagePlaceholder src={item.product?.image_url} label={t('image')} />
      <div className="cart-line-info"><strong>{item.product ? name(item.product) : t('unavailableProduct')}</strong><span>{item.product?.pack_description}</span><span>{item.unit_price} {t('currency')} · {t('each')}</span>
        {!!item.issues.length && <p className="catalogue-issue">{t('stockIssue')}</p>}
      </div>
      <div className="cart-line-actions"><QuantityControl quantity={item.quantity} limit={item.product?.quantity_limit ?? 0} busy={busy} onChange={quantity => onQuantity(item.product_id, quantity)} /><strong>{item.line_total} {t('currency')}</strong>
        <Button disabled={busy} onClick={() => onRemove(item.product_id)}>{t('remove')}</Button>
      </div>
    </article>)}
  </div><aside className="cart-summary"><h3>{t('summary')}</h3><div><span>{t('items', { count: cart.total_quantity })}</span><b>{cart.total_quantity}</b></div>
    <div><span>{t('subtotal')}</span><b>{cart.subtotal} {t('currency')}</b></div><hr />
    <div className="cart-grand-total"><span>{t('total')}</span><b>{cart.total} {t('currency')}</b></div>
    <p>{notice ?? t('noReservation')}</p><div className="cart-future"><Button variant="primary" disabled={!onContinue || continueDisabled || busy || !cart.items.length || cart.has_issues} onClick={onContinue}>{continueLabel ?? t('continueLater')}</Button><Button disabled>{t('insuranceLater')}</Button></div>
  </aside></div>
}
