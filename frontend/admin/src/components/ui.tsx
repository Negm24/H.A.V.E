import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Button } from '@have/shared/ui/controls'
import type { AdminRecord, PageResult } from '@have/shared/api/owner'
import { date, text } from '../app/hooks'

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { menu: 'M4 6h16M4 12h16M4 18h16', overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', doctors: 'M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0M2 21v-3a6 6 0 0 1 10-4.47M15 3v5a3 3 0 0 0 6 0V3M15 4h1M20 4h1M18 11v6a3 3 0 0 1-6 0v-1M13.5 14.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0', customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', orders: 'M4 3h16v18l-4-2-4 2-4-2-4 2zM8 8h8M8 12h8', catalogue: 'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3zM12 6v16', inventory: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10', kiosks: 'M4 3h16v15H4zM9 21h6M12 18v3M8 7h8M8 11h4', technical: 'M3 12h4l3-8 4 16 3-8h4', activity: 'M3 12a9 9 0 1 0 3-6.7M3 3v6h6M12 7v5l3 2' }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.overview} /></svg>
}
export function PageHeader({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: string; children?: ReactNode }) {
  return <div className="admin-page-heading"><div>{eyebrow && <span className="admin-eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="admin-heading-actions">{children}</div>}</div>
}
export function Panel({ title, description, children, className = '' }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return <section className={`admin-panel ${className}`}>{title && <div className="admin-panel-heading"><h2>{title}</h2>{description && <p>{description}</p>}</div>}{children}</section>
}
export function Badge({ value, tone: suppliedTone }: { value: unknown; tone?: 'positive' | 'negative' | 'warning' | 'neutral' }) {
  const label = text(value, 'Unknown'), normalized = label.toLowerCase()
  const tone = /failed|error|offline|blocked|disabled|critical|unhealthy|unavailable/.test(normalized) ? 'negative' : /pending|unknown|stale|maintenance|review|warning|queued|running/.test(normalized) ? 'warning' : /success|approved|online|healthy|live|completed|^active$|connected|trading/.test(normalized) ? 'positive' : 'neutral'
  return <span className={`admin-badge admin-badge--${suppliedTone ?? tone}`}>{label.replace(/_/g, ' ')}</span>
}
export function Empty({ title = 'No records found', children }: { title?: string; children?: ReactNode }) { return <div className="admin-empty"><span aria-hidden="true">◇</span><h3>{title}</h3><p>{children ?? 'Records will appear here when they are available.'}</p></div> }
export function ReadState({ loading, error, refresh }: { loading: boolean; error: string; refresh: () => void }) { return <>{loading && <p role="status" className="admin-loading">Loading current records…</p>}{error && <div className="admin-error" role="alert"><p>{error}</p><Button onClick={refresh}>Refresh</Button></div>}</> }
export function Dialog({ title, children, close, busy = false }: { title: string; children: ReactNode; close: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { const previous = document.activeElement as HTMLElement | null, node = dialog.current; node?.showModal(); return () => { node?.close(); if (previous?.isConnected) previous.focus() } }, [])
  const label = useId()
  return <dialog className="admin-dialog" aria-labelledby={label} ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) close() }}><header><h2 id={label}>{title}</h2><button className="admin-icon-button" aria-label="Close dialog" disabled={busy} onClick={close}>×</button></header>{children}</dialog>
}
export type Column = { key: string; label: string; render?: (row: AdminRecord) => ReactNode }
export function RecordsTable({ columns, rows, open, rowLabel }: { columns: Column[]; rows: AdminRecord[]; open?: (row: AdminRecord) => void; rowLabel?: (row: AdminRecord) => string }) {
  if (!rows.length) return <Empty />
  return <div className="admin-table-scroll"><table className="admin-table"><thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}{open && <th scope="col"><span className="admin-sr-only">Actions</span></th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.serial_number ?? index)}>{columns.map(column => <td key={column.key} data-label={column.label}>{column.render ? column.render(row) : text(row[column.key])}</td>)}{open && <td><button className="admin-text-button" onClick={() => open(row)} aria-label={`View ${rowLabel?.(row) || text(row.name_en ?? row.display_name ?? row.id)}`}>View <span aria-hidden="true">↗</span></button></td>}</tr>)}</tbody></table></div>
}
export function Pagination({ data, page, change }: { data: PageResult | null; page: number; change: (page: number) => void }) {
  if (!data) return null
  const pages = Math.max(1, Math.ceil(data.total / data.page_size))
  return <div className="admin-pagination"><span>{data.total.toLocaleString('en')} records · Page {page} of {pages}</span><div><Button disabled={page <= 1} onClick={() => change(page - 1)}>Previous</Button><Button disabled={page >= pages} onClick={() => change(page + 1)}>Next</Button></div></div>
}
export function Details({ record, fields }: { record: AdminRecord; fields: { key: string; label: string; date?: boolean }[] }) { return <dl className="admin-details">{fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.date ? date(record[field.key]) : text(record[field.key])}</dd></div>)}</dl> }
export function SearchBar({ value, change, submit, children, placeholder = 'Search records' }: { value: string; change: (value: string) => void; submit: () => void; children?: ReactNode; placeholder?: string }) { return <form className="admin-toolbar" onSubmit={event => { event.preventDefault(); submit() }}><div className="admin-search"><label className="admin-sr-only" htmlFor="record-search">{placeholder}</label><input id="record-search" value={value} onChange={event => change(event.target.value)} placeholder={placeholder} autoComplete="off" /><Button>Search</Button></div>{children}</form> }
