import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { useSession } from './providers'
import { HubLayout, AuthLayout } from '../layouts/HubLayout'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { SignupPage } from '../features/auth/pages/SignupPage'
import { RecoveryPage } from '../features/auth/pages/RecoveryPage'
import { DashboardPage } from '../features/account/pages/DashboardPage'
import { ProfilePage } from '../features/account/pages/ProfilePage'
import { TerminalLoginPage } from '../features/terminal-login/pages/TerminalLoginPage'

function PublicOnly() { const { status } = useSession(); return status === 'authenticated' ? <Navigate to="/dashboard" replace /> : <Outlet /> }
function CustomerOnly() { const { status } = useSession(); return status === 'authenticated' ? <Outlet /> : <Navigate to="/login" replace /> }
export const router = createBrowserRouter([{ element: <HubLayout />, children: [
  { index: true, element: <Navigate to="/dashboard" replace /> },
  { element: <PublicOnly />, children: [{ element: <AuthLayout />, children: [
    { path: 'login', element: <LoginPage /> }, { path: 'signup', element: <SignupPage /> }, { path: 'forgot-pin', element: <RecoveryPage /> },
  ] }] },
  { element: <CustomerOnly />, children: [
    { path: 'dashboard', element: <DashboardPage /> }, { path: 'profile', element: <ProfilePage /> }, { path: 'terminal-login', element: <TerminalLoginPage /> },
  ] },
  { path: '*', element: <Navigate to="/" replace /> },
] }])
