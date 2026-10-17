import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { PriceSort } from '@have/shared/ui/catalogue'
import { sortProducts } from '@have/shared/catalogue/discovery'
import { CatalogueLayout } from '../components/CatalogueLayout'
import { HubProductCard } from '../components/HubProductCard'
import { useHubCatalogue } from '../hooks/use-catalogue'

export function ProductsPage() {
  const { categoryId } = useParams(), { t, i18n } = useTranslation('catalogue'), { t: hub } = useTranslation('hubCatalogue'), { categories, products, loading, catalogueError } = useHubCatalogue()
  const [descending, setDescending] = useState(false), category = categories.find(item => item.id === Number(categoryId))
  const items = sortProducts(products.filter(item => item.category_id === Number(categoryId)), descending)
  return <CatalogueLayout title={category ? i18n.language === 'ar' ? category.name_ar : category.name_en : t('browse')}>
    <div className="hub-product-toolbar"><p>{t('products', { count: items.length })}</p><PriceSort descending={descending} toggle={() => setDescending(value => !value)} /></div>
    {loading ? <p role="status">{t('loading')}</p> : items.length ? <div className="hub-product-grid">{items.map(product => <HubProductCard key={product.id} product={product} />)}</div> : !catalogueError && <p>{hub('empty')}</p>}
  </CatalogueLayout>
}
