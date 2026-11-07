import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AdminRecord } from '@have/shared/api/owner'
import { amount, date, number, text } from '../app/hooks'
import { Empty, RecordsTable } from './ui'

export const rows = (value: unknown): AdminRecord[] => Array.isArray(value) ? value as AdminRecord[] : []
export const record = (value: unknown): AdminRecord => value && typeof value === 'object' ? value as AdminRecord : {}
export function Trend({ data, title, unit = '' }: { data: AdminRecord[]; title: string; unit?: string }) {
  const max = Math.max(1, ...data.map(row => number(row.value)))
  const start = Date.parse(String(data[0]?.minute)), end = Date.parse(String(data.at(-1)?.minute))
  const duration = Math.max(60000, end - start)
  const paths: string[] = []; let path = ''
  data.forEach(row => {
    if (row.value === null || row.value === undefined) { if (path) paths.push(path); path = ''; return }
    const x = 25 + (Date.parse(String(row.minute)) - start) / duration * 550
    const y = 160 - number(row.value) / max * 140
    path += `${path ? 'L' : 'M'}${x},${y} `
  })
  if (path) paths.push(path)
  return <section className="admin-chart"><h3>{title}</h3><svg viewBox="0 0 610 190" role="img" aria-label={`${title}, ${data.length} observations. Values in table below.`}><line x1="25" x2="575" y1="160" y2="160" className="admin-chart-grid" />{paths.map((item, index) => <path key={index} d={item} fill="none" className="admin-chart-line" />)}<text x="25" y="184">{date(data[0]?.minute)}</text><text x="575" y="184" textAnchor="end">{date(data.at(-1)?.minute)}</text></svg><p className="admin-muted">{data.length} observations · Latest {data.at(-1)?.value === null ? 'No measurement' : text(data.at(-1)?.value)} {unit}</p><details><summary>View {title.toLowerCase()} data</summary><RecordsTable rows={data} columns={[{ key: 'minute', label: 'Time', render: row => date(row.minute) }, { key: 'value', label: unit || 'Count', render: row => row.value === null ? 'No measurement' : text(row.value) }]} /></details></section>
}
export function percentile(value: unknown) {
  const metric = record(value)
  if (!number(metric.count)) return 'No samples'
  if (metric.upper === null) return `> ${text(metric.lower)} ${text(metric.unit, '')}`
  return `≈ ${text(metric.lower, '0')}–${text(metric.upper)} ${text(metric.unit, '')}`
}

export function Bars({ data, valueKey = 'amount', money = false, title, href, showData = true }: { data: AdminRecord[]; valueKey?: string; money?: boolean; title: string; href?: (row: AdminRecord) => string; showData?: boolean }) {
  const max = Math.max(1, ...data.map(row => number(row[valueKey])))
  if (!data.length) return <Empty title="No data in this period" />
  return <div className="dashboard-bars" aria-label={title}>{data.slice(0, 20).map((row, index) => {
    const label = text(row.label ?? row.service ?? row.feature), value = number(row[valueKey])
    const content = <><span>{label}{!!row.address && <small className="dashboard-bar-address">{String(row.address)}</small>}</span><strong>{money ? amount(row[valueKey]) : value.toLocaleString('en')}</strong><span className="dashboard-bar-track"><i style={{ width: `${Math.max(value > 0 ? 1 : 0, value / max * 100)}%` }} /></span></>
    return href ? <Link key={index} to={href(row)}>{content}</Link> : <div key={index}>{content}</div>
  })}{showData && <details><summary>View {title.toLowerCase()} data</summary><RecordsTable rows={data} columns={[{ key: 'label', label: 'Label', render: row => text(row.label ?? row.service ?? row.feature) }, { key: valueKey, label: money ? 'EGP' : 'Count' }]} /></details>}</div>
}

