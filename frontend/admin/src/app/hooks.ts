import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@have/shared/api'
import { ownerApi, type PageResult } from '@have/shared/api/owner'

export function errorText(failure: unknown) {
  if (failure instanceof ApiError) {
    if (failure.status === 409) return `This record changed or the action is no longer eligible. Refresh and review it before trying again. ${failure.message}`
    if (failure.status === 429) return `Too many requests. Try again after ${failure.retryAfter ?? 30} seconds.`
    if (Object.keys(failure.fields).length) return Object.entries(failure.fields).map(([field, message]) => `${field.replace(/_/g, ' ')}: ${message}`).join(' ')
    return failure.message
  }
  return 'The request could not be completed. Refresh to check the current state before trying again.'
}
export function useTask() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const active = useRef<AbortController | null>(null), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort() } }, [])
  async function run<T>(work: (signal: AbortSignal) => Promise<T>, success?: (data: T) => void) {
    if (active.current) return
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('')
    try { const result = await work(controller.signal); if (mounted.current && !controller.signal.aborted) { success?.(result); return result } }
    catch (failure) { if (mounted.current && !controller.signal.aborted) setError(errorText(failure)) }
    finally { if (active.current === controller) { active.current = null; if (mounted.current) setBusy(false) } }
  }
  return { busy, error, setError, run }
}
export function useRead<T>(load: (signal: AbortSignal) => Promise<T>, key: string, interval = 0) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0), loader = useRef(load), loadedKey = useRef(key); loader.current = load
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, stopped = false, inFlight = false
    const read = async () => {
      if (stopped || inFlight) return
      clearTimeout(timer)
      if (document.hidden && interval) { timer = setTimeout(read, interval); return }
      inFlight = true
      try { const result = await loader.current(controller.signal); if (!stopped) { setData(result); setError('') } }
      catch (failure) { if (!stopped && !controller.signal.aborted) setError(errorText(failure)) }
      finally { inFlight = false; if (!stopped) { setLoading(false); if (interval) timer = setTimeout(read, interval) } }
    }
    const visible = () => { if (interval && !document.hidden) void read() }
    setLoading(true); setError(''); if (loadedKey.current !== key) { loadedKey.current = key; setData(null) } void read()
    document.addEventListener('visibilitychange', visible)
    return () => { stopped = true; controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [key, revision, interval])
  return { data, error, loading, refresh, replace: setData }
}
export function useRecords(resource: string, filters: Record<string, string | number> = {}, initialQuery = '', pageSize = 25) {
  const [page, setPage] = useState(1), [query, setQuery] = useState(initialQuery), [search, setSearch] = useState(initialQuery)
  const key = `${resource}:${page}:${pageSize}:${search}:${JSON.stringify(filters)}`
  const read = useRead<PageResult>(signal => ownerApi.list(resource, { ...filters, page, page_size: pageSize }, search, signal), key)
  return { ...read, page, setPage, query, setQuery, clearSearch: () => { setQuery(''); setSearch(''); setPage(1) }, replaceRecord: (record: Record<string, unknown>) => read.replace(before => before ? { ...before, items: before.items.map(row => rowId(row) === rowId(record) ? record : row) } : before), search: () => { if (page === 1 && search === query) read.refresh(); else { setPage(1); setSearch(query) } } }
}
export const rowId = (row: Record<string, unknown>) => String(row.id ?? row.serial_number ?? '')
export const text = (value: unknown, fallback = '—'): string => value === null || value === undefined || value === '' ? fallback : String(value)
export const number = (value: unknown) => typeof value === 'number' ? value : Number(value) || 0
export const date = (value: unknown) => value ? new Date(String(value)).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }) : '—'
export const amount = (value: unknown) => `${Number(value ?? 0).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP`
