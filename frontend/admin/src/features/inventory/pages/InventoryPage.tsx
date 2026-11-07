import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useScreenReady } from '@have/shared/telemetry/react'
import { Button } from '@have/shared/ui/controls'
import { ownerApi, type AdminRecord, type CabinetSlot } from '@have/shared/api/owner'
import { date, number, rowId, text, useRead, useRecords, useTask } from '../../../app/hooks'
import { Dialog, Empty, PageHeader, Pagination, ReadState, RecordsTable } from '../../../components/ui'
import { rows } from '../../../components/charts'
import { EditorForm, ImageEditor, RecordEditor, productFields, useChoices, type EditorField } from '../../catalogue/components/RecordEditor'

export function InventoryPage() {
  const kiosks = useChoices('kiosks')
  const [params, setParams] = useSearchParams()
  const [manage, setManage] = useState(false)
  const [revision, setRevision] = useState(0)
  const serial = params.get('machine') || text(kiosks.data?.[0]?.serial_number, '')
  useScreenReady(!!kiosks.data && !kiosks.error)
  return <>
    <PageHeader title="Inventory" description="Choose a medicine, then place packs in a machine.">
      <Button onClick={() => setManage(true)}>Manage external stock</Button>
    </PageHeader>
    <ReadState {...kiosks} />
    <div className="cabinet-machine-select"><label>Machine<select value={serial} onChange={event => setParams({ machine: event.target.value })}>
      {(kiosks.data ?? []).map(row => <option key={String(row.serial_number)} value={String(row.serial_number)}>{text(row.display_name)} · {text(row.address_en)}</option>)}
    </select></label><span>6 columns · 4 shelves</span></div>
    {serial && <CabinetWorkspace key={`${serial}:${revision}`} serial={serial} />}
    {manage && <ExternalManager close={() => { setManage(false); setRevision(before => before + 1) }} />}
  </>
}

function MedicineImage({ image, name }: { image: unknown; name: string }) {
  return image ? <img src={String(image)} alt="" /> : <span className="cabinet-medicine-placeholder" aria-label={name}>✚</span>
}