export function Columns({ data, title, href }: { data: AdminRecord[]; title: string; href?: (row: AdminRecord) => string }) {
  const id = useId()
  const [selected, setSelected] = useState<number | null>(null)
  const [pinned, setPinned] = useState(false)
  const max = Math.max(1, ...data.map(row => number(row.amount)))
  const step = 600 / Math.max(1, data.length)
  const point = selected === null ? undefined : data[selected]
  if (!data.length) return <Empty title="No successful payments in this period" />
  return <div className="dashboard-columns interactive-revenue" onPointerLeave={() => { if (!pinned) setSelected(null) }} onKeyDown={event => { if (event.key === 'Escape') { setSelected(null); setPinned(false) } }}>
    <svg viewBox="0 0 640 225" role="group" aria-labelledby={id}>
      <title id={id}>{title}. Hover, tap, or focus a bar for its period and amount.</title>
      {[0, .5, 1].map(fraction => <g key={fraction}><line x1="32" x2="632" y1={180 - fraction * 155} y2={180 - fraction * 155} className="admin-chart-grid" /><text x="29" y={184 - fraction * 155} textAnchor="end">{Math.round(max * fraction)}</text></g>)}
      {data.map((row, index) => <g key={String(row.label)} role="button" tabIndex={0} aria-label={`${text(row.label)}: ${amount(row.amount)}`} aria-pressed={selected === index} className="revenue-point"
        onPointerEnter={event => { if (event.pointerType !== 'touch' && !pinned) setSelected(index) }}
        onFocus={() => setSelected(index)}
        onClick={() => { setSelected(index); setPinned(true) }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(index); setPinned(true) } }}>
        <rect x={34 + index * step} y="20" width={step} height="165" fill="transparent" />
        {selected === index && <line x1={34 + index * step + step / 2} x2={34 + index * step + step / 2} y1="20" y2="180" className="revenue-crosshair" />}
        <rect x={34 + index * step} y={180 - number(row.amount) / max * 155} width={Math.max(1, step - 5)} height={Math.max(1, number(row.amount) / max * 155)} rx="3" className="dashboard-column" pointerEvents="none" />
        {index % Math.max(1, Math.ceil(data.length / 7)) === 0 && <text x={34 + index * step} y="204">{text(row.label).slice(-10)}</text>}
      </g>)}
    </svg>
    {point && <div className="revenue-tooltip" role="status" style={{ left: `${Math.max(20, Math.min(80, (34 + (selected! + .5) * step) / 640 * 100))}%` }}>
      <span>{text(point.label)} · Cairo</span><strong>{amount(point.amount)}</strong>
      {href && <Link to={href(point)}>View orders ↗</Link>}
      <button type="button" aria-label="Close revenue details" onClick={() => { setSelected(null); setPinned(false) }}>×</button>
    </div>}
  </div>
}

const chartColors = ['#5d5294', '#27885c', '#b87a14', '#64748b']
function sliceColor(row: AdminRecord, index: number) {
  const statusColors: Record<string, string> = { SUCCEEDED: '#27885c', PENDING: '#d97706', FAILED: '#b42318', UNKNOWN: '#64748b', Collected: '#27885c', Expired: '#b42318' }
  return statusColors[String(row.status ?? row.label)] || chartColors[index % chartColors.length]
}
export function Donut({ data, title, href, valueKey = 'count', pie = false }: { data: AdminRecord[]; title: string; href?: (row: AdminRecord) => string; valueKey?: string; pie?: boolean }) {
  const total = data.reduce((sum, row) => sum + number(row[valueKey]), 0)
  const id = useId()
  let offset = 0
  return <div className="dashboard-donut">
    <svg viewBox="0 0 160 160" role="img" aria-labelledby={id}>
      <title id={id}>{title}. {valueKey === 'amount' ? amount(total) : `${total} records`}. Breakdown follows.</title>
      <circle cx="80" cy="80" r="58" fill={pie ? '#e8eaf2' : 'none'} stroke="#e8eaf2" strokeWidth={pie ? 0 : 20} />
      {data.map((row, index) => {
        const share = total ? number(row[valueKey]) / total : 0
        const start = offset
        offset += share
        return <circle key={index} cx="80" cy="80" r={pie ? 29 : 58} pathLength="100" fill="none" stroke={sliceColor(row, index)} strokeWidth={pie ? 58 : 20} strokeDasharray={`${share * 100} ${100 - share * 100}`} strokeDashoffset={-start * 100} transform="rotate(-90 80 80)" />
      })}
      {!pie && <><text x="80" y="79" textAnchor="middle" className="dashboard-donut-total">{total}</text><text x="80" y="99" textAnchor="middle">records</text></>}
    </svg>
    <div className="dashboard-donut-key">{data.map((row, index) => {
      const label = <><span style={{ background: sliceColor(row, index) }} aria-hidden="true" /><strong>{text(row.status ?? row.label)}</strong><b>{total ? (number(row[valueKey]) / total * 100).toFixed(1) : '0'}%</b><small>{text(row.count)} {pie ? 'paid orders' : 'records'}{row.amount !== undefined && ` · ${amount(row.amount)}`}</small></>
      return href ? <Link to={href(row)} key={index}>{label}</Link> : <div key={index}>{label}</div>
    })}</div>
  </div>
}

