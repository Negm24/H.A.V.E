import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Button } from '@have/shared/ui/controls'
import { ownerApi, type AdminRecord, type OwnerAction } from '@have/shared/api/owner'
import { date, number, text, useRead, useRecords, useTask } from '../../../app/hooks'
import { Badge, Details, Dialog, PageHeader, Pagination, Panel, ReadState, RecordsTable } from '../../../components/ui'
import { record, rows } from '../../../components/charts'
import { Health, Usage } from '../components/TechnicalViews'

const tabs = ['Health', 'Usage', 'Incidents', 'Service controls']
export function TechnicalPage() {
  const [params, setParams] = useSearchParams(), tab = params.get('tab') || 'health'
  if (tab === 'experience') return <Navigate to="/?panel=experience" replace />
  if (tab === 'resources') return <Navigate to="/technical?tab=health&service=hub" replace />
  return <><PageHeader title="Technical" description="System health, application activity and controlled recovery." /><div className="admin-tabs" role="tablist" aria-label="Technical views">{tabs.map((name, index) => {
    const key = name.toLowerCase().replace(' ', '-')
    return <button role="tab" key={key} id={`technical-tab-${index}`} aria-selected={tab === key} aria-controls="technical-content" onClick={() => setParams({ tab: key })} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { const next = (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4; setParams({ tab: tabs[next]!.toLowerCase().replace(' ', '-') }); document.getElementById(`technical-tab-${next}`)?.focus() } }}>{name}</button>
  })}</div><div id="technical-content" role="tabpanel">{tab === 'usage' ? <Usage /> : tab === 'incidents' ? <Incidents /> : tab === 'service-controls' ? <ServiceControls /> : <Health />}</div></>
}

export function ResourceView({ service = 'host', minutes = 15, at = '' }: { service?: string; minutes?: number; at?: string }) {
  const read = useRead(signal => ownerApi.resources(signal, minutes, at), `resources:${service}:${minutes}:${at}`, 5000)
  const samples = read.data?.samples ?? []
  const measurements = samples.map(sample => {
    const container = sample.containers.find(item => item.service === service)
    return { timestamp: sample.timestamp, cpu: service === 'host' ? sample.host.cpu_percent : container?.cpu_percent ?? null, memory: service === 'host' ? sample.host.memory_used_bytes : container?.memory_bytes ?? null }
  })
  return <Panel title={`${service} resources`} description={`Selected ${minutes}-minute window · ${date(read.data?.observed_at)}`}><ReadState {...read} /><Badge value={read.data?.freshness ?? 'No data'} /><div className="dashboard-grid"><ResourceLine title="CPU utilization" data={measurements.map(item => ({ timestamp: item.timestamp, value: item.cpu }))} unit="%" /><ResourceLine title="Memory used" data={measurements.map(item => ({ timestamp: item.timestamp, value: item.memory === null ? null : item.memory / 1048576 }))} unit="MiB" /></div><details><summary>View resource measurements</summary><RecordsTable rows={measurements} columns={[{ key: 'timestamp', label: 'Observed', render: row => date(row.timestamp) }, { key: 'cpu', label: 'CPU (%)', render: row => row.cpu === null ? 'Not measured' : number(row.cpu).toFixed(1) }, { key: 'memory', label: 'Memory (MiB)', render: row => row.memory === null ? 'Not measured' : (number(row.memory) / 1048576).toFixed(1) }]} /></details></Panel>
}
function ResourceLine({ title, data, unit }: { title: string; data: { timestamp: string; value: number | null }[]; unit: string }) {
  const points = data.filter((_, index) => index % Math.max(1, Math.ceil(data.length / 120)) === 0 || index === data.length - 1)
  const max = Math.max(1, ...points.map(item => item.value ?? 0)), first = Date.parse(points[0]?.timestamp || ''), last = Date.parse(points.at(-1)?.timestamp || '')
  const x = (time: string) => 30 + (last > first ? (Date.parse(time) - first) / (last - first) * 550 : 275)
  const segments: string[] = []; let segment = ''
  points.forEach((point, index) => {
    if (point.value === null || index > 0 && Date.parse(point.timestamp) - Date.parse(points[index - 1]!.timestamp) > (data.length > 180 ? 120000 : 15000)) { if (segment) segments.push(segment); segment = '' }
    if (point.value !== null) segment += `${segment ? 'L' : 'M'}${x(point.timestamp)},${160 - point.value / max * 135} `
  })
  if (segment) segments.push(segment)
  return <section className="admin-chart"><h3>{title}</h3><strong>{points.at(-1)?.value === null || !points.length ? 'Not measured' : `${points.at(-1)!.value!.toFixed(1)} ${unit}`}</strong><svg viewBox="0 0 610 195" role="img" aria-label={`${title} over time, ${data.length} observations; measurements below`}><line x1="30" x2="580" y1="160" y2="160" className="admin-chart-grid" />{segments.map((path, index) => <path key={index} d={path} fill="none" className="admin-chart-line" />)}<text x="30" y="185">{date(points[0]?.timestamp)}</text><text x="580" y="185" textAnchor="end">{date(points.at(-1)?.timestamp)}</text></svg><p className="admin-muted">{data.length} observations · {points.filter(item => item.value !== null).length} displayed values</p></section>
}

