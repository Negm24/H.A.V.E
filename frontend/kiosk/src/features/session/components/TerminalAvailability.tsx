import { useEffect, useState, type ReactNode } from 'react'
import { terminalApi } from '@have/shared/api/terminal'
import { Button } from '@have/shared/ui/controls'
import { useTranslation } from '@have/shared/i18n'
import { useSession } from '../hooks/use-session'

// Device status never uses or renews a customer's session. Keep a confirmed
// maintenance screen until the backend explicitly reports restored service.
export function TerminalAvailability({ children }: { children: ReactNode }) {
  const [maintenance, setMaintenance] = useState(false)
  const [attempt, retry] = useState(0)
  const { controller } = useSession()
  const { t } = useTranslation('session')
  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>, flight = false
    const load = async () => {
      if (flight || abort.signal.aborted) return
      flight = true
      clearTimeout(timer)
      try {
        await Promise.all([
          terminalApi.availability(abort.signal).then(status => {
            if (!abort.signal.aborted && typeof status.maintenance === 'boolean') setMaintenance(status.maintenance)
          }).catch(() => {}),
          terminalApi.heartbeat(abort.signal).catch(() => {}),
        ])
      } catch { /* Session entry still requires an authoritative server response. */ }
      finally {
        flight = false
        if (!abort.signal.aborted) timer = setTimeout(() => void load(), 15_000)
      }
    }
    const visible = () => { void load() }
    void load()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    window.addEventListener('online', visible)
    return () => { abort.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); window.removeEventListener('online', visible) }
  }, [attempt])
  useEffect(() => { if (maintenance) controller.reset(false) }, [maintenance, controller])
  if (!maintenance) return children
  return <main className="terminal-attract" aria-live="polite">
    <div className="attract-primary">
      <div className="attract-brand"><span className="brand-mark">℞</span> H.A.V.E Terminal</div>
      <div><h1>{t('maintenanceTitle', { lng: 'en' })}</h1>
        <p lang="ar" dir="rtl">{t('maintenanceTitle', { lng: 'ar' })}</p>
        <p>{t('maintenanceBody', { lng: 'en' })}</p>
        <p lang="ar" dir="rtl">{t('maintenanceBody', { lng: 'ar' })}</p></div>
      <Button onClick={() => retry(value => value + 1)}>{t('maintenanceRefresh', { lng: 'en' })} · <span lang="ar" dir="rtl">{t('maintenanceRefresh', { lng: 'ar' })}</span></Button>
    </div>
    <aside className="attract-aside"><div className="attract-emblem" aria-hidden="true">℞</div>
      <p>{t('maintenanceOrders', { lng: 'en' })}</p><p lang="ar" dir="rtl">{t('maintenanceOrders', { lng: 'ar' })}</p></aside>
  </main>
}
