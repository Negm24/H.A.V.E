import { ApiError } from '@have/shared/api'
import { terminalApi, type TerminalSession } from '@have/shared/api/terminal'
import type { SessionState } from '../types'

const fresh = (): SessionState => ({ phase: 'attract', language: null, customer: null, busy: false, remaining: 0, error: null, retryUntil: 0 })
// Backend defaults; response deadlines can shorten these, never extend the maximum.
const MAXIMUM_MS = 900_000
const ACTIVITY_GAP_MS = 5_000

export function createSessionController(api: Pick<typeof terminalApi, 'start' | 'activity' | 'end' | 'login' | 'me' | 'createQr' | 'qrStatus' | 'completeQr'> = terminalApi, now = Date.now) {
  let state = fresh()
  let token = ''
  let epoch = 0
  let abort = new AbortController()
  let deadline = 0
  let maximum = 0
  let lastActivity = -Infinity
  let trailing: ReturnType<typeof setTimeout> | undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let queue: Promise<unknown> = Promise.resolve()
  const listeners = new Set<() => void>()
  const publish = (changes: Partial<SessionState>) => {
    state = { ...state, ...changes }
    listeners.forEach(listener => listener())
  }
  const active = () => state.phase === 'guest' || state.phase === 'customer'
  const assertCurrent = (signal: AbortSignal) => {
    if (signal.aborted || signal !== abort.signal) throw new DOMException('Session ended', 'AbortError')
  }
  const remaining = () => Math.max(0, Math.ceil((Math.min(deadline, maximum) - now()) / 1000))

  function reset(end = true) {
    const oldToken = token
    const pending = queue
    epoch++
    abort.abort()
    abort = new AbortController()
    queue = Promise.resolve()
    token = ''
    clearTimeout(trailing)
    trailing = undefined
    lastActivity = -Infinity
    publish(fresh())
    // Local privacy cleanup is immediate, even if the network is down.
    if (end && oldToken) void pending.catch(() => {}).then(() => api.end(oldToken)).catch(() => {})
  }

  function tick() {
    if (!active()) return
    if (!remaining()) reset()
    else if (remaining() !== state.remaining) publish({ remaining: remaining() })
  }

  function enqueue<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const current = epoch
    const signal = abort.signal
    const result = queue.then(async () => {
      if (current !== epoch) throw new DOMException('Session ended', 'AbortError')
      const value = await work(signal)
      if (current !== epoch) throw new DOMException('Session ended', 'AbortError')
      return value
    })
    queue = result.catch(() => {})
    return result
  }

  function problem(error: unknown, credentials = false) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    const status = error instanceof ApiError ? error.status : 0
    const retry = error instanceof ApiError ? error.retryAfter || 0 : 0
    publish({ error: status === 429 ? 'limited' : status === 401 && credentials ? 'credentials'
      : status === 403 ? 'denied' : status === 400 ? 'invalid' : 'unavailable',
      retryUntil: now() + retry * 1000 })
  }

  function adopt(result: TerminalSession, started?: number) {
    if (started !== undefined) maximum = started + MAXIMUM_MS
    if (result.session_token) token = result.session_token
    deadline = Math.min(now() + result.idle_expires_in * 1000, maximum)
    if (result.customer) publish({ phase: 'customer', customer: result.customer })
    publish({ remaining: remaining() })
  }

  async function action(work: (signal: AbortSignal) => Promise<void>, credentialAction = false) {
    if (state.busy || now() < state.retryUntil) return false
    const current = epoch
    publish({ busy: true, error: null })
    try {
      await enqueue(work)
      return true
    } catch (error) {
      if (current === epoch) problem(error, credentialAction)
      return false
    } finally { if (current === epoch) publish({ busy: false }) }
  }

  async function activity() {
    const current = epoch
    lastActivity = now()
    try {
      await enqueue(async signal => {
        const result = await api.activity(token, signal)
        assertCurrent(signal); adopt(result)
      })
    } catch (error) {
      if (current !== epoch) return
      if (error instanceof ApiError && error.status === 401) reset(false)
      else problem(error)
    }
  }

  function interact() {
    if (!active()) return
    if (!remaining()) return reset()
    const wait = ACTIVITY_GAP_MS - (now() - lastActivity)
    if (wait <= 0 && !state.busy) {
      clearTimeout(trailing)
      trailing = undefined
      void activity()
    } else if (!trailing) {
      trailing = setTimeout(() => {
        trailing = undefined
        if (active()) {
          if (state.busy) interact()
          else void activity()
        }
      }, Math.max(100, wait))
    }
  }

  async function authenticated(result: TerminalSession, signal: AbortSignal) {
    assertCurrent(signal)
    if (!result.session_token || !result.customer) throw new Error('Invalid login response')
    adopt(result)
    lastActivity = now()
    try {
      const customer = await api.me(token, signal)
      assertCurrent(signal); publish({ customer })
    }
    catch (error) {
      assertCurrent(signal)
      if (error instanceof ApiError && error.status === 401) reset(false)
      throw error
    }
  }

  async function query<T>(work: (signal: AbortSignal) => Promise<T>) {
    const current = epoch
    try { return await enqueue(work) }
    catch (error) {
      if (current === epoch && error instanceof ApiError && error.status === 401) reset(false)
      throw error
    }
  }

  return {
    // Feature operations join the same queue as login/activity/end. The token is
    // resolved at execution time, never exposed through React state or storage.
    request: <T>(work: (currentToken: string, signal: AbortSignal) => Promise<T>) => query(signal => work(token, signal)),
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    connect() {
      interval = setInterval(tick, 250)
      return () => { clearInterval(interval); clearTimeout(trailing) }
    },
    chooseLanguage: () => publish({ phase: 'language', error: null }),
    async start(language: 'en' | 'ar') {
      if (state.phase !== 'language') return false
      const current = epoch
      const started = now()
      publish({ phase: 'starting', language })
      const success = await action(async signal => {
        const result = await api.start(signal)
        assertCurrent(signal)
        if (!result.session_token) throw new Error('Invalid session response')
        adopt(result, started)
        publish({ phase: 'guest' })
      })
      if (!success && current === epoch) publish({ phase: 'language' })
      return success
    },
    login: (phone: string, pin: string) => action(async signal => {
      try { await authenticated(await api.login(token, phone, pin, signal), signal) }
      catch (error) {
        assertCurrent(signal)
        if (error instanceof ApiError && error.status === 401 && state.phase === 'guest') {
          // Login 401 also means wrong PIN. Distinguish it from a dead session.
          try {
            const result = await api.activity(token, signal)
            assertCurrent(signal); adopt(result); lastActivity = now()
          }
          catch (check) {
            assertCurrent(signal)
            if (check instanceof ApiError && check.status === 401) reset(false)
            else throw check
          }
        }
        throw error
      }
    }, true),
    createQr: () => query(signal => api.createQr(token, signal)),
    qrStatus: (id: string) => query(signal => api.qrStatus(token, id, signal)),
    completeQr: (id: string) => action(async signal => authenticated(await api.completeQr(token, id, signal), signal)),
    refreshIdentity: () => action(async signal => {
      try {
        const customer = await api.me(token, signal)
        assertCurrent(signal); publish({ customer })
      }
      catch (error) {
        assertCurrent(signal)
        if (error instanceof ApiError && error.status === 401) reset(false)
        throw error
      }
    }),
    continueSession: () => action(async signal => {
      try {
        const result = await api.activity(token, signal)
        assertCurrent(signal); adopt(result); lastActivity = now()
      } catch (error) {
        assertCurrent(signal)
        if (error instanceof ApiError && error.status === 401) reset(false)
        throw error
      }
    }),
    clearError: () => publish({ error: null }),
    interact,
    reset,
  }
}

export type SessionController = ReturnType<typeof createSessionController>
