import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { OwnerSessionProvider, useOwnerSession } from './session'
import { AdminLayout } from '../layouts/AdminLayout'
import { LoginPage, RecoveryPage } from '../features/auth/pages/AuthPage'
import { OverviewPage } from '../features/overview/pages/OverviewPage'
import { AccountsPage } from '../features/accounts/pages/AccountsPage'
import { OrdersPage } from '../features/orders/pages/OrdersPage'
import { CataloguePage } from '../features/catalogue/pages/CataloguePage'
import { InventoryPage } from '../features/inventory/pages/InventoryPage'
import { KiosksPage } from '../features/kiosks/pages/KiosksPage'
import { TechnicalPage } from '../features/technical/pages/TechnicalPage'
import { ActivityPage } from '../features/activity/pages/ActivityPage'
import './admin.css'

function Protected() { const session = useOwnerSession(); if (session.loading) return <main className="admin-boot" role="status">Opening your workspace…</main>; return session.data ? <Outlet /> : <Navigate to="/login" replace /> }
function Public() { const session = useOwnerSession(); return session.data ? <Navigate to="/overview" replace /> : <Outlet /> }
export default function App() {
  return <BrowserRouter><OwnerSessionProvider><Routes>
    <Route element={<Public />}><Route path="/login" element={<LoginPage />} /><Route path="/forgot-password" element={<RecoveryPage />} /></Route>
    <Route element={<Protected />}><Route element={<AdminLayout />}><Route path="/overview" element={<OverviewPage />} /><Route path="/doctors" element={<AccountsPage key="doctors" doctors />} /><Route path="/customers" element={<AccountsPage key="customers" />} /><Route path="/orders" element={<OrdersPage />} /><Route path="/catalogue" element={<CataloguePage />} /><Route path="/inventory" element={<InventoryPage />} /><Route path="/kiosks" element={<KiosksPage />} /><Route path="/technical" element={<TechnicalPage />} /><Route path="/activity" element={<ActivityPage />} /></Route></Route>
    <Route path="*" element={<Navigate to="/overview" replace />} />
  </Routes></OwnerSessionProvider></BrowserRouter>
}
