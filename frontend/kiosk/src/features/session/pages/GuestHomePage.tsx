import { useTranslation } from '@have/shared/i18n'
import { useNavigate } from 'react-router-dom'
import { Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'

export function GuestHomePage() {
  const { t } = useTranslation('session')
  const navigate = useNavigate()
  return <KioskFrame title={t('guestHome')}><div className="page-heading"><h1>{t('welcome')}</h1><span className="identity-badge">{t('guest')}</span></div>
    <p className="page-intro">{t('guestIntro')}</p>
    <div className="home-grid">
      <Button className="home-card" onClick={() => navigate('/auth/pin')}><span className="card-icon">▦</span><strong>{t('pinLogin')}</strong><span>{t('pinDescription')}</span></Button>
      <Button className="home-card" onClick={() => navigate('/browse')}><strong>{t('browse')}</strong><span>{t('catalogue:demo')}</span></Button>
    </div>
  </KioskFrame>
}
