import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { useNavigate } from 'react-router-dom'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'

export function BrowsePage() {
  const { t } = useTranslation('symptoms')
  const { state } = useSession()
  const navigate = useNavigate()
  return <KioskFrame title={t('browse_title')} back={state.phase === 'customer' ? '/dashboard' : '/guest'}>
    <h1>{t('browse_title')}</h1>
    <div className="home-grid">
      <Button className="home-card" onClick={() => navigate('/browse/symptoms')}><strong>{t('assistant')}</strong><span>{t('assistant_intro')}</span></Button>
      <Button className="home-card" disabled><strong>{t('catalogue')}</strong><span>{t('coming_later')}</span></Button>
    </div>
  </KioskFrame>
}
