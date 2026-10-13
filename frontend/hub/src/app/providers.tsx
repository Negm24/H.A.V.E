import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { customerApi, type Customer } from '@have/shared/api/customer'
import { createCookieSession, type SessionSignal } from '@have/shared/auth/session'
import { browserSessionLock } from '@have/shared/auth/browser-lock'

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('have:hub:session-events') : null
export const hubSession = createCookieSession(customerApi, browserSessionLock('have:hub:session'), event => channel?.postMessage(event))
const Context = createContext<{ session: typeof hubSession; status: 'loading' | 'anonymous' | 'authenticated'; customer: Customer | null; notice: string; logout: () => Promise<void> } | null>(null)
let started = false

export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(hubSession.subscribe, hubSession.getSnapshot)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const remote = (event: MessageEvent<SessionSignal>) => { if (event.data === 'signed-in' || event.data === 'signed-out') hubSession.remote(event.data) }
    channel?.addEventListener('message', remote)
    if (!started) { started = true; void hubSession.restore().catch(() => setNotice('restoreFailed')) }
    return () => channel?.removeEventListener('message', remote)
  }, [])
  const logout = async () => {
    setNotice('')
    try { await hubSession.logout() } catch { setNotice('logoutFailed') }
  }
  return <Context.Provider value={{ ...state, session: hubSession, notice, logout }}>{children}</Context.Provider>
}

export function useSession() {
  const context = useContext(Context)
  if (!context) throw new Error('Hub requires SessionProvider')
  return context
}
