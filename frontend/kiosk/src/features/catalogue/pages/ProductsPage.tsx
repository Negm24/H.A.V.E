import { useParams } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { useCatalogue } from '../hooks/use-catalogue'
import { useScrollPosition } from '../hooks/use-scroll-position'
import { sortProducts } from '../services/discovery'
import { CatalogueFrame } from '../components/CatalogueFrame'
import { ProductCard } from '../components/ProductCard'
import { PriceSort } from '../components/PriceSort'

export function ProductsPage() {
  const { categoryId } = useParams()
  const { t, i18n } = useTranslation('catalogue')
  const { products, categories, descending, setDescending } = useCatalogue()
  const category = categories.find(item => item.id === Number(categoryId))
  const items = sortProducts(products.filter(item => item.category_id === Number(categoryId)), descending)
  const scroll = useScrollPosition(`category:${categoryId}`)
  return <CatalogueFrame title={category ? (i18n.language === 'ar' ? category.name_ar : category.name_en) : t('browse')} back="/browse" controls={<PriceSort descending={descending} toggle={() => setDescending(value => !value)} />}>
    <div className="product-grid catalogue-scroll" {...scroll}>{items.map(product => <ProductCard product={product} key={product.id} />)}{!items.length && <p className="catalogue-empty">{t('empty')}</p>}</div>
  </CatalogueFrame>
}
