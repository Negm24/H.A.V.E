export type TelemetryApp = 'hub' | 'kiosk' | 'advisor' | 'admin'
export type FeatureName = 'browse' | 'search' | 'cart' | 'qr_login' | 'checkout_start' | 'order_history' | 'login_success' | 'collection'
type Vital = { value: number }
type Vitals = { onLCP: (callback: (metric: Vital) => void) => void; onINP: (callback: (metric: Vital) => void) => void; onCLS: (callback: (metric: Vital) => void) => void }
type Event = { metric: string; route: string; value: number }
const features = new Set<FeatureName>(['browse', 'search', 'cart', 'qr_login', 'checkout_start', 'order_history', 'login_success', 'collection'])

export function telemetryRoute(path: string): string {
  const value = path.split('?')[0].toLowerCase()
  for (const [match, label] of [['terminal-login', 'qr'], ['qr-login', 'qr'], ['forgot', 'recovery'], ['password-reset', 'recovery'], ['pin-reset', 'recovery'], ['signup', 'signup'], ['login', 'login'], ['checkout', 'checkout'], ['cart', 'cart'], ['browse', 'catalogue'], ['catalogue', 'catalogue'], ['orders', 'orders'], ['profile', 'profile'], ['dashboard', 'dashboard'], ['technical', 'technical']]) {
    if (value.includes(match)) return label
  }
  return 'other'
}

/** Counts and measurements only: no input text, payloads, identity or storage. */
export function startTelemetry(app: TelemetryApp, options: { vitals?: Vitals; release?: string } = {}) {
  let queue: Event[] = [], stopped = false, sending = false, sequence = 0
  let screen: { route: string; started: number; token: number } | null = null
  const originalFetch = window.fetch.bind(window)
  const currentRoute = () => telemetryRoute(location.pathname)
  function add(metric: string, value = 1, route = currentRoute()) {
    if (stopped || !Number.isFinite(value) || value < 0 || value > 120_000) return
    queue.push({ metric, route, value })
    if (queue.length > 100) queue.shift()
  }
  async function flush() {
    if (stopped || sending || !queue.length) return
    sending = true
    const events = queue.splice(0, 20)
    try {
      await originalFetch('/api/v1/telemetry/events/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app, events }), credentials: 'omit', keepalive: true })
    } catch { /* Metrics are disposable; never retry sensitive customer requests. */ }
    finally { sending = false }
  }
  const recordError = () => add('frontend_error')
  const hide = () => { if (document.hidden) void flush() }
  const click = (event: MouseEvent) => {
    const key = (event.target as Element | null)?.closest?.('[data-telemetry]')?.getAttribute('data-telemetry') as FeatureName | null
    if (key && features.has(key)) add('feature.' + key)
  }
  const measuredFetch: typeof window.fetch = async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    let relevant = false
    try {
      const url = new URL(path, location.origin)
      const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined
      const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
      const headers = new Headers(init?.headers ?? request?.headers)
      const background = method === 'GET' && headers.get('X-Have-Background') === '1'
      relevant = !background && url.origin === location.origin && url.pathname.startsWith('/api/v1/') && !/\/telemetry\/|\/health\/|\/auth\/csrf\/|\/technical\/|\/summary\/|\/activity\/|\/availability\/|\/heartbeat\/|\/cart\/version\/|\/qr-login\/[a-f\d-]+\/$|\/me\/|\/owner\/session\//i.test(url.pathname)
    } catch { /* Unsupported request shapes are not inspected. */ }
    const started = performance.now()
    try {
      const response = await originalFetch(input, init)
      if (relevant) {
        add('client_request_ms', performance.now() - started, telemetryRoute(path))
        if (response.status >= 500) add('api_error', 1, telemetryRoute(path))
      }
      return response
    } catch (failure) {
      const signal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null)
      const timeout = failure instanceof DOMException && failure.name === 'TimeoutError' || signal?.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      if (relevant && (timeout || !(failure instanceof DOMException && failure.name === 'AbortError'))) {
        add('client_request_ms', performance.now() - started, telemetryRoute(path))
        add(timeout ? 'client_timeout' : 'api_error', 1, telemetryRoute(path))
      }
      throw failure
    }
  }
  window.fetch = measuredFetch
  window.addEventListener('error', recordError)
  window.addEventListener('unhandledrejection', recordError)
  document.addEventListener('visibilitychange', hide)
  document.addEventListener('click', click)
  const timer = setInterval(() => void flush(), 10_000)
  options.vitals?.onLCP(metric => add('lcp_ms', metric.value))
  options.vitals?.onINP(metric => add('inp_ms', metric.value))
  options.vitals?.onCLS(metric => add('cls', metric.value))
  add('page_view')
  return {
    feature(name: FeatureName) { if (features.has(name)) add('feature.' + name) },
    beginScreen(route: string) {
      const token = ++sequence
      screen = { route: telemetryRoute(route), started: performance.now(), token }
      return token
    },
    screenReady(route: string, token?: number) {
      if (!screen || screen.route !== telemetryRoute(route) || token !== undefined && token !== screen.token) return
      add('screen_load_ms', performance.now() - screen.started, screen.route)
      screen = null
    },
    flush,
    stop() {
      stopped = true; queue = []; screen = null; clearInterval(timer)
      window.removeEventListener('error', recordError); window.removeEventListener('unhandledrejection', recordError)
      document.removeEventListener('visibilitychange', hide); document.removeEventListener('click', click)
      if (window.fetch === measuredFetch) window.fetch = originalFetch
    },
  }
}
