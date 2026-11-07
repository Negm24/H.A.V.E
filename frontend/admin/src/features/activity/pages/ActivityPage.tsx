import { useScreenReady } from '@have/shared/telemetry/react'
import { useState } from 'react'
import { Button } from '@have/shared/ui/controls'
import { ownerApi, type AdminRecord } from '@have/shared/api/owner'
import { date, text, useRead, useRecords } from '../../../app/hooks'
import { Badge, Details, Dialog, PageHeader, Pagination, Panel, ReadState, RecordsTable, SearchBar } from '../../../components/ui'

export function ActivityPage() {
  const records = useRecords('activity'), [selected, setSelected] = useState<AdminRecord | null>(null)
  useScreenReady(!!records.data && !records.error)
  return <><PageHeader eyebrow="CHANGES YOU CAN TRACE" title="Activity history" description="A durable record of Owner actions and their outcomes."><Button onClick={records.refresh}>Refresh</Button></PageHeader>
    <Panel><SearchBar value={records.query} change={records.setQuery} submit={records.search} placeholder="Search action or target reference" /><ReadState {...records} /><RecordsTable rows={records.data?.items ?? []} columns={[{ key: 'created_at', label: 'Time', render: row => date(row.created_at) }, { key: 'action', label: 'Action', render: row => <strong>{text(row.action).replace(/_/g, ' ')}</strong> }, { key: 'actor_id', label: 'Owner' }, { key: 'target_type', label: 'Record type' }, { key: 'target_id', label: 'Reference' }, { key: 'outcome', label: 'Outcome', render: row => <Badge value={row.outcome} /> }]} open={setSelected} rowLabel={row => text(row.action)} /><Pagination data={records.data} page={records.page} change={records.setPage} /></Panel>
    {selected && <ActivityDetails record={selected} close={() => setSelected(null)} />}
  </>
}
function ActivityDetails({ record, close }: { record: AdminRecord; close: () => void }) {
  const [tracking, setTracking] = useState(false), metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata as AdminRecord : {}, jobId = typeof metadata.job_id === 'string' ? metadata.job_id : null
  return <Dialog title="Activity details" close={close}><Details record={record} fields={[{ key: 'created_at', label: 'Time', date: true }, { key: 'actor_id', label: 'Owner' }, { key: 'action', label: 'Action' }, { key: 'target_type', label: 'Record type' }, { key: 'target_id', label: 'Reference' }, { key: 'outcome', label: 'Recorded outcome' }]} /><Details record={metadata} fields={Object.keys(metadata).map(key => ({ key, label: key.replace(/_/g, ' ') }))} />
    {jobId && ['order', 'service'].includes(String(record.target_type)) && <><p className="admin-muted">This entry records the outcome at that time. Check the existing action for its current authoritative state.</p><Button onClick={() => setTracking(true)}>Check current action status</Button>{tracking && <TrackedAction id={jobId} service={record.target_type === 'service'} />}</>}
  </Dialog>
}
function TrackedAction({ id, service }: { id: string; service: boolean }) {
  const read = useRead(signal => service ? ownerApi.serviceActionStatus(id, signal) : ownerApi.action(id, signal), `${service}:${id}`, 5000), action = read.data
  return <section className="admin-confirm"><ReadState {...read} />{action && <><Badge value={action.status} /><p>Action reference: {action.id}</p>{action.error && <p className="admin-warning">{action.error}</p>}{!!action.result && typeof action.result === 'object' && <Details record={action.result as AdminRecord} fields={Object.keys(action.result).map(key => ({ key, label: key.replace(/_/g, ' ') }))} />}<p className="admin-muted">This check reads the existing action. It does not submit or repeat it.</p></>}</section>
}
