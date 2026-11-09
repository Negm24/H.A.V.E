import { useEffect, useState } from 'react'
import { Button } from '@have/shared/ui/controls'
import { Field } from '@have/shared/ui/forms'
import { ownerApi, type DoctorDocumentKind, type DoctorVerification as Verification } from '@have/shared/api/owner'
import { date, useRead, useTask } from '../../../app/hooks'
import { ReadState } from '../../../components/ui'
import './doctor-verification.css'

const labels: Record<DoctorDocumentKind, string> = {
  graduation: 'Graduation certificate', id_front: 'National ID · Front', id_back: 'National ID · Back',
  passport: 'Passport · Identity page', syndicate: 'Medical Syndicate card', practice_license: 'Practice licence',
}

export function DoctorVerification({ id }: { id: string }) {
  const read = useRead(signal => ownerApi.doctorVerification(id, signal), `verification:${id}`), task = useTask()
  const [data, setData] = useState<Verification | null>(null), [selected, select] = useState<DoctorDocumentKind | null>(null)
  const [image, setImage] = useState(''), [imageError, setImageError] = useState(''), [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(false), [notice, setNotice] = useState('')
  const [fields, setFields] = useState({ syndicate_registration_number: '', professional_license_number: '', specialty: '', specialty_ar: '' })
  useEffect(() => {
    if (!read.data) return
    setData(read.data)
    setFields({ syndicate_registration_number: read.data.syndicate_registration_number ?? '', professional_license_number: read.data.professional_license_number ?? '', specialty: read.data.specialty ?? '', specialty_ar: read.data.specialty_ar ?? '' })
    select(read.data.documents[0]?.kind ?? null)
  }, [read.data])
  useEffect(() => {
    const controller = new AbortController(); let url = ''; let active = true
    setImage(''); setImageError(''); setZoom(false)
    if (selected) {
      setLoading(true)
      void ownerApi.doctorDocument(id, selected, controller.signal).then(blob => {
        if (!active) return
        url = URL.createObjectURL(blob); setImage(url)
      }).catch(error => { if (active) setImageError(error instanceof Error ? error.message : 'Document unavailable.') }).finally(() => { if (active) setLoading(false) })
    }
    return () => { active = false; controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [id, selected])
  const document = data?.documents.find(item => item.kind === selected)
  return <section className="admin-verification" aria-labelledby="verification-heading">
    <div><h3 id="verification-heading">Professional evidence</h3><p className="admin-muted">Private applicant documents. Uploaded evidence is not an automatic verification.</p></div>
    <ReadState {...read} />
    {data && <>
      {data.documents.length ? <div className="admin-verification-workspace">
        <div className="admin-verification-documents" aria-label="Verification documents">{data.documents.map(item => <button type="button" key={item.kind} aria-pressed={selected === item.kind} onClick={() => select(item.kind)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5" /></svg><span>{labels[item.kind]}<small>{date(item.uploaded_at)}</small></span></button>)}</div>
        <div className="admin-verification-preview">
          <header><strong>{selected ? labels[selected] : 'Select a document'}</strong>{image && <Button type="button" onClick={() => setZoom(value => !value)} aria-pressed={zoom}>{zoom ? 'Fit image' : 'Zoom image'}</Button>}</header>
          {loading && <p role="status">Loading private image…</p>}
          {imageError && <p role="alert" className="admin-error">{imageError}</p>}
          {image && <div className={`admin-verification-image ${zoom ? 'is-zoomed' : ''}`} tabIndex={zoom ? 0 : undefined} role={zoom ? 'region' : undefined} aria-label={zoom ? 'Scrollable enlarged verification image' : undefined}><img src={image} alt={selected ? labels[selected] : 'Verification document'} /></div>}
          {document && <small className="admin-muted">Uploaded {date(document.uploaded_at)} · Private evidence</small>}
        </div>
      </div> : <p className="admin-muted">No verification images recorded.</p>}
      <details className="admin-verification-metadata"><summary>Optional professional details</summary><p className="admin-muted">Transcribe only what you can establish. Blank identifiers remain unrecorded. Approval does not require these fields.</p>
        <form onSubmit={event => { event.preventDefault(); setNotice(''); void task.run(signal => ownerApi.saveDoctorVerification(id, fields, signal), result => { setData(result); setNotice('Professional details saved.') }) }}>
          <div className="admin-form-grid">
            <Field label="Syndicate Registration Number (optional)" dir="ltr" value={fields.syndicate_registration_number} maxLength={100} onChange={event => setFields(before => ({ ...before, syndicate_registration_number: event.target.value }))} />
            <Field label="Practice Licence Number (optional)" dir="ltr" value={fields.professional_license_number} maxLength={100} onChange={event => setFields(before => ({ ...before, professional_license_number: event.target.value }))} />
            <Field label="Specialty · English (optional)" value={fields.specialty} maxLength={100} onChange={event => setFields(before => ({ ...before, specialty: event.target.value }))} />
            <Field label="Specialty · Arabic (optional)" dir="rtl" lang="ar" value={fields.specialty_ar} maxLength={100} onChange={event => setFields(before => ({ ...before, specialty_ar: event.target.value }))} />
          </div>
          {task.error && <p role="alert" className="admin-error">{task.error}</p>}{notice && <p role="status" className="admin-success">{notice}</p>}
          <div className="admin-form-actions"><Button disabled={task.busy}>{task.busy ? 'Saving…' : 'Save professional details'}</Button></div>
        </form>
      </details>
    </>}
  </section>
}
