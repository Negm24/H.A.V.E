import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { GuidanceModal } from '@have/shared/ui/catalogue'
import { useHubCatalogue } from '../hooks/use-catalogue'
import '../styles/catalogue.css'

export function CatalogueLayout({ title, back = '/browse/categories', children }: { title: string; back?: string; children: ReactNode }) {
  const { t } = useTranslation('catalogue'), { t: hub, i18n } = useTranslation('hubCatalogue')
  const { observedAt, catalogueError, cartError, mutationError, refresh, terminal } = useHubCatalogue()
  const [help, showHelp] = useState(false)
  return <section className="hub-catalogue">
    <Link className="hub-catalogue-back" to={back}>← {hub(back === '/dashboard' ? 'home' : 'back')}</Link>
    <div className="hub-catalogue-heading"><div><span className="hub-eyebrow">H.A.V.E HUB</span><h1>{title}</h1></div><Link className="hub-search-action" to="/browse/search">⌕ {t('search')}</Link></div>
    <div className="hub-availability"><strong>{hub('collectionTerminal')}: {terminal?.display_name}</strong><p>{i18n.language === 'ar' ? terminal?.address_ar : terminal?.address_en}</p><p>{hub('terminalAdvisory')}</p><Link to="/browse">{hub('changeTerminal')}</Link>{observedAt && <small>{hub('observed', { date: new Date(observedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}</small>}</div>
    {catalogueError && <Alert>{t('unavailable')} <Button onClick={() => void refresh()}>{t('retry')}</Button></Alert>}
    {cartError && <Alert>{hub('cartUnavailable')} <Button onClick={() => void refresh()}>{t('retry')}</Button></Alert>}
    {mutationError && <Alert>{mutationError === 'conflict' ? hub('conflict') : mutationError === 'limited' ? hub('limited') : t(mutationError)}</Alert>}
    {children}
    <div className="hub-guidance-action"><Button onClick={() => showHelp(true)}>{t('help')}</Button><span>{hub('demo')}</span></div>
    {help && <GuidanceModal close={() => showHelp(false)} />}
  </section>
}
