import { useId } from 'react'
import { Link } from 'react-router-dom'
import type { AdminRecord } from '@have/shared/api/owner'
import { date, text } from '../../../app/hooks'
import { Badge, Empty } from '../../../components/ui'

// A schematic of the physical cabinet, not an inventory or peripheral-health report.
function CabinetIllustration() {
  const id = useId()
  return <svg className="fleet-cabinet" viewBox="0 0 240 250" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-metal`} x1="0" x2="1"><stop stopColor="#f8f9fb" /><stop offset="1" stopColor="#d7dce3" /></linearGradient>
      <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#414653" /><stop offset="1" stopColor="#222631" /></linearGradient>
    </defs>
    <ellipse cx="121" cy="233" rx="96" ry="9" fill="#242735" opacity=".09" />
    <path d="M26 26 60 16 218 26 185 36Z" fill="#e3e7ed" stroke="#c3c9d3" />
    <path d="M26 26 60 36 60 230 26 214Z" fill="#cbd1da" stroke="#b9c1cc" />
    <path d="M26 26 60 36 60 54 26 44Z" fill="#355d4b" />
    <rect x="60" y="26" width="158" height="204" rx="3" fill={`url(#${id}-metal)`} stroke="#b9c1cc" />
    <path d="M60 26H218V51H60Z" fill="#376a50" />
    <text x="139" y="42" textAnchor="middle" fill="white" fontSize="12" fontWeight="800" letterSpacing="1">AUTO PHARM</text>
    <rect x="70" y="60" width="105" height="137" rx="13" fill="#9da6b1" />
    <rect x="74" y="64" width="97" height="129" rx="10" fill={`url(#${id}-glass)`} />
    {Array.from({ length: 4 }, (_, row) => <g key={row}>
      {Array.from({ length: 6 }, (_, column) => <path key={column} d={`M${80 + column * 14} ${82 + row * 27}h10l-2 8h-7Z`} fill="#9fa9b4" opacity=".85" />)}
      <path d={`M79 ${92 + row * 27}h87`} stroke="#626c7b" strokeWidth="2" />
    </g>)}
    <path d="M82 65 123 65 163 192 143 192Z" fill="white" opacity=".055" />
    <path d="M69 117v23" stroke="#8e98a4" strokeWidth="3" strokeLinecap="round" />
    <rect x="183" y="78" width="27" height="37" rx="3" fill="#376a50" />
    <rect x="186" y="82" width="21" height="23" rx="1" fill="#252737" />
    <path d="M190 89h13m-13 5h8" stroke="#a89bd1" strokeWidth="2" />
    <rect x="184" y="141" width="25" height="41" rx="3" fill="#2d323c" />
    <path d="M189 164h15" stroke="#d0d6df" strokeWidth="3" />
    <path d="M60 216H218V230H60Z" fill="#376a50" />
    <path d="M26 201 60 216V230L26 214Z" fill="#294b3b" />
    <path d="M78 207h78" stroke="#c2c9d2" />
  </svg>
}

export function FleetCards({ machines }: { machines: AdminRecord[] }) {
  if (!machines.length) return <Empty title="No Kiosks registered" />
  return <div className="fleet-card-grid">{machines.map(machine => {
    const connection = machine.connection_state
    const online = connection === 'online'
    const connectionLabel = online ? 'Online' : connection === 'last_seen' ? 'Connection lost' : connection === 'no_report' ? 'No report yet' : 'Unknown'
    const lastSeen = machine.app_last_seen_at ? date(machine.app_last_seen_at) : connection === 'no_report' ? 'No report yet' : 'Unknown'
    const session = machine.session_state === 'in_session' ? 'In session' : machine.session_state === 'idle' ? 'Idle' : 'Unknown'
    const availability = text(machine.availability, 'Unknown')
    return <article className="fleet-machine-card" key={text(machine.serial_number)} aria-label={text(machine.display_name)}>
      <div className="fleet-machine-portrait"><CabinetIllustration /><span>{text(machine.address_en, 'Address not provided')}</span></div>
      <div className="fleet-machine-info">
        <header><h3>{text(machine.display_name)}</h3><Badge value={connectionLabel} tone={online ? 'positive' : connection === 'last_seen' ? 'negative' : 'neutral'} /></header>
        <small className="fleet-machine-serial">{text(machine.serial_number)}</small>
        <dl><div><dt>Last seen</dt><dd>{lastSeen}</dd></div><div><dt>Session</dt><dd><Badge value={session} /></dd></div><div><dt>Availability</dt><dd><Badge value={availability} /></dd></div></dl>
        <Link className="fleet-machine-link" to={`/inventory?machine=${encodeURIComponent(text(machine.serial_number, ''))}`}>Open inventory <span aria-hidden="true">↗</span></Link>
      </div>
    </article>
  })}</div>
}