export function ShoppingHeatmap({ data, start, end }: { data: AdminRecord[]; start: unknown; end: unknown }) {
  const [selected, setSelected] = useState<{ day: string; hour: number; count: number } | null>(null)
  const max = Math.max(1, ...data.map(item => number(item.count)))
  const days = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const period = `${date(start)} – ${date(end)}`
  return <div className="dashboard-heatmap">
    <div className="heatmap-scroll"><div className="dashboard-heatmap-grid" role="group" aria-label="Successful purchases by Cairo weekday and hour">
      {days.map((day, index) => <div key={day}><strong>{day.slice(0, 3)}</strong>{Array.from({ length: 24 }, (_, hour) => {
        const count = number(data.find(item => number(item.day) === (index + 5) % 7 && number(item.hour) === hour)?.count)
        const label = `${day} ${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00 · ${count} purchases · ${period} · Cairo`
        return <button key={hour} type="button" aria-label={label} aria-pressed={selected?.day === day && selected.hour === hour}
          style={{ backgroundColor: `rgba(93, 82, 148, ${.12 + count / max * .88})` }}
          onPointerEnter={event => { if (event.pointerType !== 'touch') setSelected({ day, hour, count }) }}
          onFocus={() => setSelected({ day, hour, count })} onClick={() => setSelected({ day, hour, count })} />
      })}</div>)}
    </div></div>
    {selected ? <p className="heatmap-selection" role="status"><strong>{selected.day} · {String(selected.hour).padStart(2, '0')}:00–{String(selected.hour + 1).padStart(2, '0')}:00 Cairo</strong><span>{selected.count} purchases · {period}</span></p> : <p className="admin-muted">Hover or tap a cell · 00:00 → 24:00 Cairo · Darker cells indicate more purchases</p>}
  </div>
}

