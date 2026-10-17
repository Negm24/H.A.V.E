import { useLocation, useNavigate } from 'react-router-dom'
import { ProductCard } from '@have/shared/ui/catalogue'
import type { CatalogueProduct } from '@have/shared/api/catalogue'
import { useHubCatalogue } from '../hooks/use-catalogue'

export function HubProductCard({ product }: { product: CatalogueProduct }) {
  const { cart, busy, cartError, setQuantity } = useHubCatalogue(), navigate = useNavigate(), location = useLocation()
  return <ProductCard product={product} quantity={cart?.items.find(item => item.product_id === product.id)?.quantity ?? 0}
    busy={busy || cartError || !cart} onOpen={() => navigate(`/browse/products/${product.id}`, { state: { from: location.pathname + location.search } })}
    onQuantity={quantity => void setQuantity(product.id, quantity)} />
}
