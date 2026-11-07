import { useState } from 'react'
import { useScreenReady } from '@have/shared/telemetry/react'
import { Button } from '@have/shared/ui/controls'
import { ownerApi, type AdminRecord, type MetricBucket } from '@have/shared/api/owner'
import { date, number, text, useRead } from '../../../app/hooks'
import { Details, Dialog, Empty, Panel, ReadState, RecordsTable } from '../../../components/ui'

const labels: Record<string, string> = { page_view: 'Page views', screen_load_ms: 'Screen load', lcp_ms: 'Largest contentful paint', inp_ms: 'Interaction to next paint', cls: 'Layout shift', frontend_error: 'Frontend errors', api_error: 'Client API errors', client_request_ms: 'Client request', api_request_ms: 'Backend request', api_server_error: 'Server errors', api_client_rejection: 'Validation / authorization rejections', client_timeout: 'Client request timeouts', provider_timeout: 'Payment-provider timeouts' }
const usageMetric = (metric: string) => metric.startsWith('feature.') || /^(order|payment|refund|receipt)\./.test(metric)
const metricName = (metric: string) => labels[metric] ?? metric.replace(/^feature\./, '').replace(/[._]/g, ' ')
function aggregate(items: MetricBucket[]) {
  const combined = new Map<string, AdminRecord>()
  for (const row of items) {
    const key = [row.metric, row.app, row.route, row.unit].join(':'), before = combined.get(key), buckets: Record<string, number> = { ...before?.buckets as Record<string, number> }
    if (row.buckets && typeof row.buckets === 'object') for (const [bound, count] of Object.entries(row.buckets)) if (typeof count === 'number') buckets[bound] = (buckets[bound] ?? 0) + count
    combined.set(key, { id: key, metric: row.metric, app: row.app, route: row.route, unit: row.unit, count: number(before?.count) + row.count, sum: number(before?.sum) + row.sum, min: before ? Math.min(number(before.min), row.min) : row.min, max: before ? Math.max(number(before.max), row.max) : row.max, buckets })
  }
  return [...combined.values()].sort((a, b) => String(a.metric).localeCompare(String(b.metric)))
}
function requestRates(items: MetricBucket[]) {
  const groups = new Map<string, AdminRecord>(), fields: Record<string, string> = { api_request_ms: 'requests', api_server_error: 'errors', api_client_rejection: 'rejections', client_timeout: 'client_timeouts', provider_timeout: 'provider_timeouts' }
  for (const item of items) {
    const field = fields[item.metric]; if (!field) continue
    const key = `${item.app}:${item.route}`, previous = groups.get(key) ?? { id: key, app: item.app, route: item.route }
    groups.set(key, { ...previous, [field]: number(previous[field]) + item.count })
  }
  return [...groups.values()]
}
export function MetricsView({ usage = false }: { usage?: boolean }) {
  const [app, setApp] = useState(''), [windowMinutes, setWindowMinutes] = useState('60'), [selected, setSelected] = useState<AdminRecord | null>(null)
  const read = useRead(signal => ownerApi.metrics({ window_minutes: windowMinutes, ...(app ? { app } : {}) }, signal), `metrics:${usage}:${app}:${windowMinutes}`, 15_000)
  const items = read.data?.items.filter(row => !row.metric.startsWith('resource.') && usageMetric(row.metric) === usage) ?? [], rows = aggregate(items), rates = requestRates(items)
  const summaries = usage ? ['feature.browse', 'feature.checkout_start', 'order.completed', 'order.collected'] : ['screen_load_ms', 'lcp_ms', 'inp_ms', 'frontend_error']
  useScreenReady(!!read.data && !read.error)
  return <>
    <div className="admin-toolbar"><label className="admin-filter-label">Application<select value={app} onChange={event => { setApp(event.target.value); setSelected(null) }}><option value="">All applications</option>{['hub', 'kiosk', 'advisor', 'admin', 'backend'].map(name => <option key={name}>{name}</option>)}</select></label><label className="admin-filter-label">Time window<select value={windowMinutes} onChange={event => { setWindowMinutes(event.target.value); setSelected(null) }}><option value="15">Last 15 minutes</option><option value="60">Last hour</option><option value="1440">Last 24 hours</option><option value="10080">Last 7 days</option></select></label><Button onClick={read.refresh}>Refresh measurements</Button></div>
    <ReadState {...read} /><p className="admin-live-caption">{read.data?.observed_at ? `Observed ${date(read.data.observed_at)}` : 'Waiting for measurements'}</p>
    {read.data?.truncated && <p className="admin-warning" role="status">This view is limited to the first 5,000 measurement buckets. Narrow the application or time window before comparing totals.</p>}
    <div className="admin-stats-grid">{summaries.map(metric => { const matches = items.filter(row => row.metric === metric), count = matches.reduce((sum, row) => sum + row.count, 0), sum = matches.reduce((value, row) => value + row.sum, 0), duration = metric.endsWith('_ms'); return <div className="admin-stat-card" key={metric}><span>{metricName(metric)}</span><strong>{count ? duration ? `${(sum / count).toLocaleString('en', { maximumFractionDigits: 0 })} ms` : count.toLocaleString('en') : '—'}</strong><small>{count ? duration ? `Average of ${count} measurements` : 'Recorded events in this window' : 'No measurements in this window'}</small></div> })}</div>
    {!usage && rates.length > 0 && <Panel title="Request reliability" description="Server-error rate is recorded server errors divided by recorded backend requests for the same application and route. Validation and authorization rejections are counted separately."><RecordsTable rows={rates} columns={[{ key: 'app', label: 'Application' }, { key: 'route', label: 'Route' }, { key: 'requests', label: 'Backend requests' }, { key: 'errors', label: 'Server errors', render: row => row.requests ? number(row.errors).toLocaleString('en') : text(row.errors) }, { key: 'rate', label: 'Server-error rate', render: row => number(row.requests) > 0 ? `${(number(row.errors) / number(row.requests) * 100).toFixed(2)}%` : 'Not measured' }, { key: 'rejections', label: 'Validation / auth rejections' }, { key: 'client_timeouts', label: 'Client timeouts' }, { key: 'provider_timeouts', label: 'Provider timeouts' }]} /></Panel>}
    <Panel title={usage ? 'Feature use & completed outcomes' : 'Measured experience by application and route'} description={usage ? 'Anonymous event counts indicate feature use, not unique people or a conversion rate. Payment and order outcomes are verified on the backend.' : 'Durations are arithmetic averages of received samples. View a distribution to see how those samples are spread. Route labels contain no entered text or customer identifiers.'}>
      {rows.length ? <RecordsTable rows={rows} columns={[{ key: 'metric', label: 'Measurement', render: row => <strong className="admin-capitalize">{metricName(String(row.metric))}</strong> }, { key: 'app', label: 'Application' }, { key: 'route', label: 'Route' }, { key: 'count', label: usage ? 'Events' : 'Samples', render: row => number(row.count).toLocaleString('en') }, ...(!usage ? [{ key: 'average', label: 'Average', render: (row: AdminRecord) => row.unit === 'ms' ? `${(number(row.sum) / number(row.count)).toFixed(1)} ms` : row.metric === 'cls' ? (number(row.sum) / number(row.count)).toFixed(3) : '—' }, { key: 'max', label: 'Maximum', render: (row: AdminRecord) => row.unit === 'ms' ? `${number(row.max).toFixed(1)} ms` : row.metric === 'cls' ? number(row.max).toFixed(3) : '—' }, { key: 'distribution', label: 'Distribution', render: (row: AdminRecord) => ['ms', 'score'].includes(String(row.unit)) ? <Button onClick={() => setSelected(row)}>View distribution</Button> : '—' }] : [])]} /> : !read.loading && <Empty title="No measurements in this window">Measurements appear after applications are used. Missing data does not mean there were no problems.</Empty>}
    </Panel>
    <p className="admin-muted admin-privacy-note">Telemetry uses allowlisted route and event labels. It does not capture input contents, passwords, screen replay or clinical information.</p>
    {selected && <Distribution record={selected} close={() => setSelected(null)} />}
  </>
}
function Distribution({ record, close }: { record: AdminRecord; close: () => void }) {
  const unit = String(record.unit), stored = record.buckets as Record<string, number>, bounds = unit === 'ms' ? [50, 100, 200, 500, 1000, 2500, 5000, 10000, 30000, 120000] : [.1, .25, .5, 1, 5, 10]
  const rows = [...bounds.map((bound, index) => ({ id: String(bound), interval: `${index ? `> ${bounds[index - 1]} to` : '0 to'} ${bound}${unit === 'ms' ? ' ms' : ''}`, samples: stored?.[String(bound)] ?? 0 })), { id: 'overflow', interval: `> ${bounds.at(-1)}${unit === 'ms' ? ' ms' : ''}`, samples: stored?.overflow ?? 0 }]
  return <Dialog title={`${metricName(String(record.metric))} distribution`} close={close}><Details record={{ ...record, metric: metricName(String(record.metric)) }} fields={[{ key: 'app', label: 'Application' }, { key: 'route', label: 'Route' }, { key: 'unit', label: 'Unit' }, { key: 'count', label: 'Total samples' }]} /><p className="admin-muted">Each sample belongs to one interval; counts are not cumulative. This distribution describes the selected time window at the time it was opened.</p><RecordsTable rows={rows} columns={[{ key: 'interval', label: 'Measured interval' }, { key: 'samples', label: 'Samples' }, { key: 'share', label: 'Share of samples', render: row => number(record.count) > 0 ? `${(number(row.samples) / number(record.count) * 100).toFixed(1)}%` : 'Not measured' }]} /></Dialog>
}
