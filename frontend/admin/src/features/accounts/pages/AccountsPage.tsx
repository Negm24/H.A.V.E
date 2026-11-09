import { useScreenReady } from '@have/shared/telemetry/react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@have/shared/ui/controls'
import { ApiError } from '@have/shared/api'
import { Field } from '@have/shared/ui/forms'
import { ownerApi, type AdminRecord } from '@have/shared/api/owner'
import { date, rowId, text, useRead, useRecords, useTask } from '../../../app/hooks'
import { Badge, Details, Dialog, PageHeader, Pagination, Panel, ReadState, RecordsTable, SearchBar } from '../../../components/ui'
import { DoctorVerification } from './DoctorVerification'

export function AccountsPage({ doctors = false }: { doctors?: boolean }) {
  const resource = doctors ? 'doctors' : 'customers'
  const [status, setStatus] = useState(doctors ? 'PENDING' : ''), [selected, setSelected] = useState<string | null>(null)
  const records = useRecords(resource, status ? { status } : {})
  useScreenReady(!!records.data && !records.error)
  return <><PageHeader eyebrow="PEOPLE & ACCESS" title={doctors ? 'Doctors' : 'Customers'} description={doctors ? 'Review applications and manage access for your approved doctors.' : 'Support customer accounts while preserving their verified identity.'}><Button onClick={records.refresh}>Refresh</Button></PageHeader>
    <Panel><SearchBar value={records.query} change={records.setQuery} submit={records.search} placeholder={doctors ? 'Search doctor name, phone or ID' : 'Search customer name, phone or ID'}><label className="admin-filter-label">Status<select value={status} onChange={event => { setStatus(event.target.value); records.setPage(1) }}><option value="">All records</option>{doctors && <><option value="PENDING">Pending review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></>}<option value="BLOCKED">Blocked</option></select></label></SearchBar><ReadState {...records} />
      <RecordsTable rows={records.data?.items ?? []} columns={[
        { key: 'name', label: 'Name', render: row => <div className="admin-person-cell"><span className="admin-avatar">{text(row.first_name, '—').charAt(0)}</span><span><strong>{[row.first_name, row.last_name].filter(Boolean).join(' ') || 'Personal details erased'}</strong><small>{text(row.id)}</small></span></div> },
        { key: 'phone_number', label: 'Phone number' }, { key: 'email', label: 'Email address' },
        { key: 'status', label: 'Status', render: row => <Badge value={row.is_disabled ? 'Blocked' : row.approval_status ?? 'Active'} /> },
        { key: 'created_at', label: doctors ? 'Submitted' : 'Joined', render: row => date(doctors ? row.application_submitted_at : row.created_at) },
      ]} open={row => setSelected(rowId(row))} rowLabel={row => text(row.first_name ?? row.id)} /><Pagination data={records.data} page={records.page} change={records.setPage} />
    </Panel>{selected && <AccountDetails key={selected} resource={resource} id={selected} close={() => setSelected(null)} changed={record => { records.replaceRecord(record); records.refresh() }} />}
  </>
}
function AccountDetails({ resource, id, close, changed }: { resource: string; id: string; close: () => void; changed: (record: AdminRecord) => void }) {
  const navigate = useNavigate()
  const read = useRead(signal => ownerApi.detail(resource, id, signal), `${resource}:${id}`), task = useTask()
  const [updated, setUpdated] = useState<AdminRecord | null>(null), [action, setAction] = useState(''), [reason, setReason] = useState(''), [notice, setNotice] = useState('')
  const [actionId, setActionId] = useState(''), row = updated ?? read.data
  const choose = (value: string) => { setAction(value); setReason(''); task.setError(''); setActionId(crypto.randomUUID()) }
  const submit = () => {
    if (!row) return
    void task.run(async signal => {
      if (action === 'approve' || action === 'reject') return ownerApi.doctorDecision(id, action, reason, signal)
      const outcome = await ownerApi.accountAction(id, action as 'block' | 'unblock' | 'sign-out', reason, actionId, signal)
      if (outcome.status !== 'SUCCEEDED') throw new ApiError(outcome.error || `The account action is ${outcome.status.toLowerCase()}. Check its state before trying again.`, 409)
      return ownerApi.detail(resource, id, signal)
    }, result => { setUpdated(result); setNotice(action === 'approve' ? 'Doctor approved. They can now complete MFA sign-in.' : action === 'reject' ? 'Application rejected. Personal application details have been erased.' : action === 'sign-out' ? 'Existing account sessions have been revoked.' : `Account ${action === 'block' ? 'blocked' : 'restored'}.`); setAction(''); changed(result) })
  }
  const waiting = Array.isArray(row?.paid_pending_collections) ? row.paid_pending_collections as AdminRecord[] : []
  return <Dialog title={resource === 'doctors' ? 'Doctor details' : 'Customer details'} close={close} busy={task.busy}><ReadState {...read} />{row && <>
    <div className="admin-detail-hero"><span className="admin-avatar admin-avatar--large">{text(row.first_name, 'D').charAt(0)}</span><div><h3>{[row.first_name, row.last_name].filter(Boolean).join(' ') || text(row.id)}</h3><span className="admin-muted">{id}</span></div><Badge value={row.is_disabled ? 'Blocked' : row.approval_status ?? 'Active'} /></div>
    {resource === 'customers' && <Button disabled={task.busy} onClick={() => navigate('/orders', { state: { customerId: id } })}>View orders</Button>}
    {notice && <p className="admin-success" role="status">{notice}</p>}
    <Details record={row} fields={[{ key: 'phone_number', label: 'Phone number' }, { key: 'email', label: 'Email address' }, ...(resource === 'doctors' ? [{ key: 'professional_license_number', label: 'Professional licence' }, { key: 'specialty', label: 'Specialty' }, { key: 'medical_school', label: 'Medical school / university' }, { key: 'clinic_name', label: 'Clinic' }, { key: 'clinic_address', label: 'Clinic address' }, { key: 'times_previously_rejected', label: 'Previous rejections' }, { key: 'application_submitted_at', label: 'Latest submission', date: true }, { key: 'reviewed_at', label: 'Reviewed', date: true }, { key: 'reviewed_by_owner', label: 'Reviewed by' }, { key: 'last_rejection_reason', label: 'Rejection reason' }] : [{ key: 'date_of_birth', label: 'Date of birth' }, { key: 'created_at', label: 'Account created', date: true }])]} />
    {resource === 'doctors' && row.approval_status !== 'REJECTED' && <><Details record={row} fields={[{ key: 'name_ar', label: 'Doctor name · Arabic' }, { key: 'clinic_name_ar', label: 'Clinic · Arabic' }, { key: 'clinic_address_ar', label: 'Clinic address · Arabic' }, { key: 'nationality', label: 'Nationality' }, { key: 'country_of_graduation', label: 'Country of graduation' }]} /><DoctorVerification id={id} /></>}
    {waiting.length > 0 && <div className="admin-warning"><strong>{waiting.length} paid order{waiting.length === 1 ? '' : 's'} awaiting collection</strong><p>Blocking access does not cancel orders, change their deadlines, or issue refunds.</p>{waiting.slice(0, 5).map((order, index) => <p key={String(order.id ?? index)}>{text(order.order_number)} · Collect before {date(order.collection_deadline)}</p>)}</div>}
    {task.error && <p className="admin-error" role="alert">{task.error}</p>}
    {action ? <form className="admin-confirm" onSubmit={event => { event.preventDefault(); submit() }}><h3>{action === 'approve' ? 'Approve this doctor?' : action === 'reject' ? 'Reject this application?' : action === 'block' ? 'Block this account?' : action === 'unblock' ? 'Restore account access?' : 'Sign out this account everywhere?'}</h3><p>{action === 'reject' ? 'The applicant will see your reason. Personal application data is erased after rejection. Do not include personal details in the reason.' : action === 'approve' ? 'Approval activates the doctor account. The doctor must still sign in and complete MFA.' : 'Orders and financial records remain intact. Restoring access will require a fresh sign-in.'}</p>{action !== 'approve' && <Field label={action === 'reject' ? 'Reason (optional)' : 'Reason'} value={reason} onChange={event => setReason(event.target.value)} required={action !== 'reject'} maxLength={1000} />}<div className="admin-form-actions"><Button type="button" disabled={task.busy} onClick={() => setAction('')}>Back</Button><Button variant={['block', 'reject'].includes(action) ? 'danger' : 'primary'} disabled={task.busy}>{task.busy ? 'Submitting…' : 'Confirm decision'}</Button></div></form> : <div className="admin-form-actions">
      {resource === 'doctors' && row.approval_status === 'PENDING' ? <><Button variant="danger" onClick={() => choose('reject')}>Reject application</Button><Button variant="primary" onClick={() => choose('approve')}>Approve doctor</Button></> : row.approval_status !== 'REJECTED' && <><Button onClick={() => choose('sign-out')}>Sign out everywhere</Button><Button variant={row.is_disabled ? 'primary' : 'danger'} onClick={() => choose(row.is_disabled ? 'unblock' : 'block')}>{row.is_disabled ? 'Restore access' : 'Block account'}</Button></>}
    </div>}
  </>}</Dialog>
}
