import { ApiError, request, type RequestOptions } from './http'

export type AdminRecord = Record<string, unknown>
export interface PageResult<T = AdminRecord> { items: T[]; total: number; page: number; page_size: number }
export interface OwnerIdentity { id: string; first_name: string; last_name: string; account_type: 'OWNER' }
export interface OwnerSession { owner: OwnerIdentity; server_time: string; idle_expires_at: string; absolute_expires_at: string }
export interface OwnerAction { id: string; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'BLOCKED'; action?: string; result: unknown; error: string; created_at?: string }
export interface MaintenancePreview { eligible: boolean; blocking_reason: string | null; revision: number; paid_waiting_orders: AdminRecord[]; [key: string]: unknown }
export interface TechnicalSummary { observed_at: string; services: AdminRecord[]; dependencies: Record<string, { status: string; latency_ms?: number | null }>; worker: AdminRecord; agent: AdminRecord; backlog: { payments: number; refunds: number; receipts: number; details?: Record<string, AdminRecord>; notices?: Record<string, AdminRecord>; review_orders?: number }; incidents_open: number }
export interface ResourceSample { timestamp: string; host: { cpu_percent: number | null; memory_percent: number | null; memory_used_bytes: number | null; memory_total_bytes: number | null }; containers: { service: string; cpu_percent: number | null; memory_bytes: number | null; memory_limit_bytes: number | null; state: string }[] }
export interface Resources { observed_at: string; freshness: string; samples: ResourceSample[]; unit: string }
export interface MetricBucket { metric: string; app: string; route: string; unit: string; count: number; sum: number; min: number; max: number; buckets: unknown; minute: string }
export interface Metrics { observed_at: string; items: MetricBucket[]; range: { from: string; to: string }; truncated?: boolean }
export interface ServicePreview { service: string; action: string; eligible: boolean; blocking_reason: string | null; preview_revision: string; observed_at: string }
export interface RecoveryChallenge { challenge_id: string; expires_in: number; resend_after: number; detail?: string }
export interface RecoveryProof { reset_token: string; expires_in: number }
export interface CabinetSlot extends AdminRecord { id: number; slot_code: string; product_id: number | null; product_name: string; image_url: string | null; capacity: number; revision: number; row: number | null; column: number | null; quantity: number; reserved_quantity: number; batches: AdminRecord[] }
export interface Cabinet { serial_number: string; revision: number; confirmed: boolean; slots: CabinetSlot[] }
export type DoctorDocumentKind = 'graduation' | 'id_front' | 'id_back' | 'passport' | 'syndicate' | 'practice_license'
export interface DoctorVerification {
  documents: { kind: DoctorDocumentKind; uploaded_at: string; content_type: string }[]
  syndicate_registration_number: string
  professional_license_number: string | null
  specialty: string
  specialty_ar: string
}

