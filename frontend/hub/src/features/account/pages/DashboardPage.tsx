import { Link } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { useSession } from '../../../app/providers'

export function DashboardPage() {
  const { t } = useTranslation('hub'), { customer } = useSession()
  return <div className="hub-dashboard"><div className="hub-page-heading"><span className="hub-eyebrow">H.A.V.E HUB</span><h1>{t('greeting')} <bdi>{customer?.first_name}</bdi></h1><p>{t('dashboardDescription')}</p></div>
    <div className="hub-dashboard-grid"><Link className="hub-service hub-service--active" to="/profile"><span className="hub-service-icon" aria-hidden="true">◎</span><h2>{t('myProfile')}</h2><p>{t('profileDescription')}</p><span className="hub-service-arrow" aria-hidden="true">→</span></Link>
      <button className="hub-service" disabled><span className="hub-service-icon" aria-hidden="true">▤</span><h2>{t('prescriptions')}</h2><span className="hub-pill">{t('comingLater')}</span></button>
      <Link className="hub-service hub-service--active" to="/browse"><span className="hub-service-icon" aria-hidden="true">✚</span><h2>{t('medicines')}</h2><span className="hub-service-arrow" aria-hidden="true">→</span></Link>
      <button className="hub-service" disabled><span className="hub-service-icon" aria-hidden="true">◇</span><h2>{t('insurance')}</h2><span className="hub-pill">{t('comingLater')}</span></button>
    </div><Link className="hub-qr-action" to="/terminal-login"><span aria-hidden="true">▦</span><div><strong>{t('terminalLogin')}</strong><p>{t('terminalLoginDescription')}</p></div><span aria-hidden="true">→</span></Link></div>
}
