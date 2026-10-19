import { useEffect, useRef, type ComponentProps } from 'react'
import { Button } from './button'
import { useTranslation } from '../i18n'

// Visual feedback only: cart ownership, requests and click actions stay in each app.
export function CartButton({ count, revision, className = '', ...props }: ComponentProps<'button'> & { count: number; revision?: string }) {
  const { t } = useTranslation('catalogue')
  const button = useRef<HTMLButtonElement>(null)
  const previous = useRef(revision)
  useEffect(() => {
    const changed = previous.current !== undefined && revision !== undefined && previous.current !== revision
    previous.current = revision
    if (!changed || count <= 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const glow = button.current?.animate?.([
      { boxShadow: '0 0 0 0 transparent' },
      { boxShadow: '0 0 0 6px color-mix(in srgb, var(--color-primary) 24%, transparent), 0 0 24px color-mix(in srgb, var(--color-primary) 45%, transparent)', offset: 0.4 },
      { boxShadow: '0 0 0 10px transparent' },
    ], { duration: 300, easing: 'ease-out' })
    return () => glow?.cancel()
  }, [revision, count])
  const label = props['aria-label'] ?? t('cartCount', { count })
  return <Button {...props} id="cart-button" ref={button} className={`have-cart-button ${className}`} aria-label={label} title={label}>
    <svg className="have-cart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 3h2l2.1 11.3a2 2 0 0 0 2 1.7h8.7a2 2 0 0 0 2-1.6L21 7H6" />
      <path d="M10 10h6M13 7v6" />
      <circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" />
    </svg>
    {count > 0 && <span className="have-cart-badge" aria-hidden="true"><bdi dir="ltr">{count}</bdi></span>}
  </Button>
}
