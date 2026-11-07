import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { hubPurchaseApi, type PurchaseTerminal } from '@have/shared/api/purchase'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { CatalogueModal } from '@have/shared/ui/catalogue'
import { useScreenReady } from '@have/shared/telemetry/react'
import { useSession } from '../../../app/providers'
import { useHubCatalogue } from '../hooks/use-catalogue'
import '../styles/catalogue.css'

const unavailable = (item: PurchaseTerminal) => item.is_disabled || item.maintenance || item.maintenance_enabled

export function TerminalsPage() {
  const { t, i18n } = useTranslation('hubPurchase'), { session, customer } = useSession(), { selectTerminal, terminal } = useHubCatalogue(), navigate = useNavigate()
  const [items, setItems] = useState<PurchaseTerminal[]>([]), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [attempt, retry] = useState(0)
  const [pendingSerial, setPendingSerial] = useState<string | null>(null)
  useScreenReady(!loading && !failed)
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, flight = false
    setLoading(true); setFailed(false); setItems([]); setPendingSerial(null)
    const load = async (background = false) => {
      if (flight || controller.signal.aborted || document.visibilityState !== 'visible') return
      clearTimeout(timer); flight = true
      try {
        const result = await session.authorized(token => hubPurchaseApi.terminals(token, controller.signal, background), true)
        if (!controller.signal.aborted) { setItems(result); setFailed(false) }
      } catch { if (!controller.signal.aborted) setFailed(true) }
      finally { flight = false; if (!controller.signal.aborted) { setLoading(false); if (document.visibilityState === 'visible') timer = setTimeout(() => void load(true), 15_000) } }
    }
    const visible = () => { clearTimeout(timer); if (document.visibilityState === 'visible') void load(true) }
    void load(); window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) }
  }, [session, customer?.id, attempt])
  const choose = (item: PurchaseTerminal) => {
    if (unavailable(item) || failed) return
    selectTerminal(item); navigate('/browse/categories')
  }
  const pending = items.find(item => item.serial_number === pendingSerial)
  return <section className="hub-terminal-picker"><Link to="/dashboard">← {t('home')}</Link><h1>{t('chooseTerminal')}</h1><p className="hub-muted">{t('chooseTerminalDescription')}</p>
    {failed && <Alert>{t('unavailable')} <Button onClick={() => retry(value => value + 1)}>{t('refresh')}</Button></Alert>}
    {loading ? <p role="status">{t('loading')}</p> : !failed && !items.length ? <p>{t('noTerminals')}</p> : <div className="hub-terminal-grid">{items.map(item => <button disabled={!!unavailable(item) || failed} className={`hub-terminal-option ${unavailable(item) ? 'hub-terminal-option--disabled' : ''} ${terminal?.serial_number === item.serial_number ? 'selected' : ''}`} key={item.serial_number} onClick={() => item.occupancy === 'IN_USE' ? setPendingSerial(item.serial_number) : choose(item)}>
      <span aria-hidden="true">⌖</span><strong>{item.display_name}</strong><p>{i18n.language === 'ar' ? item.address_ar : item.address_en}</p><small dir="ltr">{item.serial_number}</small>
      {unavailable(item) ? <b className="hub-terminal-unavailable">{t(item.maintenance || item.maintenance_enabled ? 'terminalMaintenance' : 'terminalUnavailable')}</b> : <>
        <small className="hub-terminal-cart">{item.cart_available && item.cart_total_quantity !== null ? t('savedCartItems', { count: item.cart_total_quantity }) : t('savedCartUnknown')}</small>
        <small>{t(item.occupancy === 'IN_USE' ? 'terminalInUse' : item.occupancy === 'OWN_SESSION' ? 'terminalOwnSession' : item.occupancy === 'FREE' ? 'terminalFree' : 'usageUnknown')}</small>
        <b>{t('browseHere')} →</b>
      </>}
    </button>)}</div>}
    {pending && <CatalogueModal title={t('terminalInUse')} close={() => setPendingSerial(null)}>
      <p>{t('terminalInUseDescription')}</p><p><strong>{pending.display_name}</strong></p>
      {unavailable(pending) && <Alert>{t(pending.maintenance || pending.maintenance_enabled ? 'terminalMaintenance' : 'terminalUnavailable')}</Alert>}
      {failed && <Alert>{t('unavailable')}</Alert>}
      <div className="hub-order-actions"><Button onClick={() => setPendingSerial(null)}>{t('goBack')}</Button><Button variant="primary" disabled={!!unavailable(pending) || failed} onClick={() => choose(pending)}>{t('continueBrowsing')}</Button></div>
    </CatalogueModal>}
  </section>
}
