import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom'
import { useSession } from './providers'
import { HubLayout, AuthLayout } from '../layouts/HubLayout'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { SignupPage } from '../features/auth/pages/SignupPage'
import { RecoveryPage } from '../features/auth/pages/RecoveryPage'
import { DashboardPage } from '../features/account/pages/DashboardPage'
import { ProfilePage } from '../features/account/pages/ProfilePage'
import { TerminalLoginPage } from '../features/terminal-login/pages/TerminalLoginPage'
import { CategoriesPage } from '../features/catalogue/pages/CategoriesPage'
import { ProductsPage } from '../features/catalogue/pages/ProductsPage'
import { SearchPage } from '../features/catalogue/pages/SearchPage'
import { ProductDetailPage } from '../features/catalogue/pages/ProductDetailPage'
import { TerminalsPage } from '../features/catalogue/pages/TerminalsPage'
import { useHubCatalogue } from '../features/catalogue/hooks/use-catalogue'
import { CheckoutPage } from '../features/orders/pages/CheckoutPage'
import { OrderHistoryPage } from '../features/orders/pages/OrderHistoryPage'
import { OrderDetailPage } from '../features/orders/pages/OrderDetailPage'
import { SavedCardsPage } from '../features/payments/pages/SavedCardsPage'

function PublicOnly() { const { status } = useSession(); return status === 'authenticated' ? <Navigate to="/dashboard" replace /> : <Outlet /> }
function CustomerOnly() { const { status } = useSession(), location = useLocation(); return status === 'authenticated' ? <Outlet /> : <Navigate to="/login" state={{ from: location.pathname + location.search }} replace /> }
function CollectionTerminalOnly() { const { terminal } = useHubCatalogue(); return terminal ? <Outlet /> : <Navigate to="/browse" replace /> }
export const router = createBrowserRouter([{ element: <HubLayout />, children: [
  { index: true, element: <Navigate to="/dashboard" replace /> },
  { element: <PublicOnly />, children: [{ element: <AuthLayout />, children: [
    { path: 'login', element: <LoginPage /> }, { path: 'signup', element: <SignupPage /> }, { path: 'forgot-pin', element: <RecoveryPage /> },
  ] }] },
  { element: <CustomerOnly />, children: [
    { path: 'dashboard', element: <DashboardPage /> }, { path: 'profile', element: <ProfilePage /> }, { path: 'terminal-login', element: <TerminalLoginPage /> },
    { path: 'browse', element: <TerminalsPage /> },
    { element: <CollectionTerminalOnly />, children: [
      { path: 'browse/categories', element: <CategoriesPage /> }, { path: 'browse/categories/:categoryId', element: <ProductsPage /> },
      { path: 'browse/search', element: <SearchPage /> }, { path: 'browse/products/:productId', element: <ProductDetailPage /> },
      { path: 'checkout', element: <CheckoutPage /> },
    ] },
    { path: 'orders', element: <OrderHistoryPage /> }, { path: 'orders/:orderId', element: <OrderDetailPage /> }, { path: 'payment-methods', element: <SavedCardsPage /> },
  ] },
  { path: '*', element: <Navigate to="/" replace /> },
] }])
