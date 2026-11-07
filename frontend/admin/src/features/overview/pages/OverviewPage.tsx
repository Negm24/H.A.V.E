import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useScreenReady } from '@have/shared/telemetry/react'
import { ownerApi } from '@have/shared/api/owner'
import { amount, date, number, text, useRead } from '../../../app/hooks'
import { Badge, PageHeader, Panel, ReadState, RecordsTable } from '../../../components/ui'
import { Bars, Columns, Donut, ShoppingHeatmap, History, percentile, record, rows } from '../../../components/charts'

import { ExpirySummary } from '../components/ExpirySummary'
import { FleetCards } from '../components/FleetCards'
import { ApiLatencyChart, ResourcePillars } from '../components/SystemCharts'

const cards = [
  ['pending_doctors', 'Pending doctors', '/doctors'],
  ['review_payments', 'Payments to review', '/orders?financial_attention=NEEDS_ATTENTION'],
  ['pending_receipts', 'Receipt deliveries', '/orders?receipt_pending=1'],
  ['low_stock', 'Low-stock lines (≤5 packs)', '/inventory'],
] as const

export function OverviewPage() {
  const [params, setParams] = useSearchParams(), period = params.get('period') || 'month'
  const [analytics, setAnalytics] = useState('products'), [measure, setMeasure] = useState('amount')
  const counts = useRead(signal => ownerApi.overview(signal), 'overview', 15_000)
  const business = useRead(signal => ownerApi.business(period, signal), `business:${period}`, 15_000)
  const system = useRead(signal => ownerApi.system(60, signal), 'overview-system', 15_000)
  const fleet = useRead(signal => ownerApi.fleet(signal, period), `overview-fleet:${period}`, 15_000)
  const machineHistory = useRead(signal => ownerApi.history(60, '', signal, 'machine'), 'overview-history', 15_000)
  const data = business.data, stats = record(data?.analytics), tech = system.data
  const machineData = fleet.data, waiting = record(machineData?.waiting_collections), collection = record(machineData?.collection_outcomes)
  const orderLink = (extra: Record<string, string> = {}) => '/orders?' + new URLSearchParams({ period, ...(data ? { start: String(data.start), end: String(data.end) } : {}), ...extra })
  useScreenReady(!!counts.data && !counts.error)
  return <>
    <PageHeader title="Overview" description="Business, system health and the Kiosk network." />
    <ReadState {...counts} />
    <div className="admin-stats-grid">{cards.map(([key, label, to]) => <Link className="admin-stat-card" to={to} key={key}><span>{label}</span><strong>{counts.data ? number(counts.data[key]).toLocaleString('en') : '—'}</strong><small>{key === 'low_stock' ? 'Batch records with 0–5 packs on hand' : 'Now · Open records ↗'}</small></Link>)}</div>

    <div className="dashboard-section-heading"><h2>Business overview</h2><label className="admin-filter-label">Business period<select value={period} onChange={event => setParams({ period: event.target.value })}>{[['all', 'All time'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <ReadState {...business} />
    {data && <>
      <div className="dashboard-grid"><Panel title="Total revenue" description={`${date(data.start)} – ${date(data.end)} · Cairo · Confirmed payment date`}><div className="dashboard-money"><Link to={orderLink({ date_basis: 'capture_confirmed' })}><span>Total received</span><strong>{amount(data.gross_received)}</strong></Link><Link to={orderLink({ date_basis: 'refund_confirmed' })}><span>Confirmed refunds</span><b>{amount(data.confirmed_refunds)}</b></Link><div><span>Net received</span><b>{amount(data.net_received)}</b></div></div><Columns key={period} title="Revenue" data={rows(data.revenue)} href={row => orderLink({ date_basis: 'capture_confirmed', start: String(row.start), end: String(row.end) })} /></Panel>
        <Panel title="Payment outcomes" description="Purchase transactions initiated in this period, grouped by their current stored status."><Donut title="Payment outcomes" data={rows(data.payments)} href={row => orderLink({ date_basis: 'capture_initiated', transaction_status: String(row.status) })} /><details><summary>Refunds by status</summary><RecordsTable rows={rows(data.refunds)} columns={[{ key: 'status', label: 'Refund status' }, { key: 'count', label: 'Count' }, { key: 'amount', label: 'Amount', render: row => <Link to={orderLink({ date_basis: 'refund_initiated', transaction_status: String(row.status) })}>{amount(row.amount)}</Link> }]} /></details></Panel></div>
      <Panel title="Analytics"><div className="admin-toolbar"><label className="admin-filter-label">Analysis<select value={analytics} onChange={event => setAnalytics(event.target.value)}>{[['products', 'Sales by product'], ['categories', 'Sales by category'], ['channels', 'Hub versus Kiosk'], ['average', 'Average paid order value'], ['heatmap', 'Busy shopping times'], ['kiosks', 'Sales by Kiosk']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{!['average', 'heatmap'].includes(analytics) && <label className="admin-filter-label">Measure<select value={measure} onChange={event => setMeasure(event.target.value)}><option value="amount">EGP received</option><option value={['products', 'categories'].includes(analytics) ? 'quantity' : 'count'}>{['products', 'categories'].includes(analytics) ? 'Packs' : 'Paid orders'}</option></select></label>}</div>
        {analytics === 'average' ? <div className="dashboard-average"><strong>{amount(stats.average_order_value)}</strong><span>Average paid order value</span><p>Previous equivalent period: {stats.previous_average_order_value === null ? 'No comparison available' : amount(stats.previous_average_order_value)}</p></div> : analytics === 'heatmap' ? <ShoppingHeatmap key={period} data={rows(stats.heatmap)} start={data.start} end={data.end} /> : analytics === 'channels' ? <Donut pie title="Hub versus Kiosk" valueKey={measure === 'amount' ? 'amount' : 'count'} data={rows(stats.channels).map(row => ({ ...row, label: row.id === 'TERMINAL' ? 'Kiosk' : row.label }))} href={row => orderLink({ date_basis: 'capture_confirmed', channel: String(row.id) })} /> : <Bars showData={false} title="Sales analysis" data={rows(stats[analytics])} valueKey={measure === 'amount' ? 'amount' : ['products', 'categories'].includes(analytics) ? 'quantity' : 'count'} money={measure === 'amount'} href={row => orderLink({ date_basis: 'capture_confirmed', ...(analytics === 'kiosks' ? { terminal_serial: String(row.id) } : analytics === 'products' ? { product_id: String(row.id) } : analytics === 'channels' ? { channel: String(row.label) } : { category: String(row.label) }) })} />}
        {analytics === 'categories' && !!stats.category_uses_current_catalogue && <p className="admin-muted">Older sales use current catalogue categories.</p>}
      </Panel>
    </>}

    <div className="dashboard-section-heading"><h2>System health</h2><Link to="/technical">Inspect system ↗</Link></div><ReadState {...system} />
    {tech && <><Panel title="Services now"><div className="dashboard-service-strip">{rows(tech.services).map(service => <Link key={String(service.service)} to={`/technical?tab=health&service=${String(service.service)}`}><strong>{text(service.service)}</strong><Badge value={service.state} tone={service.state === 'running' ? 'positive' : service.state === 'exited' ? 'negative' : undefined} /><small>{text(service.health)}</small></Link>)}</div></Panel><div className="dashboard-grid"><Panel title="API response time" description="Last hour · Backend processing time · p95 estimate"><strong className="dashboard-large-value">{percentile(record(tech.api).p95)}</strong><ApiLatencyChart series={rows(record(tech.api).series)} range={tech.range} intervalSeconds={number(record(tech.api).sampling_interval_seconds) || 60} /></Panel>
      <Panel title="Windows host" description={`Resource observation ${date(tech.resources_observed_at)} · ${text(tech.freshness, 'Unknown')}`}>
        <div className="dashboard-money">
          <div><span>CPU</span><strong>{record(tech.host).cpu_percent === null || record(tech.host).cpu_percent === undefined ? 'Not measured' : `${number(record(tech.host).cpu_percent).toFixed(1)}%`}</strong></div>
          <div><span>RAM</span><strong>{record(tech.host).memory_used_bytes === null || record(tech.host).memory_used_bytes === undefined ? 'Not measured' : `${(number(record(tech.host).memory_used_bytes) / 1048576).toFixed(1)} MiB`}</strong></div>
        </div>
        <ResourcePillars containers={rows(tech.containers)} />
      </Panel></div>
      <Panel title="Page experience" description="p75 estimates · Browser observations in the last hour"><RecordsTable rows={rows(tech.experience)} columns={[{ key: 'app', label: 'App' }, { key: 'metric', label: 'Measurement', render: row => text(row.metric).replace(/_/g, ' ') }, { key: 'p75', label: '75th percentile', render: row => percentile(row.p75) }, { key: 'count', label: 'Samples' }]} /></Panel><details className="dashboard-history-panel"><summary>Service availability history · Last hour</summary><History data={rows(tech.history)} range={tech.range} /></details><p className="admin-observed">Observed {date(tech.observed_at)}</p></>}

    <div className="dashboard-section-heading"><h2>Kiosks overview</h2><Link to="/kiosks">Manage machines ↗</Link></div><ReadState {...fleet} />
    {machineData && <><Panel title="Fleet now"><FleetCards machines={rows(machineData.machines)} /></Panel><div className="dashboard-grid"><Panel title="Waiting collections" description="Now"><Link className="dashboard-large-value" to="/orders?waiting_collection=1">{text(waiting.count, '0')} orders</Link><p>{amount(waiting.amount)}</p><p>Nearest deadline: {date(waiting.nearest_deadline)}</p></Panel><Panel title="Collection outcomes" description={`Paid orders requiring pickup · ${date(machineData.start)} – ${date(machineData.end)}`}><Donut title="Collection outcomes" data={[{ label: 'Collected', count: number(collection.collected) }, { label: 'Expired', count: number(collection.expired) }]} /></Panel></div><Panel title="Expiring stock" description="Now · Packs on hand in Kiosks · Cairo dates · Select a total for its Kiosk breakdown"><ExpirySummary stock={rows(machineData.expiring_stock)} /></Panel><details className="dashboard-history-panel"><summary>Machine connection history · Last hour</summary><History data={rows(machineHistory.data?.items)} range={machineHistory.data?.range} /></details></>}
  </>
}