export function History({ data, service, range }: { data: AdminRecord[]; service?: string; range?: unknown }) {
  const [selection, setSelection] = useState<{ group: string; time: number; row: AdminRecord | null } | null>(null)
  const [pinned, setPinned] = useState(false)
  const groups = [...new Set(data.map(row => text(row.service ?? row.machine)))].filter(value => !service || service === value)
  const timestamps = data.map(row => Date.parse(String(row.minute))).filter(Number.isFinite)
  const start = Date.parse(String(record(range).from)) || Math.min(...timestamps)
  const end = Date.parse(String(record(range).to)) || Math.max(...timestamps) + 60000
  const duration = Math.max(60000, end - start)
  function inspect(group: string, samples: AdminRecord[], fraction: number) {
    const time = start + Math.max(0, Math.min(.999999, fraction)) * duration
    const row = samples.find(item => {
      const stamp = Date.parse(String(item.minute))
      return stamp <= time && time < stamp + (number(item.interval_seconds) || 60) * 1000
    }) ?? null
    setSelection({ group, time, row })
  }
  return <div className="dashboard-history">
    {groups.length ? groups.map(group => {
      const samples = data.filter(row => text(row.service ?? row.machine) === group)
      const active = selection?.group === group ? selection : null
      const activeIndex = active?.row ? samples.indexOf(active.row) : samples.length - 1
      const state = text(active?.row?.state ?? active?.row?.connection_state, 'Unknown')
      return <div key={group} className="history-row"><strong>{group}</strong>
        <section className="history-timeline" onPointerLeave={() => { if (!pinned) setSelection(null) }}>
          <div className="dashboard-history-track" role="slider" tabIndex={0} aria-label={group + ' history'}
            aria-valuemin={0} aria-valuemax={Math.max(0, samples.length - 1)} aria-valuenow={Math.max(0, activeIndex)}
            aria-valuetext={active ? active.row ? date(active.row.minute) + ' · ' + state : 'No observation at ' + date(new Date(active.time).toISOString()) : 'Use arrow keys to inspect observations'}
            onPointerMove={event => {
              if (event.pointerType !== 'mouse' || pinned) return
              const bounds = event.currentTarget.getBoundingClientRect()
              inspect(group, samples, (event.clientX - bounds.left) / bounds.width)
            }}
            onClick={event => {
              const bounds = event.currentTarget.getBoundingClientRect()
              inspect(group, samples, (event.clientX - bounds.left) / bounds.width)
              setPinned(true)
            }}
            onFocus={() => {
              const row = samples.at(-1)
              if (row) setSelection({ group, time: Date.parse(String(row.minute)), row })
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') { setSelection(null); setPinned(false); return }
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const index = event.key === 'Home' ? 0 : event.key === 'End' ? samples.length - 1 : Math.max(0, Math.min(samples.length - 1, activeIndex + (event.key === 'ArrowRight' ? 1 : -1)))
              const row = samples[index]
              if (row) { setSelection({ group, time: Date.parse(String(row.minute)), row }); setPinned(true) }
            }}>
            {samples.map((row, index) => {
              const runtime = text(row.state ?? row.connection_state, 'Unknown')
              const tone = /unhealthy|failed/i.test(text(row.health)) ? 'bad' : /running|online/i.test(runtime) ? 'good' : /unknown|missing|no report/i.test(runtime) ? 'missing' : 'bad'
              const offset = Math.max(0, Date.parse(String(row.minute)) - start)
              const interval = number(row.interval_seconds) || 60
              return <span key={index} aria-hidden="true" className={tone} style={{ left: `${offset / duration * 100}%`, width: `${Math.max(0, Math.min(interval * 1000, duration - offset)) / duration * 100}%` }} />
            })}
          </div>
          {active && <aside className="history-tooltip" role="status">
            <header><strong>{group}</strong><button type="button" aria-label="Close history details" onClick={() => { setSelection(null); setPinned(false) }}>×</button></header>
            {active.row ? <>
              <p className="history-tooltip-time">{date(active.row.minute)} · Cairo</p>
              <dl>
                <div><dt>{'maintenance' in active.row ? 'App connection' : 'Container'}</dt><dd>{state.replace(/_/g, ' ')}</dd></div>
                {'health' in active.row && <div><dt>Application health</dt><dd>{text(active.row.health, 'Unmeasured')}</dd></div>}
                {'maintenance' in active.row && <>
                  <div><dt>Availability</dt><dd>{active.row.maintenance ? 'Maintenance' : active.row.disabled ? 'Disabled' : 'Trading enabled'}</dd></div>
                  <div><dt>Customer session</dt><dd>{active.row.session_active === true ? 'In session' : active.row.session_active === false ? 'Idle' : 'Unknown'}</dd></div>
                  <div><dt>Last app report</dt><dd>{date(active.row.last_seen_at)}</dd></div>
                </>}
              </dl>
              {!!active.row.gap_before && <p>Earlier observations are missing.</p>}
            </> : <><p className="history-tooltip-time">{date(new Date(active.time).toISOString())} · Cairo</p><p>No observation recorded at this time.</p></>}
          </aside>}
        </section>
      </div>
    }) : <Empty title="History starts with recorded observations" />}
    <p className="admin-muted">{date(Number.isFinite(start) ? new Date(start).toISOString() : null)} — {date(Number.isFinite(end) ? new Date(end).toISOString() : null)} · Green: running/connected · Red: observed interruption or unhealthy · Background: no observation</p>
  </div>
}
