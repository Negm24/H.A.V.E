import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AdminRecord } from '@have/shared/api/owner'
import { number, text } from '../../../app/hooks'

const windows = [
  { bucket: 'Expired', label: 'Already expired', tone: 'expired' },
  { bucket: '0–7 days', label: 'Within 7 days', tone: 'soon' },
  { bucket: '8–30 days', label: '8–30 days', tone: 'month' },
  { bucket: '31–90 days', label: '31–90 days', tone: 'later' },
]

export function ExpirySummary({ stock }: { stock: AdminRecord[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const id = useId()
  const matching = stock.filter(row => row.bucket === selected)
  return <>
    <div className="expiry-summary-grid">{windows.map(window => {
      const total = stock.filter(row => row.bucket === window.bucket).reduce((sum, row) => sum + number(row.quantity), 0)
      return <button key={window.bucket} className={`expiry-summary expiry-summary--${window.tone}`} aria-expanded={selected === window.bucket} aria-controls={selected === window.bucket ? id : undefined} onClick={() => setSelected(before => before === window.bucket ? null : window.bucket)}>
        <span>{window.label}</span><strong>{total.toLocaleString('en')} <small>packs</small></strong><span className="expiry-summary-action">{selected === window.bucket ? 'Hide breakdown −' : 'By Kiosk + '}</span>
      </button>
    })}</div>
    {selected && <section id={id} className="expiry-breakdown" aria-label={`${selected} stock by Kiosk`}>
      <h3>{windows.find(window => window.bucket === selected)?.label} · By Kiosk</h3>
      {matching.length ? <ul>{matching.map(row => <li key={text(row.terminal_serial)}><Link to={`/inventory?machine=${encodeURIComponent(text(row.terminal_serial, ''))}`}>{text(row.label)} <span aria-hidden="true">↗</span></Link><strong>{number(row.quantity).toLocaleString('en')} packs</strong></li>)}</ul> : <p>No packs in this expiry window.</p>}
    </section>}
  </>
}
