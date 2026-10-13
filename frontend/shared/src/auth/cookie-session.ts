import { ApiError } from '../api/http'

export interface SessionResult<T> { access_token: string; expires_in: number; customer: T }
export interface SessionSnapshot<T> { status: 'loading' | 'anonymous' | 'authenticated'; customer: T | null }
export type SessionSignal = 'signed-in' | 'signed-out'

// The lifecycle is shared, but each app supplies its own API, lock and channel.
// Only the token is private; no credentials or identity are persisted.
export function createCookieSession<T, Login>(api: {
  login: (data: Login) => Promise<SessionResult<T>>
  refresh: () => Promise<SessionResult<T>>
  logout: () => Promise<void>
}, exclusive: <R>(work: () => Promise<R>) => Promise<R>, notify: (event: SessionSignal) => void = () => {}, now = Date.now) {
  let snapshot: SessionSnapshot<T> = { status: 'loading', customer: null }
  let token = '', expiresAt = 0, generation = 0, blocked = false
  let flight: Promise<string> | null = null
  const listeners = new Set<() => void>()
  const publish = (next: SessionSnapshot<T>) => { snapshot = next; listeners.forEach(fn => fn()) }
  const clear = () => { generation++; token = ''; expiresAt = 0; publish({ status: 'anonymous', customer: null }) }
  const assert = (expected: number) => {
    if (expected !== generation) throw new DOMException('Session changed', 'AbortError')
  }
  const adopt = (result: SessionResult<T>, expected: number) => {
    assert(expected)
    token = result.access_token; expiresAt = now() + result.expires_in * 1000
    publish({ status: 'authenticated', customer: result.customer })
    return token
  }
  function fresh(force = false): Promise<string> {
    if (blocked) return Promise.reject(new ApiError('Sign in again.', 401))
    if (!force && token && expiresAt > now() + 30_000) return Promise.resolve(token)
    if (flight) return flight
    const expected = generation
    const current = exclusive(async () => {
      assert(expected)
      if (!force && token && expiresAt > now() + 30_000) return token
      try { return adopt(await api.refresh(), expected) }
      catch (error) {
        if (expected === generation && error instanceof ApiError && error.status === 401) {
          blocked = true; clear(); notify('signed-out')
        }
        throw error
      }
    }).finally(() => { if (flight === current) flight = null })
    flight = current
    return current
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    async restore() {
      try { await fresh() }
      catch (error) {
        if (snapshot.status === 'loading') publish({ status: 'anonymous', customer: null })
        if (!(error instanceof ApiError && error.status === 401)) throw error
      }
    },
    async login(data: Login) {
      const expected = generation
      await exclusive(async () => {
        assert(expected)
        const result = await api.login(data)
        assert(expected); blocked = false; adopt(result, expected); notify('signed-in')
      })
    },
    async logout() {
      blocked = true; clear(); notify('signed-out')
      await exclusive(() => api.logout())
    },
    async authorized<R>(work: (access: string) => Promise<R>, safeRead = false): Promise<R> {
      const expected = generation
      const access = await fresh(); assert(expected)
      try { const result = await work(access); assert(expected); return result }
      catch (error) {
        assert(expected)
        if (!safeRead || !(error instanceof ApiError && error.status === 401)) throw error
        const replacement = await fresh(true); assert(expected)
        const result = await work(replacement); assert(expected); return result
      }
    },
    setCustomer(customer: T) { if (snapshot.status === 'authenticated') publish({ status: 'authenticated', customer }) },
    remote(event: SessionSignal) {
      clear(); flight = null; blocked = event === 'signed-out'
      if (!blocked) { publish({ status: 'loading', customer: null }); void this.restore().catch(() => {}) }
    },
    invalidate() { blocked = true; clear(); notify('signed-out') },
  }
}
