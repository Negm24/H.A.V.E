import { useLocation, useNavigate } from 'react-router-dom'
import { ProductCard as SharedProductCard } from '@have/shared/ui/catalogue'
import type { CatalogueProduct } from '@have/shared/api/terminal'
import { useCatalogue } from '../hooks/use-catalogue'

export function ProductCard({ product }: { product: CatalogueProduct }) {
  const navigate = useNavigate(), location = useLocation()
  const { cart, busy, setQuantity } = useCatalogue()
  return <SharedProductCard product={product} quantity={cart.items.find(item => item.product_id === product.id)?.quantity ?? 0} busy={busy}
    onOpen={() => navigate(`/browse/products/${product.id}`, { state: { from: location.pathname + location.search } })}
    onQuantity={quantity => void setQuantity(product.id, quantity)} />
}