function Incidents() {
  const [status, setStatus] = useState('OPEN'), [selected, setSelected] = useState<AdminRecord | null>(null)
  const read = useRecords('technical/incidents', status ? { status } : {}), task = useTask()
  const destination = record(selected?.destination)
  return <><div className="admin-toolbar"><label className="admin-filter-label">Incident status<select value={status} onChange={event => { setStatus(event.target.value); read.setPage(1) }}><option value="OPEN">Open</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option><option value="">All incidents</option></select></label><Button onClick={read.refresh}>Refresh incidents</Button></div><ReadState {...read} /><Panel><RecordsTable rows={read.data?.items ?? []} columns={[{ key: 'summary', label: 'Incident' }, { key: 'where', label: 'Where', render: row => Object.values(record(row.where)).filter(Boolean).join(' → ') || text(row.target_id) }, { key: 'severity', label: 'Severity', render: row => <Badge value={row.severity} /> }, { key: 'status', label: 'Status', render: row => <Badge value={row.status} /> }, { key: 'occurrences', label: 'Occurrences' }, { key: 'last_seen_at', label: 'Last seen', render: row => date(row.last_seen_at) }]} open={setSelected} rowLabel={row => text(row.summary)} /><Pagination data={read.data} page={read.page} change={read.setPage} /></Panel>
    {selected && <Dialog title="Incident details" close={() => setSelected(null)} busy={task.busy}><h3>{text(selected.summary)}</h3><Badge value={selected.status} /><p>{Object.values(record(selected.where)).filter(Boolean).join(' → ')}</p><Details record={selected} fields={[{ key: 'trigger', label: 'Why it was raised' }, { key: 'impact', label: 'Known impact' }, { key: 'cause', label: 'Cause' }, { key: 'first_seen_at', label: 'First seen', date: true }, { key: 'last_seen_at', label: 'Last seen', date: true }, { key: 'occurrences', label: 'Occurrences' }]} />{!!destination.href && <Link className="admin-link-button" to={String(destination.href)}>{text(destination.label)} ↗</Link>}<p className="admin-muted">Acknowledgment records review. Resolution follows observed recovery.</p>{task.error && <p role="alert" className="admin-error">{task.error}</p>}<Button disabled={task.busy || selected.status !== 'OPEN'} onClick={() => void task.run(signal => ownerApi.acknowledgeIncident(String(selected.id), signal), result => { setSelected(result); read.refresh() })}>Acknowledge incident</Button></Dialog>}
  </>
}

function ServiceControls() {
  const [params] = useSearchParams(), requestedService = params.get('service'), requestedJob = params.get('job')
  const read = useRead(signal => ownerApi.services(signal), 'technical-services', 15_000), [selected, setSelected] = useState<AdminRecord | null>(null)
  useEffect(() => { if (requestedService && read.data) { const row = read.data.items.find(item => item.service === requestedService); if (row) setSelected(row) } }, [requestedService, !!read.data])
  return <>{requestedJob && <ExistingAction id={requestedJob} />}<p className="admin-notice">Service controls run through the private host agent. Backend, database, Redis and Admin are protected.</p><ReadState {...read} /><Button onClick={read.refresh}>Refresh services</Button><Panel title="Allowlisted services"><RecordsTable rows={read.data?.items ?? []} columns={[{ key: 'service', label: 'Service' }, { key: 'state', label: 'State', render: row => <Badge value={row.state} /> }, { key: 'health', label: 'Health', render: row => <Badge value={row.health} /> }, { key: 'last_action', label: 'Last action', render: row => { const action = record(row.last_action); return action.id ? <Link to={`/technical?tab=service-controls&job=${String(action.id)}`}>{text(action.action)} · {text(action.status)} · {date(action.created_at)}</Link> : 'No recorded action' } }, { key: 'controls', label: 'Controls', render: row => row.manageable ? <Button onClick={() => setSelected(row)}>Manage {text(row.service)}</Button> : <span className="admin-muted">Protected</span> }]} /></Panel>{selected && <ServiceDialog record={selected} close={() => setSelected(null)} changed={read.refresh} />}</>
}

