import { Link, Outlet } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { useSession } from '../app/providers'

export function HubLayout() {
  const { t, i18n } = useTranslation('hub'), { status, logout, notice } = useSession()
  return <div className="hub-app"><header className="hub-header"><Link to="/" className="hub-brand" aria-label="H.A.V.E Hub"><span className="hub-logo">H<span>+</span></span><span>H.A.V.E <b>Hub</b><small>{t('brandCaption')}</small></span></Link><div className="hub-header-actions"><Button onClick={() => void i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}>{i18n.language === 'ar' ? 'English' : 'العربية'}</Button>{status === 'authenticated' && <Button onClick={() => void logout()}>{t('signOut')}</Button>}</div></header>
    <main className="hub-content">{notice && <Alert>{t(notice)}</Alert>}{status === 'loading' ? <p role="status">{t('loading')}</p> : <Outlet />}</main><footer className="hub-footer">H.A.V.E · {t('brandCaption')}</footer></div>
}

export function AuthLayout() {
  const { t } = useTranslation('hub')
  return <div className="hub-auth-layout"><aside className="hub-intro"><span className="hub-eyebrow">HEALTH ACCESS & VENDING EVERYWHERE</span><h2>{t('welcomeTitle')}</h2><p>{t('welcomeDescription')}</p><div className="hub-intro-mark" aria-hidden="true">H<span>+</span></div></aside><div className="hub-auth-content"><Outlet /></div></div>
}
