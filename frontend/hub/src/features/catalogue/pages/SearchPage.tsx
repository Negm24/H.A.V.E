import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { PriceSort } from '@have/shared/ui/catalogue'
import { matches, sortProducts } from '@have/shared/catalogue/discovery'
import { CatalogueLayout } from '../components/CatalogueLayout'
import { HubProductCard } from '../components/HubProductCard'
import { useHubCatalogue } from '../hooks/use-catalogue'

export function SearchPage() {
  const { t } = useTranslation('catalogue'), { products, loading } = useHubCatalogue()
  const [params, setParams] = useSearchParams(), [descending, setDescending] = useState(false)
  const query = params.get('q') ?? '', items = sortProducts(products.filter(product => matches(product, query)), descending)
  return <CatalogueLayout title={t('search')}>
    <div className="hub-catalogue-search"><label htmlFor="hub-product-search">{t('searchPlaceholder')}</label><div><span aria-hidden="true">⌕</span><input autoFocus id="hub-product-search" type="search" autoComplete="off" value={query} onChange={event => setParams(event.target.value ? { q: event.target.value } : {}, { replace: true })} /><Button disabled={!query} aria-label={t('clearSearch')} onClick={() => setParams({}, { replace: true })}>×</Button></div></div>
    <div className="hub-product-toolbar"><p role="status">{t('matches', { count: items.length })}</p><PriceSort descending={descending} toggle={() => setDescending(value => !value)} /></div>
    {loading ? <p role="status">{t('loading')}</p> : items.length ? <div className="hub-product-grid">{items.map(product => <HubProductCard key={product.id} product={product} />)}</div> : <p>{t('noMatches')}</p>}
  </CatalogueLayout>
}
