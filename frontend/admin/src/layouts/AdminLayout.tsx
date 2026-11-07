import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@have/shared/ui/controls'
import { Icon } from '../components/ui'
import { useOwnerSession } from '../app/session'

const navigation = [['overview', 'Overview'], ['doctors', 'Doctors'], ['customers', 'Customers'], ['orders', 'Orders & payments'], ['catalogue', 'Catalogue'], ['inventory', 'Inventory'], ['kiosks', 'Kiosks'], ['technical', 'Technical'], ['activity', 'Activity']] as const
export function AdminLayout() {
  const [open, setOpen] = useState(false), [mobile, setMobile] = useState(() => matchMedia('(max-width:760px)').matches), session = useOwnerSession(), navigate = useNavigate(), location = useLocation(), sidebar = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => { const query = matchMedia('(max-width:760px)'), update = () => { setMobile(query.matches); setOpen(false) }; query.addEventListener('change', update); return () => query.removeEventListener('change', update) }, [])
  useEffect(() => { if (mobile && open) { sidebar.current?.querySelector<HTMLAnchorElement>('a')?.focus(); return () => toggle.current?.focus() } }, [open, mobile])
  useEffect(() => { document.getElementById('admin-main')?.focus({ preventScroll: true }) }, [location.pathname])
  return <div className="admin-shell">
    <a className="admin-skip" href="#admin-main">Skip to content</a>
    {open && <button className="admin-nav-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside id="admin-navigation" ref={sidebar} inert={mobile && !open} aria-hidden={mobile && !open || undefined} className={`admin-sidebar ${open ? 'admin-sidebar--open' : ''}`} onKeyDown={event => { if (!mobile || !open) return; if (event.key === 'Escape') setOpen(false); if (event.key !== 'Tab') return; const items = sidebar.current?.querySelectorAll<HTMLElement>('a,button:not(:disabled)'); if (!items?.length) return; const first = items[0]!, last = items[items.length - 1]!; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } }}><NavLink className="admin-brand" to="/overview" onClick={() => setOpen(false)}><span>H<span className="admin-brand-plus">+</span></span><strong>H.A.V.E <small>ADMIN WORKSPACE</small></strong></NavLink>
      <p className="admin-nav-label">YOUR WORKSPACE</p><nav aria-label="Main navigation">{navigation.map(([path, label]) => <NavLink key={path} to={`/${path}`} onClick={() => setOpen(false)}><Icon name={path} /><span>{label}</span></NavLink>)}</nav>
      <div className="admin-sidebar-footer"><span className="admin-status-dot" /> Private Owner workspace<small>AutoPharm · Egypt</small></div>
    </aside>
    <div className="admin-workspace"><header className="admin-topbar"><div><button ref={toggle} className="admin-icon-button admin-menu-button" aria-controls="admin-navigation" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(value => !value)}>☰</button><span className="admin-topbar-label">Network management</span></div><div className="admin-owner-menu"><span className="admin-avatar" aria-hidden="true">{session.data?.owner.first_name.charAt(0)}</span><span><strong>{session.data?.owner.first_name} {session.data?.owner.last_name}</strong><small>Owner</small></span><Button onClick={() => void session.logout().then(() => navigate('/login', { replace: true }))}>Sign out</Button></div></header>
      {session.remaining > 0 && session.remaining <= 60 && <div className="admin-session-warning" role="status">Your session will expire in {session.remaining} seconds. Save any changes before it ends.</div>}
      <main id="admin-main" className="admin-main" tabIndex={-1}><Outlet /></main><footer className="admin-footer"><span>H.A.V.E · Health Access & Vending Everywhere</span><span>All times shown in Cairo</span></footer>
    </div>
  </div>
}
