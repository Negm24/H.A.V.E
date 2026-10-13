import { useTranslation } from '@have/shared/i18n'
import { useNavigate } from 'react-router-dom'
import { Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { state } = useSession()
  const navigate = useNavigate()
  return <KioskFrame title={t('dashboard')}><div className="page-heading"><h1>{t('hello')} <bdi>{state.customer?.first_name}</bdi></h1><span className="identity-badge">{t('signedIn')}</span></div>
    <p className="page-intro">{t('intro')}</p><div className="home-grid">
      <Button className="home-card" onClick={() => navigate('/profile')}><span className="card-icon">◉</span><strong>{t('profile')}</strong><span>{t('profileDescription')}</span></Button>
      {['prescriptions','browse','insurance'].map(name => <Button className="home-card" disabled key={name}><strong>{t(name)}</strong><span>{t('comingLater')}</span></Button>)}
    </div>
  </KioskFrame>
}
