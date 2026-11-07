import { useState } from 'react'
import { Button } from '@have/shared/ui/controls'
import { ownerApi, type AdminRecord } from '@have/shared/api/owner'
import { number, rowId, text, useRead, useTask } from '../../../app/hooks'
import { Dialog } from '../../../components/ui'

export type EditorField = { key: string; label: string; kind?: 'number' | 'decimal' | 'money' | 'boolean' | 'textarea' | 'date' | 'select' | 'tags'; required?: boolean; nullable?: boolean; choices?: { value: string; label: string }[]; min?: number; max?: number }
export function useChoices(resource: string) {
  return useRead(async signal => { const result = await ownerApi.list(resource, { page_size: 100 }, '', signal); const rows = [...result.items]; for (let page = 2; rows.length < result.total && page <= 20; page++) rows.push(...(await ownerApi.list(resource, { page, page_size: 100 }, '', signal)).items); return rows }, resource)
}
export const categoryFields: EditorField[] = [{ key: 'name_en', label: 'English name', required: true }, { key: 'name_ar', label: 'Arabic name', required: true }, { key: 'is_active', label: 'Active category', kind: 'boolean' }]
export const productFields = (categories: AdminRecord[]): EditorField[] => [
  { key: 'sku', label: 'SKU', required: true }, { key: 'category_id', label: 'Category', kind: 'select', required: true, choices: categories.map(row => ({ value: rowId(row), label: text(row.name_en) })) },
  { key: 'name_en', label: 'English name', required: true }, { key: 'name_ar', label: 'Arabic name', required: true },
  { key: 'active_ingredient', label: 'Active ingredient' }, { key: 'strength', label: 'Strength' }, { key: 'dosage_form', label: 'Dosage form' }, { key: 'pack_description', label: 'Pack description', required: true },
  { key: 'price', label: 'Price (EGP)', kind: 'money', required: true, min: 0 }, { key: 'max_quantity_per_order', label: 'Maximum packs per order (blank means stock limit)', kind: 'number', nullable: true, min: 1 },
  { key: 'usage_instructions_en', label: 'English usage information', kind: 'textarea', required: true }, { key: 'usage_instructions_ar', label: 'Arabic usage information', kind: 'textarea', required: true },
  { key: 'warnings_en', label: 'English warnings', kind: 'textarea' }, { key: 'warnings_ar', label: 'Arabic warnings', kind: 'textarea' },
  { key: 'symptom_tags', label: 'Symptom tags (comma separated)', kind: 'tags' }, { key: 'requires_prescription', label: 'Prescription required', kind: 'boolean' }, { key: 'is_active', label: 'Active product', kind: 'boolean' },
]
export function EditorForm({ fields, initial = {}, submit, cancel, label = 'Save changes', busy, error }: { fields: EditorField[]; initial?: AdminRecord; submit: (data: AdminRecord) => void; cancel: () => void; label?: string; busy: boolean; error: string }) {
  const [values, setValues] = useState<AdminRecord>(() => Object.fromEntries(fields.map(field => [field.key, initial[field.key] ?? (field.kind === 'boolean' ? field.key === 'is_active' || field.key === 'is_enabled' : '')])))
  const send = () => {
    const body: AdminRecord = {}
    for (const field of fields) { const value = values[field.key]; body[field.key] = field.kind === 'boolean' ? !!value : field.kind === 'tags' ? (Array.isArray(value) ? value : String(value).split(',').map(tag => tag.trim()).filter(Boolean)) : field.nullable && (value === '' || value === null) ? null : field.kind === 'number' || field.kind === 'select' && /_id$/.test(field.key) ? Number(value) : String(value ?? '') }
    if (initial.revision !== undefined) body.revision = initial.revision
    submit(body)
  }
  return <form className="admin-editor" onSubmit={event => { event.preventDefault(); send() }}>{error && <p className="admin-error admin-full-field" role="alert">{error}</p>}{fields.map(field => {
    const id = `edit-${field.key}`, update = (value: unknown) => setValues(before => ({ ...before, [field.key]: value })), value = values[field.key]
    return <div className={`have-field ${field.kind === 'textarea' ? 'admin-full-field' : ''}`} key={field.key}>{field.kind === 'boolean' ? <label className="admin-checkbox"><input type="checkbox" checked={!!value} onChange={event => update(event.target.checked)} />{field.label}</label> : <><label htmlFor={id}>{field.label}</label>{field.kind === 'textarea' ? <textarea id={id} value={text(value, '')} required={field.required} lang={field.key.endsWith('_ar') ? 'ar' : 'en'} dir="auto" onChange={event => update(event.target.value)} /> : field.kind === 'select' ? <select id={id} value={text(value, '')} required={field.required} onChange={event => update(event.target.value)}><option value="">Select…</option>{field.choices?.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select> : <input id={id} type={field.kind === 'date' ? 'date' : field.kind === 'number' || field.kind === 'money' || field.kind === 'decimal' ? 'number' : 'text'} step={field.kind === 'decimal' ? 'any' : field.kind === 'money' ? '0.01' : field.kind === 'number' ? '1' : undefined} min={field.min} max={field.max} value={Array.isArray(value) ? value.join(', ') : text(value, '')} required={field.required} lang={field.key.endsWith('_ar') ? 'ar' : 'en'} dir="auto" onChange={event => update(event.target.value)} />}</>}</div>
  })}<div className="admin-form-actions admin-full-field"><Button type="button" disabled={busy} onClick={cancel}>Cancel</Button><Button variant="primary" disabled={busy}>{busy ? 'Saving…' : label}</Button></div></form>
}
export function RecordEditor({ resource, record, fields, title, close, saved }: { resource: string; record?: AdminRecord; fields: EditorField[]; title: string; close: () => void; saved: (record: AdminRecord) => void }) {
  const task = useTask()
  return <Dialog title={title} close={close} busy={task.busy}><EditorForm fields={fields} initial={record} busy={task.busy} error={task.error} cancel={close} submit={body => void task.run(signal => ownerApi.save(resource, body, record && (record.id as string | number ?? record.serial_number as string), signal), result => { saved(result); close() })} /></Dialog>
}
export function ImageEditor({ resource = 'products', record, updated }: { resource?: 'products' | 'categories'; record: AdminRecord; updated: (row: AdminRecord) => void }) {
  const task = useTask(), [file, setFile] = useState<File | null>(null), [notice, setNotice] = useState('')
  const upload = () => { if (!file) return; if (file.size > 5 * 1024 * 1024) { task.setError('Choose an image smaller than 5 MB.'); return } void task.run(signal => ownerApi.uploadImage(resource, rowId(record), file, number(record.revision), signal), row => { updated(row); setFile(null); setNotice('Image updated.') }) }
  return <section className="admin-image-editor"><div className="admin-image-preview">{record.image_url ? <img src={String(record.image_url)} alt={text(record.name_en)} /> : <span>No image</span>}</div><div><h3>{resource === 'products' ? 'Product image' : 'Category image'}</h3><p className="admin-muted">Choose a JPEG, PNG or WebP image up to 5 MB.</p><label className="admin-file-label">Choose image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { setFile(event.target.files?.[0] ?? null); setNotice(''); task.setError('') }} /></label>{file && <p className="admin-muted">{file.name}</p>}<div className="admin-form-actions"><Button disabled={!file || task.busy} onClick={upload}>Upload image</Button><Button disabled={!record.image_url || task.busy} onClick={() => void task.run(signal => ownerApi.removeImage(resource, rowId(record), number(record.revision), signal), row => { updated(row); setNotice('Image removed.') })}>Remove image</Button></div>{task.error && <p role="alert" className="admin-error">{task.error}</p>}{notice && <p role="status" className="admin-success">{notice}</p>}</div></section>
}
export function ProductImageDialog({ id, close, changed }: { id: string | number; close: () => void; changed: (record: AdminRecord) => void }) {
  const read = useRead(signal => ownerApi.detail('products', id, signal), `product-image:${id}`), [updated, setUpdated] = useState<AdminRecord | null>(null)
  return <Dialog title="Product image" close={close}>{read.error && <p className="admin-error" role="alert">{read.error}</p>}{read.loading && <p role="status">Loading product…</p>}{(updated ?? read.data) && <ImageEditor record={(updated ?? read.data)!} updated={row => { setUpdated(row); changed(row) }} />}</Dialog>
}