const base = '/api/v1/owner/'
const auth = '/api/v1/auth/owners/'
const safe = (id: string | number) => encodeURIComponent(String(id))
let authGeneration = 0
export function advanceOwnerAuthGeneration() { authGeneration++ }
async function call<T>(path: string, options: RequestOptions = {}) {
  const generation = authGeneration
  try { return await request<T>(base + path, options) }
  catch (failure) {
    if (generation === authGeneration && !options.signal?.aborted && failure instanceof ApiError && (failure.status === 401 || failure.status === 403 && !/csrf/i.test(failure.message))) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('have:owner:session-ended'))
    }
    throw failure
  }
}
export const ownerApi = {
  doctorVerification: (id: string, signal?: AbortSignal) => request<DoctorVerification>(auth + `doctors/${safe(id)}/verification/`, { signal }),
  saveDoctorVerification: (id: string, body: AdminRecord, signal?: AbortSignal) => request<DoctorVerification>(auth + `doctors/${safe(id)}/verification/`, { method: 'PATCH', csrf: true, body, signal }),
  async doctorDocument(id: string, kind: DoctorDocumentKind, signal?: AbortSignal) {
    const response = await fetch(auth + `doctors/${safe(id)}/verification/documents/${kind}/`, { credentials: 'same-origin', cache: 'no-store', signal: signal ?? AbortSignal.timeout(15000) })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) window.dispatchEvent(new Event('have:owner:session-ended'))
      throw new ApiError('This verification document is unavailable.', response.status)
    }
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new ApiError('Invalid verification image response.', 0)
    return response.blob()
  },
  session: (signal?: AbortSignal) => call<OwnerSession>('session/', { signal }),
  activity: (signal?: AbortSignal) => call<OwnerSession>('session/activity/', { method: 'POST', csrf: true, body: {}, signal }),
  login: (data: { phone_number: string; password: string }, signal?: AbortSignal) => request<OwnerIdentity>(auth + 'login/', { method: 'POST', body: data, csrf: true, signal }),
  logout: () => request<void>(auth + 'logout/', { method: 'POST', csrf: true }),
  requestReset: (phone_number: string, signal?: AbortSignal) => request<RecoveryChallenge>(auth + 'password-reset/request/', { method: 'POST', body: { phone_number }, csrf: true, signal }),
  verifyReset: (data: { challenge_id: string; phone_number: string; code: string }, signal?: AbortSignal) => request<RecoveryProof>(auth + 'password-reset/verify/', { method: 'POST', body: data, csrf: true, signal }),
  completeReset: (data: { reset_token: string; new_password: string; confirm_password: string }, signal?: AbortSignal) => request<{ detail: string }>(auth + 'password-reset/complete/', { method: 'POST', body: data, csrf: true, signal }),
  overview: (signal?: AbortSignal) => call<AdminRecord>('overview/', { signal }),
  business: (period: string, signal?: AbortSignal) => call<AdminRecord>(`overview/business/?period=${safe(period)}`, { signal }),
  fleet: (signal?: AbortSignal, period = 'month') => call<AdminRecord>('overview/fleet/?' + new URLSearchParams({ period }), { signal }),
  cabinet: (serial: string, signal?: AbortSignal) => call<Cabinet>(`inventory/cabinets/${safe(serial)}/`, { signal }),
  saveCabinet: (serial: string, body: AdminRecord, signal?: AbortSignal) => call<Cabinet>(`inventory/cabinets/${safe(serial)}/`, { method: 'PATCH', csrf: true, body, signal }),
  externalAdjust: (body: AdminRecord, signal?: AbortSignal) => call<OwnerAction>('inventory/external/adjust/', { method: 'POST', csrf: true, body, signal }),
  transfer: (body: AdminRecord, signal?: AbortSignal) => call<OwnerAction>('inventory/transfers/', { method: 'POST', csrf: true, body, signal }),
  previewLoad: (body: AdminRecord, signal?: AbortSignal) => call<AdminRecord>('inventory/load/preview/', { method: 'POST', csrf: true, body, signal }),
  loadPacks: (body: AdminRecord, signal?: AbortSignal) => call<OwnerAction>('inventory/load/', { method: 'POST', csrf: true, body, signal }),
  returnPacks: (body: AdminRecord, signal?: AbortSignal) => call<OwnerAction>('inventory/returns/', { method: 'POST', csrf: true, body, signal }),
  system: (minutes: number, signal?: AbortSignal, at = '') => call<AdminRecord>(`technical/system/?window_minutes=${minutes}&at=${safe(at)}`, { signal }),
  history: (minutes: number, service = '', signal?: AbortSignal, kind = 'service') => call<AdminRecord>(`technical/history/?window_minutes=${minutes}&service=${safe(service)}&kind=${safe(kind)}`, { signal }),
  usage: (minutes: number, app: string, feature: string, signal?: AbortSignal) => call<AdminRecord>(`technical/usage/?window_minutes=${minutes}&app=${safe(app)}&feature=${safe(feature)}`, { signal }),
  list: (resource: string, filters: Record<string, string | number> = {}, query = '', signal?: AbortSignal) => query.trim()
    ? call<PageResult>(resource + '/search/', { method: 'POST', csrf: true, body: { ...filters, query: query.trim() }, signal })
    : call<PageResult>(resource + '/?' + new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '').map(([k, v]) => [k, String(v)])), { signal }),
  detail: (resource: string, id: string | number, signal?: AbortSignal) => call<AdminRecord>(`${resource}/${safe(id)}/`, { signal }),
  save: (resource: string, body: AdminRecord, id?: string | number, signal?: AbortSignal) => call<AdminRecord>(`${resource}/${id === undefined ? '' : safe(id) + '/'}`, { method: id === undefined ? 'POST' : 'PATCH', csrf: true, body, signal }),
  doctorDecision: (id: string, decision: 'approve' | 'reject', reason: string, signal?: AbortSignal) => call<AdminRecord>(`doctors/${safe(id)}/decision/`, { method: 'POST', csrf: true, body: { decision, reason }, signal }),
  accountAction: (id: string, action: 'block' | 'unblock' | 'sign-out', reason: string, action_id: string, signal?: AbortSignal) => call<OwnerAction>(`accounts/${safe(id)}/action/`, { method: 'POST', csrf: true, body: { action, reason, action_id }, signal }),
  orderAction: (id: string, action: string, action_id: string, signal?: AbortSignal) => call<OwnerAction>(`orders/${safe(id)}/actions/`, { method: 'POST', csrf: true, body: { action, action_id }, signal }),
  action: (id: string, signal?: AbortSignal) => call<OwnerAction>(`actions/${safe(id)}/`, { signal }),
  stockAdjust: (body: AdminRecord, signal?: AbortSignal) => call<AdminRecord>('stock/adjust/', { method: 'POST', csrf: true, body, signal }),
  uploadImage: (resource: 'products' | 'categories', id: string | number, file: File, revision: number, signal?: AbortSignal) => {
    const body = new FormData(); body.set('image', file); body.set('revision', String(revision))
    return call<AdminRecord>(`${resource}/${safe(id)}/image/`, { method: 'POST', csrf: true, body, signal })
  },
  removeImage: (resource: 'products' | 'categories', id: string | number, revision: number, signal?: AbortSignal) => call<AdminRecord>(`${resource}/${safe(id)}/image/`, { method: 'DELETE', csrf: true, body: { revision }, signal }),
  maintenancePreview: (serial: string, signal?: AbortSignal) => call<MaintenancePreview>(`kiosks/${safe(serial)}/maintenance/preview/`, { signal }),
  maintenance: (serial: string, body: { enabled: boolean; reason: string; revision: number; acknowledge_paid_orders: boolean }, signal?: AbortSignal) => call<AdminRecord>(`kiosks/${safe(serial)}/maintenance/`, { method: 'POST', csrf: true, body, signal }),
  technicalSummary: (signal?: AbortSignal) => call<TechnicalSummary>('technical/summary/', { signal }),
  metrics: (filters: Record<string, string | number>, signal?: AbortSignal) => call<Metrics>('technical/metrics/?' + new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])), { signal }),
  resources: (signal?: AbortSignal, window_minutes = 15, at = '') => call<Resources>(`technical/resources/?window_minutes=${window_minutes}&at=${safe(at)}`, { signal }),
  incidents: (filters: Record<string, string | number>, signal?: AbortSignal) => ownerApi.list('technical/incidents', filters, '', signal),
  acknowledgeIncident: (id: string, signal?: AbortSignal) => call<AdminRecord>(`technical/incidents/${safe(id)}/`, { method: 'PATCH', csrf: true, body: { status: 'ACKNOWLEDGED' }, signal }),
  services: (signal?: AbortSignal) => call<PageResult>('technical/services/', { signal }),
  servicePreview: (service: string, action: string, signal?: AbortSignal) => call<ServicePreview>(`technical/services/${safe(service)}/preview/?action=${safe(action)}`, { signal }),
  serviceAction: (service: string, action: string, action_id: string, preview_revision: string, signal?: AbortSignal) => call<OwnerAction>(`technical/services/${safe(service)}/actions/`, { method: 'POST', csrf: true, body: { action, action_id, preview_revision }, signal }),
  serviceActionStatus: (id: string, signal?: AbortSignal) => call<OwnerAction>(`technical/service-actions/${safe(id)}/`, { signal }),
}
