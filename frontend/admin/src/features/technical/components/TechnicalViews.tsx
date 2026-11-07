import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@have/shared/ui/controls'
import { ownerApi, type AdminRecord } from '@have/shared/api/owner'
import { date, number, text, useRead } from '../../../app/hooks'
import { Badge, Details, Dialog, PageHeader, Panel, ReadState, RecordsTable } from '../../../components/ui'
import { Trend, History, percentile, record, rows } from '../../../components/charts'
import { ResourceView } from '../pages/TechnicalPage'

export function Health() {
  const [params, setParams] = useSearchParams(), [minutes, setMinutes] = useState(60)
  const service = params.get('service') || '', at = params.get('at') || ''
  const summary = useRead(signal => ownerApi.technicalSummary(signal), 'technical-health', 15_000)
  const system = useRead(signal => ownerApi.system(minutes, signal, at), `health-system:${minutes}:${at}`, 15_000)
  const data = summary.data, backlog = record(data?.backlog), selected = data?.services.find(item => item.service === service)
  const open = (row: AdminRecord) => setParams({ tab: 'health', service: String(row.service), ...(at ? { at } : {}) })
  return <>
    <ReadState {...summary} /><ReadState {...system} />
    <div className="admin-toolbar"><label className="admin-filter-label">History window<select value={minutes} onChange={event => setMinutes(Number(event.target.value))}><option value="60">Last hour</option><option value="1440">Last 24 hours</option><option value="10080">Last 7 days</option></select></label><Button onClick={() => { summary.refresh(); system.refresh() }}>Refresh health</Button><span className="admin-muted">Observed {date(data?.observed_at)}</span></div>
    {at && <p className="admin-notice">Investigating observations up to {date(at)}. The summary and current service states below remain live.</p>}
    {data && <><div className="admin-stats-grid"><div className="admin-stat-card"><span>Containers running</span><strong>{data.services.filter(row => row.state === 'running').length} / {data.services.length}</strong></div><Link className="admin-stat-card" to="/technical?tab=incidents"><span>Open incidents</span><strong>{data.incidents_open}</strong></Link><div className="admin-stat-card"><span>API response p95</span><strong className="technical-percentile">{percentile(record(system.data?.api).p95)}</strong><small>Selected observation window</small></div><div className="admin-stat-card"><span>Oldest due work</span><strong>{backlog.oldest_due_seconds === null || backlog.oldest_due_seconds === undefined ? 'None due' : `${Math.ceil(number(backlog.oldest_due_seconds) / 60)} min`}</strong><small>{text(backlog.due, '0')} items due now</small></div></div>
      <Panel title="Services"><RecordsTable rows={data.services} columns={[{ key: 'service', label: 'Service' }, { key: 'state', label: 'Container', render: row => <Badge value={row.state} /> }, { key: 'health', label: 'Latest evidence', render: row => <><Badge value={row.health} />{row.service === 'order-worker' && <small>{text(data.worker.state)} · {text(backlog.due, '0')} due jobs</small>}</> }, { key: 'observed_at', label: 'Last observed', render: row => <>{date(row.observed_at)} {!!row.stale && <Badge value="Stale" />}</> }]} open={open} rowLabel={row => text(row.service)} /></Panel>
      <Panel title="Service history"><History data={rows(system.data?.history)} range={system.data?.range} /></Panel>
      <div className="dashboard-grid"><Panel title="Dependencies"><RecordsTable rows={Object.entries(data.dependencies).map(([name, values]) => ({ service: name, ...values }))} columns={[{ key: 'service', label: 'Dependency' }, { key: 'status', label: 'Health', render: row => <Badge value={row.status} /> }, { key: 'latency_ms', label: 'Probe duration', render: row => row.latency_ms === null ? 'Not measured' : `${number(row.latency_ms).toFixed(1)} ms` }]} /></Panel><Panel title="Host agent"><Details record={data.agent} fields={[{ key: 'status', label: 'Connection' }, { key: 'last_seen_at', label: 'Last seen', date: true }]} /></Panel></div>
    </>}
    {selected && <Dialog title={`${service} health`} close={() => setParams({ tab: 'health' })}><Details record={selected} fields={[{ key: 'state', label: 'Container' }, { key: 'health', label: 'Health' }, { key: 'observed_at', label: 'Last observed', date: true }]} />{service === 'kiosk' && <p className="admin-notice">Shared Kiosk application service. <Link to="/kiosks">Inspect individual machines ↗</Link></p>}{service === 'order-worker' && data && <><Details record={data.worker} fields={[{ key: 'state', label: 'Worker state' }, { key: 'last_heartbeat_at', label: 'Heartbeat', date: true }, { key: 'last_completed_at', label: 'Last completed cycle', date: true }]} /><RecordsTable rows={rows(system.data?.history).filter(row => row.service === service).map(row => ({ minute: row.minute, ...record(row.backlog) }))} columns={[{ key: 'minute', label: 'Observed', render: row => date(row.minute) }, { key: 'due', label: 'Due work' }, { key: 'oldest_due_seconds', label: 'Oldest due (seconds)' }]} /></>}
      {selected.manageable ? <Link className="admin-link-button" to={`/technical?tab=service-controls&service=${service}`}>Manage {service} ↗</Link> : <Badge value="Protected" />}
      <ResourceView key={`${service}:${minutes}:${at}`} service={service} minutes={minutes} at={at} />
    </Dialog>}
  </>
}