function CabinetWorkspace({ serial }: { serial: string }) {
  const cabinet = useRead(signal => ownerApi.cabinet(serial, signal), `cabinet:${serial}`, 15_000)
  const [pageSize, setPageSize] = useState(5)
  const external = useRecords('inventory/products', {}, '', pageSize)
  const [chosen, setChosen] = useState<AdminRecord | null>(null)
  const [slot, setSlot] = useState<CabinetSlot | null>(null)
  const [loading, setLoading] = useState<{ product: AdminRecord; slot: CabinetSlot } | null>(null)
  const [blocked, setBlocked] = useState<{ product: AdminRecord; slot: CabinetSlot } | null>(null)
  const [removing, setRemoving] = useState<CabinetSlot | null>(null)
  const [view, setView] = useState('2d')
  const [mobilePicker, setMobilePicker] = useState(false)
  const [notice, setNotice] = useState('')
  const picker = useRef<HTMLElement | null>(null)
  const catalogueBody = useRef<HTMLDivElement | null>(null)
  const measuredPageSize = useRef(pageSize)
  const [turn, setTurn] = useState('forward')
  useEffect(() => {
    const body = catalogueBody.current
    if (!body) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.height <= 0) return
      // Each card occupies 96px, with a 9px gap. Hidden phone panels are ignored.
      const size = Math.max(1, Math.min(10, Math.floor((entry.contentRect.height + 9) / 105)))
      if (measuredPageSize.current !== size) {
        measuredPageSize.current = size
        setPageSize(size)
        external.setPage(1)
      }
    })
    observer.observe(body)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!mobilePicker) return
    const previous = document.activeElement as HTMLElement | null
    picker.current?.querySelector<HTMLInputElement>('input')?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobilePicker(false); return }
      if (event.key !== 'Tab') return
      const controls = [...(picker.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]') ?? [])]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus() }
  }, [mobilePicker])
  useEffect(() => {
    const timer = setTimeout(() => external.search(), 250)
    return () => clearTimeout(timer)
  }, [external.query])
  const refresh = () => { cabinet.refresh(); external.refresh() }
  const choose = (product: AdminRecord) => { setChosen(product); setMobilePicker(false); setNotice(`Choose a shelf for ${text(product.product_name ?? product.name_en)}.`) }
  const place = (target: CabinetSlot, product = chosen) => {
    if (target.expiry_state === 'expired') { setSlot(target); setNotice('Customer access is blocked for this shelf. Remove expired packs to resolve it.'); return }
    if (!product) { if (target.quantity > 0) setSlot(target); return }
    if (target.quantity > 0 && target.product_id !== number(product.product_id ?? product.id)) setBlocked({ slot: target, product })
    else setLoading({ slot: target, product })
  }
  return <>
    <div className="cabinet-mobile-actions"><Button variant="primary" onClick={() => setMobilePicker(true)}>Choose a medicine</Button></div>
    {notice && <p className="cabinet-selection-notice" role="status">{notice}{chosen && <button onClick={() => { setChosen(null); setNotice('') }}>Cancel selection</button>}</p>}
    <div className="cabinet-workspace">
      <section className="cabinet-panel" aria-label="Machine cabinet">
        <div className="cabinet-panel-toolbar"><div><h2>Machine cabinet</h2><span>Select a shelf to inspect or remove packs</span></div><div className="cabinet-view-switch"><button aria-pressed={view === '2d'} onClick={() => setView('2d')}>2D</button><button aria-pressed={view === '3d'} onClick={() => setView('3d')}>3D</button></div></div>
        <ReadState {...cabinet} />
        <div className="cabinet-front-stage"><div className={`cabinet-front ${view === '3d' ? 'cabinet-front--angled' : ''}`}>
          <header><strong>H.A.V.E</strong><span>AUTO PHARM</span></header>
          <div className="cabinet-fixed-shelves" aria-label="Four shelves with six columns">{Array.from({ length: 24 }, (_, index) => {
            const position = `${String.fromCharCode(65 + Math.floor(index / 6))}${index % 6 + 1}`
            const current = cabinet.data?.slots.find(item => item.row === Math.floor(index / 6) + 1 && item.column === index % 6 + 1)
            const physical = current?.quantity ?? 0
            const reserved = current?.reserved_quantity ?? 0
            const capacity = current?.capacity ?? 0
            const accepts = !!current && current.expiry_state !== 'expired' && (!physical || !chosen || current.product_id === number(chosen.product_id ?? chosen.id))
            const expiry = text(current?.expiry_state, 'normal')
            return <button type="button" key={position} className={`cabinet-shelf cabinet-shelf--${expiry} ${physical ? '' : 'cabinet-shelf--empty'} ${chosen && accepts ? 'cabinet-shelf--accepts' : ''}`}
              disabled={!current} aria-label={`${position}: ${physical ? current?.product_name : 'Empty'}, ${physical} / ${capacity} packs, ${reserved} reserved${expiry === 'expired' ? ', expired packs, customer access blocked' : expiry === 'expiring_soon' ? ', expires within 30 days' : ''}`}
              onClick={() => current && place(current)} onDragOver={event => { if (current) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
              onDrop={event => {
                event.preventDefault()
                const id = event.dataTransfer.getData('application/x-have-product')
                const product = external.data?.items.find(item => String(item.product_id ?? item.id) === id)
                if (current && product) place(current, product)
              }}>
              <span className="cabinet-position">{position}</span>
              {expiry !== 'normal' && <span className="cabinet-expiry-warning" title={expiry === 'expired' ? 'Expired packs · Customer access blocked' : 'Expires within 30 days'} aria-label={expiry === 'expired' ? 'Expired packs · Customer access blocked' : 'Expires within 30 days'}>!</span>}
              {physical ? <><MedicineImage image={current?.image_url} name={text(current?.product_name)} /><strong>{current?.product_name}</strong><small>{text(current?.strength, '')}</small></> : <span className="cabinet-empty-label">+<strong>Empty</strong></span>}
              <span className="cabinet-fill-caption">{physical} / {capacity} packs</span>
              <span className="cabinet-fill" aria-hidden="true"><i style={{ width: `${capacity ? (physical - reserved) / capacity * 100 : 0}%` }} /><b style={{ width: `${capacity ? reserved / capacity * 100 : 0}%` }} /></span>
              {reserved > 0 && <small className="inventory-reserved">{reserved} reserved</small>}
            </button>
          })}</div>
          <footer><span>● Available packs</span><span className="inventory-reserved">● Reserved packs</span></footer>
        </div></div>
      </section>
      <aside ref={picker} role={mobilePicker ? 'dialog' : undefined} aria-modal={mobilePicker || undefined} className={`cabinet-external-panel ${mobilePicker ? 'cabinet-external-panel--open' : ''}`} aria-label="External inventory">
        <div className="cabinet-external-heading"><div><h2>External inventory</h2><p>Drag a medicine to a shelf, or select it first.</p></div><button className="cabinet-picker-close" aria-label="Close medicine picker" onClick={() => setMobilePicker(false)}>×</button></div>
        <label className="cabinet-search">Search medicines<input type="search" value={external.query} placeholder="Search Panadol, strength or SKU" onChange={event => external.setQuery(event.target.value)} /></label>
        <div className="cabinet-catalogue-body" ref={catalogueBody} aria-busy={external.loading}>
        <ReadState {...external} />
        {external.data && <div key={`${external.data.page}:${external.data.page_size}`} className={`cabinet-product-list cabinet-catalogue-page cabinet-catalogue-page--${turn}`}>{external.data.items.map(product => <button key={rowId(product)} className={`cabinet-product-card ${chosen?.id === product.id ? 'cabinet-product-card--selected' : ''}`} draggable
          onDragStart={event => { event.dataTransfer.setData('application/x-have-product', String(product.product_id ?? product.id)); event.dataTransfer.effectAllowed = 'copy'; setChosen(product) }} onClick={() => choose(product)}>
          <MedicineImage image={product.image_url} name={text(product.product_name ?? product.name_en)} />
          <span><strong>{text(product.product_name ?? product.name_en)}</strong><small>{text(product.strength, '')} {text(product.pack_description, '')}</small><small className="cabinet-sku">{text(product.sku, '')}</small></span>
          <b>{text(product.quantity)}<small>packs</small></b>
        </button>)}</div>}
        {external.data && !external.data.items.length && <Empty title="No available medicines" />}
        </div>
        <nav className="cabinet-catalogue-navigation" aria-label="Medicine catalogue pages">
          <button aria-label="Previous medicine page" disabled={external.loading || external.page <= 1} onClick={() => { setTurn('backward'); external.setPage(external.page - 1) }}>←</button>
          <span role="status">Page {external.page} of {external.data ? Math.max(1, Math.ceil(external.data.total / external.data.page_size)) : '…'}<small>{external.data ? `${external.data.total} medicines` : 'Loading medicines…'}</small></span>
          <button aria-label="Next medicine page" disabled={external.loading || !external.data || external.page >= Math.ceil(external.data.total / external.data.page_size)} onClick={() => { setTurn('forward'); external.setPage(external.page + 1) }}>→</button>
        </nav>
      </aside>
    </div>
    {mobilePicker && <button className="cabinet-picker-scrim" aria-label="Close medicine picker" onClick={() => setMobilePicker(false)} />}
    {loading && <LoadDialog {...loading} close={() => setLoading(null)} done={() => { setLoading(null); setChosen(null); setNotice('Packs added.'); refresh() }} />}
    {blocked && <Dialog title="Remove the current product first" close={() => setBlocked(null)}><p>{text(blocked.slot.position, blocked.slot.slot_code)} contains {blocked.slot.quantity} packs of {blocked.slot.product_name}. Remove them before adding {text(blocked.product.product_name ?? blocked.product.name_en)}.</p><div className="admin-form-actions"><Button onClick={() => setBlocked(null)}>Back</Button><Button variant="primary" onClick={() => { setRemoving(blocked.slot); setBlocked(null) }}>Remove packs</Button></div></Dialog>}
    {slot && <SlotDetails slot={slot} close={() => setSlot(null)} remove={() => { setRemoving(slot); setSlot(null) }} changed={refresh} />}
    {removing && <ReturnDialog slot={removing} close={() => setRemoving(null)} done={() => { setRemoving(null); setNotice('Packs returned to external inventory.'); refresh() }} />}
  </>
}

function LoadDialog({ slot, product, close, done }: { slot: CabinetSlot; product: AdminRecord; close: () => void; done: () => void }) {
  const maximum = Math.max(0, Math.min(number(product.quantity), slot.capacity - slot.quantity))
  const [quantity, setQuantity] = useState(1)
  const [actionId] = useState(() => crypto.randomUUID())
  const [submitted, setSubmitted] = useState<AdminRecord | null>(null)
  const preview = useRead(signal => quantity > 0 && quantity <= maximum ? ownerApi.previewLoad({ slot_id: slot.id, product_id: product.product_id ?? product.id, quantity }, signal) : Promise.resolve(null), `load-preview:${slot.id}:${product.id}:${quantity}`)
  const task = useTask()
  return <Dialog title="How many packs?" close={close} busy={task.busy}>
    <div className="cabinet-dialog-product"><MedicineImage image={product.image_url} name={text(product.product_name)} /><div><h3>{text(product.product_name ?? product.name_en)}</h3><p>{text(product.strength, '')} · {slot.slot_code}</p></div></div>
    <form onSubmit={event => {
      event.preventDefault()
      if (!submitted && (!preview.data || preview.loading || number(preview.data.quantity) !== quantity)) return
      const body = submitted ?? { slot_id: slot.id, product_id: product.product_id ?? product.id, quantity, slot_revision: preview.data!.slot_revision, batches: preview.data!.batches, action_id: actionId }
      setSubmitted(body)
      void task.run(signal => ownerApi.loadPacks(body, signal), done)
    }}>
      <label className="have-field">Packs to add<input autoFocus type="number" min="1" max={maximum} required value={quantity} disabled={!!submitted} onChange={event => setQuantity(Number(event.target.value))} /></label>
      <p className="admin-muted">Up to {maximum} packs · {slot.quantity} / {slot.capacity} currently in this shelf</p>
      <ReadState {...preview} />
      {!!preview.data && <div className="cabinet-batch-preview"><strong>Take these packs from external inventory</strong>{rows(preview.data.batches).map(batch => <p key={String(batch.batch_id)}>{text(batch.batch_number, `Batch ${text(batch.batch_id)}`)} · {date(batch.expiry_date)}<b>{text(batch.quantity)} packs</b></p>)}</div>}
      {task.error && <p className="admin-error" role="alert">{task.error}</p>}
      <div className="admin-form-actions"><Button type="button" disabled={task.busy} onClick={close}>Cancel</Button><Button variant="primary" disabled={task.busy || !preview.data || preview.loading || !!preview.error || number(preview.data.quantity) !== quantity || quantity < 1 || quantity > maximum}>Add packs</Button></div>
    </form>
  </Dialog>
}

function ReturnDialog({ slot, close, done }: { slot: CabinetSlot; close: () => void; done: () => void }) {
  const batches = slot.batches.filter(batch => number(batch.quantity) > 0)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [actionId] = useState(() => crypto.randomUUID())
  const [submitted, setSubmitted] = useState<AdminRecord | null>(null)
  const task = useTask()
  const [confirmed, setConfirmed] = useState(false)
  const today = text(slot.expiry_checked_date, new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const isExpired = (batch: AdminRecord) => String(batch.expiry_date).slice(0, 10) < today
  const removingExpired = batches.some(batch => isExpired(batch) && quantities[String(batch.batch_id)] > 0)
  const available = (batch: AdminRecord) => Math.max(0, number(batch.quantity) - number(batch.reserved_quantity))
  const total = Object.values(quantities).reduce((sum, value) => sum + value, 0)
  return <Dialog title="Remove packs" close={close} busy={task.busy}>
    <p><strong>{slot.product_name}</strong> · {slot.slot_code}</p>
    <p className="admin-muted">Return the matching batch packs to external inventory. Reserved packs stay in place.</p>
    <form onSubmit={event => {
      event.preventDefault()
      if (removingExpired && !confirmed) return
      const body = submitted ?? { slot_id: slot.id, slot_revision: slot.revision, action_id: actionId, expired_removal_confirmed: confirmed, batches: batches.filter(batch => quantities[String(batch.batch_id)] > 0).map(batch => ({ batch_id: batch.batch_id, quantity: quantities[String(batch.batch_id)], revision: batch.revision })) }
      setSubmitted(body)
      void task.run(signal => ownerApi.returnPacks(body, signal), done)
    }}>
      {batches.map(batch => <label className="have-field cabinet-return-row" key={String(batch.batch_id)}><span><strong>{text(batch.batch_number)}</strong><small>{date(batch.expiry_date)} · {available(batch)} available · {text(batch.reserved_quantity)} reserved</small></span><input aria-label={`Packs to remove from ${text(batch.batch_number)}`} type="number" min="0" max={available(batch)} disabled={!!submitted} value={quantities[String(batch.batch_id)] ?? 0} onChange={event => setQuantities(before => ({ ...before, [String(batch.batch_id)]: Number(event.target.value) }))} /></label>)}
      <Button type="button" disabled={!!submitted} onClick={() => setQuantities(Object.fromEntries(batches.map(batch => [String(batch.batch_id), available(batch)])))}>Remove all available packs</Button>
      {batches.some(isExpired) && <><p className="admin-warning">Expired packs must be physically removed and kept apart from saleable stock. They return to external inventory under their original batch and cannot be loaded for sale. This shelf stays blocked until no expired packs remain. Reserved packs require order resolution first.</p><Button type="button" disabled={!!submitted} onClick={() => setQuantities(Object.fromEntries(batches.map(batch => [String(batch.batch_id), isExpired(batch) ? available(batch) : 0])))}>Select expired packs</Button></>}
      {removingExpired && <label className="admin-checkbox"><input type="checkbox" required checked={confirmed} disabled={!!submitted} onChange={event => setConfirmed(event.target.checked)} />I confirm I physically removed the selected expired packs from this machine.</label>}
      {task.error && <p className="admin-error" role="alert">{task.error}</p>}
      <div className="admin-form-actions"><Button type="button" disabled={task.busy} onClick={close}>Cancel</Button><Button variant="primary" disabled={task.busy || total <= 0 || (removingExpired && !confirmed)}>Return {total} packs</Button></div>
    </form>
  </Dialog>
}

function SlotDetails({ slot, close, remove, changed }: { slot: CabinetSlot; close: () => void; remove: () => void; changed: () => void }) {
  return <Dialog title={`${slot.slot_code} · ${slot.product_name}`} close={close}><div className="cabinet-slot-summary"><MedicineImage image={slot.image_url} name={slot.product_name} /><div><h3>{slot.product_name}</h3><p>{text(slot.strength, '')}</p><strong>{slot.quantity} / {slot.capacity} packs</strong><p className="inventory-reserved">{slot.reserved_quantity} reserved</p></div></div>
    {slot.expiry_state === 'expired' && <p className="admin-error">Expired packs in this shelf block all customer purchases and collection from it. Remove the expired batches to restore eligibility. Existing manual slot settings remain unchanged.</p>}
    {slot.expiry_state === 'expiring_soon' && <p className="admin-warning">Stock expires within 30 days. Customers can still purchase eligible packs.</p>}
    <RecordsTable rows={slot.batches.filter(batch => number(batch.quantity) > 0)} columns={[{ key: 'batch_number', label: 'Batch' }, { key: 'quantity', label: 'On hand' }, { key: 'reserved_quantity', label: 'Reserved' }, { key: 'expiry_date', label: 'Expiry' }]} />
    {slot.product_id !== null && <ProductPreview id={slot.product_id} changed={changed} />}
    <div className="admin-form-actions"><Button variant="primary" disabled={slot.quantity <= slot.reserved_quantity} onClick={remove}>Remove packs</Button></div>
  </Dialog>
}

function ExternalManager({ close }: { close: () => void }) {
  const records = useRecords('inventory/external')
  const batches = useChoices('batches')
  const [editing, setEditing] = useState<AdminRecord | 'new' | null>(null)
  return <Dialog title="Manage external stock" close={close}><Button variant="primary" onClick={() => setEditing('new')}>Receive or correct stock</Button><ReadState {...records} /><RecordsTable rows={records.data?.items ?? []} columns={[{ key: 'product_name', label: 'Medicine' }, { key: 'batch_number', label: 'Batch' }, { key: 'quantity', label: 'Packs' }]} open={setEditing} /><Pagination data={records.data} page={records.page} change={records.setPage} />{editing && <ExternalAdjustment record={editing === 'new' ? undefined : editing} batches={batches.data ?? []} close={() => setEditing(null)} saved={records.refresh} />}</Dialog>
}

function ExternalAdjustment({ record, batches, close, saved }: { record?: AdminRecord; batches: AdminRecord[]; close: () => void; saved: () => void }) {
  const balances = useChoices('inventory/external')
  const task = useTask(), [actionId] = useState(() => crypto.randomUUID())
  const fields: EditorField[] = [{ key: 'batch_id', label: 'Batch', kind: 'select', required: true, choices: batches.map(row => ({ value: rowId(row), label: `${text(row.batch_number)} · Product ${text(row.product_id)} · ${text(row.expiry_date)}` })) }, { key: 'quantity', label: 'Counted external quantity (packs)', kind: 'number', min: 0, required: true }, { key: 'reason', label: 'Receipt or correction reason', required: true }]
  return <Dialog title="Receive or correct external stock" close={close} busy={task.busy}><EditorForm fields={fields} initial={{ ...record, revision: record?.revision ?? 0 }} busy={task.busy} error={task.error} cancel={close} label="Save external stock" submit={body => void task.run(signal => ownerApi.externalAdjust({ ...body, revision: record?.revision ?? balances.data?.find(item => Number(item.batch_id) === Number(body.batch_id))?.revision ?? 0, action_id: actionId }, signal), () => { saved(); close() })} /></Dialog>
}

function ProductPreview({ id, changed }: { id: number; changed: () => void }) {
  const read = useRead(signal => ownerApi.detail('products', id, signal), `inventory-product:${id}`), categories = useChoices('categories')
  const [editing, setEditing] = useState(false), [image, setImage] = useState(false)
  return <><div className="admin-form-actions"><Button onClick={() => setEditing(true)}>Edit product</Button><Button onClick={() => setImage(true)}>Edit image</Button></div>{editing && read.data && <RecordEditor resource="products" record={read.data} fields={productFields(categories.data ?? [])} title="Edit product" close={() => setEditing(false)} saved={() => { read.refresh(); changed() }} />}{image && read.data && <Dialog title="Product image" close={() => setImage(false)}><ImageEditor record={read.data} updated={data => { read.replace(data); changed() }} /></Dialog>}</>
}