function ExistingAction({ id }: { id: string }) {
  const read = useRead(signal => ownerApi.serviceActionStatus(id, signal), `service-action:${id}`, 2500)
  return <Panel title="Service action"><ReadState {...read} />{read.data && <><Badge value={read.data.status} /><p>Reference {read.data.id}</p>{read.data.error && <p>{read.data.error}</p>}<Details record={record(read.data.result)} fields={Object.keys(record(read.data.result)).map(key => ({ key, label: key.replace(/_/g, ' ') }))} /></>}</Panel>
}

function ServiceDialog({ record: serviceRecord, close, changed }: { record: AdminRecord; close: () => void; changed: () => void }) {
  const allowed = Array.isArray(serviceRecord.allowed_actions) ? serviceRecord.allowed_actions.map(String) : []
  const [action, setAction] = useState(allowed.includes('restart') ? 'restart' : allowed[0] || ''), [confirmed, setConfirmed] = useState(false)
  const [intent, setIntent] = useState(() => crypto.randomUUID()), [job, setJob] = useState<OwnerAction | null>(null), [pollError, setPollError] = useState('')
  const task = useTask(), service = String(serviceRecord.service), preview = useRead(signal => ownerApi.servicePreview(service, action, signal), `${service}:${action}`)
  const pending = !!job && ['QUEUED', 'RUNNING', 'UNKNOWN'].includes(job.status)
  useEffect(() => {
    if (!pending || !job) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, stopped = false
    const poll = async () => {
      try { if (!document.hidden) { const next = await ownerApi.serviceActionStatus(job.id, controller.signal); if (!stopped) { setJob(next); setPollError(''); if (next.status === 'SUCCEEDED') changed() } } }
      catch { if (!stopped) setPollError('The latest result could not be checked. The last known state is shown.') }
      if (!stopped) timer = setTimeout(poll, 2500)
    }
    timer = setTimeout(poll, 2500)
    return () => { stopped = true; controller.abort(); clearTimeout(timer) }
  }, [pending, job?.id])
  return <Dialog title={`Manage ${service}`} close={close} busy={task.busy}><p>Stopping or restarting a service can interrupt active users. Eligibility is checked again before execution.</p>{!job && <><label className="admin-filter-label">Action<select value={action} disabled={task.busy} onChange={event => { setAction(event.target.value); setConfirmed(false); setIntent(crypto.randomUUID()); task.setError('') }}>{allowed.map(value => <option key={value}>{value}</option>)}</select></label><ReadState {...preview} />{preview.data && !preview.data.eligible && <p className="admin-warning" role="status">{preview.data.blocking_reason || 'This action is blocked.'}</p>}<label className="admin-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={task.busy} />I have reviewed the impact of this service action.</label>{task.error && <p role="alert" className="admin-error">{task.error} The same action reference will be reused if you retry.</p>}<div className="admin-form-actions"><Button disabled={task.busy} onClick={close}>Cancel</Button><Button variant={action === 'stop' ? 'danger' : 'primary'} disabled={!confirmed || task.busy || !preview.data?.eligible || preview.loading || !!preview.error} onClick={() => void task.run(signal => ownerApi.serviceAction(service, action, intent, preview.data!.preview_revision, signal), result => { setJob(result); if (result.status === 'SUCCEEDED') changed() })}>{task.busy ? 'Submitting…' : `Confirm ${action}`}</Button></div></>}{job && <div className={job.status === 'SUCCEEDED' ? 'admin-success' : 'admin-notice'} role="status"><Badge value={job.status} /><p>Action reference: {job.id}</p>{job.error && <p>{job.error}</p>}{pending && <p>Checking this existing action. It will not be submitted again automatically.</p>}{job.status === 'SUCCEEDED' && <p>The host agent confirmed this action completed.</p>}{pollError && <p>{pollError}</p>}</div>}</Dialog>
}
