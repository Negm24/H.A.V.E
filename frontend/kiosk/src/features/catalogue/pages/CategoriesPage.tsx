import { useNavigate } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { ImagePlaceholder } from '@have/shared/ui/controls'
import { useSession } from '../../session/hooks/use-session'
import { useCatalogue } from '../hooks/use-catalogue'
import { useScrollPosition } from '../hooks/use-scroll-position'
import { CatalogueFrame } from '../components/CatalogueFrame'

export function CategoriesPage() {
  const { t, i18n } = useTranslation('catalogue')
  const { state } = useSession()
  const { categories } = useCatalogue()
  const navigate = useNavigate(), scroll = useScrollPosition('categories')
  return <CatalogueFrame title={t('browse')} back={state.phase === 'customer' ? '/dashboard' : '/guest'}>
    <div className="category-grid catalogue-scroll" {...scroll}>
      {categories.map(category => <button className="category-card" key={category.id} onClick={() => navigate(`/browse/categories/${category.id}`)}>
        <ImagePlaceholder src={category.image_url} label={t('categoryImage')} /><strong>{i18n.language === 'ar' ? category.name_ar : category.name_en}</strong><span>{t('products', { count: category.product_count })}</span>
      </button>)}
      {!categories.length && <p className="catalogue-empty">{t('empty')}</p>}
    </div>
  </CatalogueFrame>
}
