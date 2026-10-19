import { useTranslation } from '@have/shared/i18n'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'
import { useCollectionSummary } from '../../orders/hooks/use-collection-summary'
import '../styles/collection.css'

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { state } = useSession()
  const { summary, refresh } = useCollectionSummary()
  useEffect(() => { void refresh() }, [refresh])
  const count = summary?.awaiting_collection_count ?? 0
  const unpaid = summary?.awaiting_payment_count ?? 0, attention = summary?.attention_count ?? count + unpaid
  const navigate = useNavigate()
  return <KioskFrame title={t('dashboard')}><div className="page-heading"><h1>{t('hello')} <bdi>{state.customer?.first_name}</bdi></h1><span className="identity-badge">{t('signedIn')}</span></div>
    <p className="page-intro">{t('intro')}</p><div className="home-grid">
      <Button className={`home-card${attention > 0 ? ' home-card--collection' : ''}`} onClick={() => navigate('/profile')}>
        <span className="card-icon" aria-hidden="true">◉</span><strong>{t('profile')}</strong>
        {attention > 0 ? <><span className="collection-cue"><span className="collection-count">{attention}</span>{count > 0 ? t('collectionReady', { count }) : t('paymentWaiting', { count: unpaid })}</span>
          {unpaid > 0 && count > 0 && <span>{t('paymentWaiting', { count: unpaid })}</span>}
          {count > 0 &&
          <span className="collection-location">{summary!.at_terminal_count > 0 ? t('collectHere', { count: summary!.at_terminal_count }) : t('collectElsewhere')}
            {summary!.elsewhere_count > 0 && <span>{t('collectionLocations')}: {summary!.collection_terminals.map(terminal => `${terminal.display_name} (${terminal.count})`).join(' · ')}</span>}
          </span>}</> : <span>{t('profileDescription')}</span>}
      </Button>
      {['prescriptions','browse','insurance'].map(name => <Button className="home-card" disabled={name !== 'browse'} onClick={name === 'browse' ? () => navigate('/browse') : undefined} key={name}><strong>{t(name)}</strong><span>{t(name === 'browse' ? 'catalogue:demo' : 'comingLater')}</span></Button>)}
    </div>
  </KioskFrame>
}
