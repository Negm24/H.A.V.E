import { Link } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { ImagePlaceholder } from '@have/shared/ui/catalogue'
import { CatalogueLayout } from '../components/CatalogueLayout'
import { useHubCatalogue } from '../hooks/use-catalogue'

export function CategoriesPage() {
  const { t, i18n } = useTranslation('catalogue'), { t: hub } = useTranslation('hubCatalogue'), { categories, loading, catalogueError } = useHubCatalogue()
  return <CatalogueLayout title={t('browse')} back="/dashboard">
    {loading ? <p role="status">{t('loading')}</p> : categories.length ? <div className="hub-category-grid">{categories.map(category => <Link className="hub-category-card" key={category.id} to={`/browse/categories/${category.id}`}>
      <ImagePlaceholder src={category.image_url} label={t('categoryImage')} /><h2>{i18n.language === 'ar' ? category.name_ar : category.name_en}</h2><span>{t('products', { count: category.product_count })}</span>
    </Link>)}</div> : !catalogueError && <p>{hub('empty')}</p>}
  </CatalogueLayout>
}
