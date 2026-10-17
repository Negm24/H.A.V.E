import type { CatalogueProduct } from '@have/shared/api/terminal'
import { QuantityControl as SharedQuantityControl } from '@have/shared/ui/catalogue'
import { useCatalogue } from '../../catalogue/hooks/use-catalogue'

export function QuantityControl({ product, quantity: override, onChange }: { product: CatalogueProduct; quantity?: number; onChange?: (quantity: number) => void }) {
  const { cart, setQuantity, busy } = useCatalogue()
  const quantity = override ?? cart.items.find(item => item.product_id === product.id)?.quantity ?? 0
  return <SharedQuantityControl quantity={quantity} limit={product.quantity_limit} busy={busy} onChange={onChange || (value => void setQuantity(product.id, value))} />
}
