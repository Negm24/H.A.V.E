import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { hubPurchaseApi, type PurchaseTerminal } from '@have/shared/api/purchase'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { CatalogueModal } from '@have/shared/ui/catalogue'
import { useSession } from '../../../app/providers'
import { useHubCatalogue } from '../hooks/use-catalogue'
import '../styles/catalogue.css'

export function TerminalsPage() {
  const { t, i18n } = useTranslation('hubPurchase'), { session, customer } = useSession(), { selectTerminal, terminal } = useHubCatalogue(), navigate = useNavigate()
  const [items, setItems] = useState<PurchaseTerminal[]>([]), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [attempt, retry] = useState(0)
  const [pendingSerial, setPendingSerial] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, flight = false
    setLoading(true); setFailed(false); setItems([]); setPendingSerial(null)
    const load = async () => {
      if (flight || controller.signal.aborted || document.visibilityState !== 'visible') return
      clearTimeout(timer); flight = true
      try {
        const result = await session.authorized(token => hubPurchaseApi.terminals(token, controller.signal), true)
        if (!controller.signal.aborted) { setItems(result); setFailed(false) }
      } catch { if (!controller.signal.aborted) setFailed(true) }
      finally { flight = false; if (!controller.signal.aborted) { setLoading(false); if (document.visibilityState === 'visible') timer = setTimeout(() => void load(), 15_000) } }
    }
    const visible = () => { clearTimeout(timer); if (document.visibilityState === 'visible') void load() }
    void load(); window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) }
  }, [session, customer?.id, attempt])
  const choose = (item: PurchaseTerminal) => {
    if (item.is_disabled || failed) return
    selectTerminal(item); navigate('/browse/categories')
  }
  const pending = items.find(item => item.serial_number === pendingSerial)
  return <section className="hub-terminal-picker"><Link to="/dashboard">← {t('home')}</Link><h1>{t('chooseTerminal')}</h1><p className="hub-muted">{t('chooseTerminalDescription')}</p>
    {failed && <Alert>{t('unavailable')} <Button onClick={() => retry(value => value + 1)}>{t('refresh')}</Button></Alert>}
    {loading ? <p role="status">{t('loading')}</p> : !failed && !items.length ? <p>{t('noTerminals')}</p> : <div className="hub-terminal-grid">{items.map(item => <button disabled={item.is_disabled || failed} className={`hub-terminal-option ${item.is_disabled ? 'hub-terminal-option--disabled' : ''} ${terminal?.serial_number === item.serial_number ? 'selected' : ''}`} key={item.serial_number} onClick={() => item.occupancy === 'IN_USE' ? setPendingSerial(item.serial_number) : choose(item)}>
      <span aria-hidden="true">⌖</span><strong>{item.display_name}</strong><p>{i18n.language === 'ar' ? item.address_ar : item.address_en}</p><small dir="ltr">{item.serial_number}</small>
      {item.is_disabled ? <b className="hub-terminal-unavailable">{t('terminalUnavailable')}</b> : <>
        <small className="hub-terminal-cart">{item.cart_available && item.cart_total_quantity !== null ? t('savedCartItems', { count: item.cart_total_quantity }) : t('savedCartUnknown')}</small>
        <small>{t(item.occupancy === 'IN_USE' ? 'terminalInUse' : item.occupancy === 'OWN_SESSION' ? 'terminalOwnSession' : item.occupancy === 'FREE' ? 'terminalFree' : 'usageUnknown')}</small>
        <b>{t('browseHere')} →</b>
      </>}
    </button>)}</div>}
    {pending && <CatalogueModal title={t('terminalInUse')} close={() => setPendingSerial(null)}>
      <p>{t('terminalInUseDescription')}</p><p><strong>{pending.display_name}</strong></p>
      {pending.is_disabled && <Alert>{t('terminalUnavailable')}</Alert>}
      {failed && <Alert>{t('unavailable')}</Alert>}
      <div className="hub-order-actions"><Button onClick={() => setPendingSerial(null)}>{t('goBack')}</Button><Button variant="primary" disabled={pending.is_disabled || failed} onClick={() => choose(pending)}>{t('continueBrowsing')}</Button></div>
    </CatalogueModal>}
  </section>
}
