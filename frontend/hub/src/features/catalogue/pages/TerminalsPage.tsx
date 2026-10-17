import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { hubPurchaseApi, type PurchaseTerminal } from '@have/shared/api/purchase'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { useSession } from '../../../app/providers'
import { useHubCatalogue } from '../hooks/use-catalogue'
import '../styles/catalogue.css'

export function TerminalsPage() {
  const { t, i18n } = useTranslation('hubPurchase'), { session } = useSession(), { selectTerminal, terminal } = useHubCatalogue(), navigate = useNavigate()
  const [items, setItems] = useState<PurchaseTerminal[]>([]), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [attempt, retry] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setFailed(false)
    void session.authorized(token => hubPurchaseApi.terminals(token, controller.signal), true)
      .then(result => { if (!controller.signal.aborted) setItems(result) }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [session, attempt])
  return <section className="hub-terminal-picker"><Link to="/dashboard">← {t('home')}</Link><h1>{t('chooseTerminal')}</h1><p className="hub-muted">{t('chooseTerminalDescription')}</p>
    {failed && <Alert>{t('unavailable')} <Button onClick={() => retry(value => value + 1)}>{t('refresh')}</Button></Alert>}
    {loading ? <p role="status">{t('loading')}</p> : !failed && !items.length ? <p>{t('noTerminals')}</p> : <div className="hub-terminal-grid">{items.map(item => <button className={`hub-terminal-option ${terminal?.serial_number === item.serial_number ? 'selected' : ''}`} key={item.serial_number} onClick={() => { selectTerminal(item); navigate('/browse/categories') }}>
      <span aria-hidden="true">⌖</span><strong>{item.display_name}</strong><p>{i18n.language === 'ar' ? item.address_ar : item.address_en}</p><small dir="ltr">{item.serial_number}</small><b>{t('browseHere')} →</b>
    </button>)}</div>}
  </section>
}