export function Usage() {
  const [app, setApp] = useState(''), [minutes, setMinutes] = useState(1440), [feature, setFeature] = useState('search')
  const read = useRead(signal => ownerApi.usage(minutes, app, feature, signal), `usage:${minutes}:${app}:${feature}`, 15_000)
  const data = read.data, features = rows(data?.items)
  const activity = rows(data?.series).filter(row => row.feature === feature)
  const applications = [...new Set(activity.map(row => String(row.app)))]
  return <><div className="admin-toolbar"><label className="admin-filter-label">Application<select value={app} onChange={event => setApp(event.target.value)}><option value="">All applications</option>{['hub', 'kiosk', 'advisor', 'admin'].map(value => <option key={value}>{value}</option>)}</select></label><label className="admin-filter-label">Period<select value={minutes} onChange={event => setMinutes(Number(event.target.value))}><option value="60">Last hour</option><option value="1440">Last 24 hours</option><option value="10080">Last 7 days</option></select></label><Button onClick={read.refresh}>Refresh usage</Button></div><ReadState {...read} />
    <Panel title="Feature activity" description="Recorded actions. One person searching three times contributes three searches."><RecordsTable rows={features} columns={[{ key: 'feature', label: 'Feature', render: row => <button className="admin-text-button" onClick={() => setFeature(String(row.feature))}>{String(row.feature).replace(/_/g, ' ')}</button> }, { key: 'count', label: 'Actions', render: row => <div className="usage-count"><strong>{text(row.count)}</strong><i style={{ width: `${number(row.count) / Math.max(1, ...features.map(item => number(item.count))) * 100}%` }} /></div> }, { key: 'change_percent', label: 'Previous period', render: row => row.change_percent === null || row.change_percent === undefined ? 'No comparison available' : `${number(row.change_percent) > 0 ? '+' : ''}${number(row.change_percent).toFixed(1)}%` }]} /></Panel>
    <Panel title={`${feature.replace(/_/g, ' ')} over time`} description={`${date(record(data?.range).from)} – ${date(record(data?.range).to)}`}><label className="admin-filter-label">Selected feature<select value={feature} onChange={event => setFeature(event.target.value)}>{features.map(row => <option value={String(row.feature)} key={String(row.feature)}>{String(row.feature).replace(/_/g, ' ')}</option>)}</select></label><div className="dashboard-grid">{applications.map(application => <section key={application}><h3>{application}</h3><Trend title={`${application} activity`} data={activity.filter(row => row.app === application).map(row => ({ minute: row.minute, value: row.count }))} /></section>)}</div>{!applications.length && <p className="admin-muted">No recorded actions for this selection.</p>}</Panel>
  </>
}
