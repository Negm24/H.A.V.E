import { Link } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { useSession } from '../../../app/providers'
import { useCollectionSummary } from '../../orders/hooks/use-collection-summary'

export function DashboardPage() {
  const { t } = useTranslation('hub'), { t: purchase } = useTranslation('hubPurchase'), { customer } = useSession()
  const { summary, unavailable } = useCollectionSummary(), count = summary?.awaiting_collection_count ?? 0
  const unpaid = summary?.awaiting_payment_count ?? 0, attention = summary?.attention_count ?? count + unpaid
  return <div className="hub-dashboard"><div className="hub-page-heading"><span className="hub-eyebrow">H.A.V.E HUB</span><h1>{t('greeting')} <bdi>{customer?.first_name}</bdi></h1><p>{t('dashboardDescription')}</p></div>
    <div className="hub-dashboard-grid"><Link className={`hub-service hub-service--active ${attention > 0 ? 'hub-service--collection' : ''}`} to="/profile"><span className="hub-service-icon" aria-hidden="true">◎</span><h2>{t('myProfile')}</h2><p>{t('profileDescription')}</p>{attention > 0 && <span className="hub-collection-cue"><span className="hub-order-count">{attention}</span><span>{count > 0 && purchase('collectionCue', { count })}{unpaid > 0 && <span>{count > 0 ? ' · ' : ''}{purchase('paymentCue', { count: unpaid })}</span>}</span></span>}{unavailable && <span className="hub-summary-unavailable">{purchase('collectionUnknown')}</span>}<span className="hub-service-arrow" aria-hidden="true">→</span></Link>
      <button className="hub-service" disabled><span className="hub-service-icon" aria-hidden="true">▤</span><h2>{t('prescriptions')}</h2><span className="hub-pill">{t('comingLater')}</span></button>
      <Link className="hub-service hub-service--active" to="/browse"><span className="hub-service-icon" aria-hidden="true">✚</span><h2>{t('medicines')}</h2><span className="hub-service-arrow" aria-hidden="true">→</span></Link>
      <button className="hub-service" disabled><span className="hub-service-icon" aria-hidden="true">◇</span><h2>{t('insurance')}</h2><span className="hub-pill">{t('comingLater')}</span></button>
    </div><Link className="hub-qr-action" to="/terminal-login"><span aria-hidden="true">▦</span><div><strong>{t('terminalLogin')}</strong><p>{t('terminalLoginDescription')}</p></div><span aria-hidden="true">→</span></Link></div>
}
