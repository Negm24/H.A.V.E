import { Navigate, Route, Routes } from 'react-router-dom'
import { AttractPage } from '../features/session/pages/AttractPage'
import { LanguagePage } from '../features/session/pages/LanguagePage'
import { GuestHomePage } from '../features/session/pages/GuestHomePage'
import { PinLoginPage } from '../features/auth/pages/PinLoginPage'
import { QrLoginPage } from '../features/auth/pages/QrLoginPage'
import { DashboardPage } from '../features/dashboard/pages/DashboardPage'
import { ProfilePage } from '../features/dashboard/pages/ProfilePage'
import { useSession } from '../features/session/hooks/use-session'
import { useEffect } from 'react'
import { useTranslation } from '@have/shared/i18n'
import { BrowsePage } from '../features/symptoms/pages/BrowsePage'

export function AppRoutes() {
  const { state } = useSession()
  const { i18n } = useTranslation()
  useEffect(() => { void i18n.changeLanguage(state.language || 'en') }, [i18n, state.language])
  const home = state.phase === 'guest' ? '/guest' : state.phase === 'customer' ? '/dashboard'
    : state.phase === 'language' || state.phase === 'starting' ? '/language' : '/'
  return <Routes>
    <Route path="/browse" element={state.phase === 'guest' || state.phase === 'customer' ? <BrowsePage /> : <Navigate to={home} replace />} />
    <Route path="/" element={home === '/' ? <AttractPage /> : <Navigate to={home} replace />} />
    <Route path="/language" element={home === '/language' ? <LanguagePage /> : <Navigate to={home} replace />} />
    <Route path="/guest" element={state.phase === 'guest' ? <GuestHomePage /> : <Navigate to={home} replace />} />
    <Route path="/auth/pin" element={state.phase === 'guest' ? <PinLoginPage /> : <Navigate to={home} replace />} />
    <Route path="/auth/qr" element={state.phase === 'guest' ? <QrLoginPage /> : <Navigate to={home} replace />} />
    <Route path="/dashboard" element={state.phase === 'customer' ? <DashboardPage /> : <Navigate to={home} replace />} />
    <Route path="/profile" element={state.phase === 'customer' ? <ProfilePage /> : <Navigate to={home} replace />} />
    <Route path="*" element={<Navigate to={home} replace />} />
  </Routes>
}
