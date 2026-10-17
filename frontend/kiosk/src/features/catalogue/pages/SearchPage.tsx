import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { Button, ImagePlaceholder, StockBadge } from '@have/shared/ui/controls'
import { useCatalogue } from '../hooks/use-catalogue'
import { matches } from '../services/discovery'
import { CatalogueFrame } from '../components/CatalogueFrame'
import { SearchKeyboard } from '../components/SearchKeyboard'
import { QuantityControl } from '../../cart/components/QuantityControl'
import { useScrollPosition } from '../hooks/use-scroll-position'

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase())
  if (!query.trim() || index < 0) return <>{text}</>
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.trim().length)}</mark>{text.slice(index + query.trim().length)}</>
}
export function SearchPage() {
  const { t, i18n } = useTranslation('catalogue')
  const { products, searchText: query, setSearchText } = useCatalogue()
  const navigate = useNavigate(), location = useLocation()
  const results = products.filter(product => matches(product, query))
  const scroll = useScrollPosition('search')
  const change = (text: string) => setSearchText(text.slice(0, 100))
  return <CatalogueFrame title={t('search')} back={location.state?.from?.startsWith('/browse') ? location.state.from : '/browse'} search={false}>
    <div className="search-page"><label className="catalogue-search"><span aria-hidden="true">⌕</span><input autoFocus aria-label={t('search')} placeholder={t('searchPlaceholder')} value={query} maxLength={100} onChange={e => change(e.target.value)} /><Button aria-label={t('clearSearch')} onClick={() => change('')}>×</Button></label>
      <div className="search-count" aria-live="polite">{t('matches', { count: results.length })}</div>
      <div className="search-results catalogue-scroll" {...scroll}>{results.map(product => <article className="search-result" key={product.id}>
        <button className="search-result-open" onClick={() => navigate(`/browse/products/${product.id}`, { state: { from: location.pathname + location.search } })}><ImagePlaceholder src={product.image_url} label={t('image')} /><div><strong><Highlight text={i18n.language === 'ar' ? product.name_ar : product.name_en} query={query} /> <bdi>{product.strength}</bdi></strong><span>{product.pack_description}</span></div></button>
        <StockBadge quantity={product.stock_quantity} label={product.stock_quantity ? t('left', { count: product.stock_quantity }) : t('outOfStock')} /><b>{product.price} {t('currency')}</b><QuantityControl product={product} />
      </article>)}{!results.length && <p className="catalogue-empty">{t('noMatches')}</p>}</div>
      <SearchKeyboard value={query} change={change} />
    </div>
  </CatalogueFrame>
}
