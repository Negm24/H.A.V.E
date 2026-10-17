export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter: number | null = null,
    public readonly fields: Record<string, string> = {},
  ) { super(message); this.name = 'ApiError' }
}

type JsonObject = Record<string, unknown>
export interface RequestOptions {
  terminalSimulatorId?: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  bearerToken?: string
  csrf?: boolean
  signal?: AbortSignal
  timeoutMs?: number
}

function retryDelay(value: string | null): number | null {
  if (!value) return null
  const number = Number(value)
  if (Number.isFinite(number)) return Math.max(0, Math.ceil(number))
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

// Same-origin API only. No implicit refresh, retries, token storage, or device headers.
// Each future endpoint wrapper explicitly chooses its app's authentication policy.
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/api/') || path.includes('..') || path.includes('\\')) {
    throw new Error('Use an absolute /api/ path on this app origin.')
  }
  const method = options.method ?? 'GET'
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const headers = new Headers({ Accept: 'application/json' })
  if (options.terminalSimulatorId) {
    if (!path.startsWith('/api/v1/terminals/') && !path.startsWith('/api/v1/auth/customers/terminal/')) {
      throw new Error('Terminal simulator selection is only allowed on Terminal routes.')
    }
    headers.set('X-Terminal-Simulator', options.terminalSimulatorId)
  }
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.bearerToken) headers.set('Authorization', `Bearer ${options.bearerToken}`)
  if (options.csrf && method !== 'GET') {
    // Obtain a current token, including after owner login rotates it.
    const result = await request<{ csrf_token: string }>('/api/v1/auth/csrf/', { signal })
    headers.set('X-CSRFToken', result.csrf_token)
  }
  let response: Response
  try {
    response = await fetch(path, {
      method, headers, signal, credentials: 'same-origin', cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    if (signal.aborted) throw new ApiError(options.signal?.aborted ? 'Request cancelled.' : 'Request timed out.', 0)
    throw new ApiError('Unable to reach the server. Check your connection.', 0)
  }
  if (response.status === 204) return undefined as T
  let payload: unknown
  try { payload = await response.json() } catch { payload = undefined }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' ? (payload as JsonObject).detail : undefined
    const fields: Record<string, string> = {}
    if (payload && typeof payload === 'object') {
      for (const [key, value] of Object.entries(payload)) {
        if (Array.isArray(value) && typeof value[0] === 'string') fields[key] = value[0]
      }
    }
    throw new ApiError(typeof detail === 'string' ? detail : 'The request could not be completed.',
      response.status, retryDelay(response.headers.get('Retry-After')), fields)
  }
  if (payload === undefined) throw new ApiError('The server returned an invalid response.', response.status)
  return payload as T
}

export function getHealth(signal?: AbortSignal) {
  return request<{ status: 'ok' }>('/api/v1/health/', { signal })
}
