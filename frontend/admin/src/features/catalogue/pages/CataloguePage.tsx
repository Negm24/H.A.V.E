import { useScreenReady } from '@have/shared/telemetry/react'
import { useState } from 'react'
import { Button } from '@have/shared/ui/controls'
import type { AdminRecord } from '@have/shared/api/owner'
import { amount, rowId, text, useRecords } from '../../../app/hooks'
import { Badge, Dialog, PageHeader, Pagination, Panel, ReadState, RecordsTable, SearchBar } from '../../../components/ui'
import { categoryFields, ImageEditor, productFields, RecordEditor, useChoices } from '../components/RecordEditor'

export function CataloguePage() {
  const [tab, setTab] = useState<'products' | 'categories'>('products'), [editing, setEditing] = useState<AdminRecord | 'new' | null>(null), [image, setImage] = useState<AdminRecord | null>(null)
  const records = useRecords(tab), categories = useChoices('categories')
  const changeTab = (value: 'products' | 'categories') => { setTab(value); records.clearSearch() }
  useScreenReady(!!records.data && !records.error)
  return <><PageHeader eyebrow="PRODUCTS & DISCOVERY" title="Catalogue" description="Maintain the information customers see across Hub and Terminal."><Button variant="primary" onClick={() => setEditing('new')}>Add {tab === 'products' ? 'product' : 'category'}</Button></PageHeader><div className="admin-tabs" role="tablist" aria-label="Catalogue sections">{(['products', 'categories'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => changeTab(value)}>{value === 'products' ? 'Products' : 'Categories'}</button>)}</div><Panel><SearchBar value={records.query} change={records.setQuery} submit={records.search} placeholder={`Search ${tab}`} /><ReadState {...records} /><RecordsTable rows={records.data?.items ?? []} columns={[
    { key: 'name_en', label: 'Name', render: row => <div className="admin-product-cell">{row.image_url ? <img src={String(row.image_url)} alt="" /> : <span className="admin-product-placeholder" aria-hidden="true">◇</span>}<span><strong>{text(row.name_en)}</strong><small>{text(tab === 'products' ? row.sku : row.name_ar)}</small></span></div> },
    ...(tab === 'products' ? [{ key: 'price', label: 'Price', render: (row: AdminRecord) => amount(row.price) }, { key: 'requires_prescription', label: 'Access', render: (row: AdminRecord) => <Badge value={row.requires_prescription ? 'Prescription' : 'OTC'} /> }] : []),
    { key: 'is_active', label: 'Status', render: row => <Badge value={row.is_active ? 'Active' : 'Inactive'} /> },
    { key: 'image', label: 'Image', render: row => <button className="admin-text-button" onClick={() => setImage(row)}>Edit image</button> },
  ]} open={setEditing} rowLabel={row => text(row.name_en)} /><Pagination data={records.data} page={records.page} change={records.setPage} /></Panel>
    {editing && <RecordEditor key={`${tab}:${editing === 'new' ? 'new' : rowId(editing)}`} resource={tab} record={editing === 'new' ? undefined : editing} fields={tab === 'categories' ? categoryFields : productFields(categories.data ?? [])} title={`${editing === 'new' ? 'Add' : 'Edit'} ${tab === 'products' ? 'product' : 'category'}`} close={() => setEditing(null)} saved={row => { records.replaceRecord(row); records.refresh(); categories.refresh() }} />}
    {image && <Dialog title={`Image · ${text(image.name_en)}`} close={() => setImage(null)}><ImageEditor resource={tab} record={image} updated={row => { setImage(row); records.replaceRecord(row); records.refresh() }} /></Dialog>}
  </>
}
