import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '@have/shared/api'
import { advanceOwnerAuthGeneration, ownerApi, type OwnerSession } from '@have/shared/api/owner'

type ContextValue = { data: OwnerSession | null; loading: boolean; notice: string; remaining: number; login: (phone: string, password: string, signal?: AbortSignal) => Promise<void>; logout: () => Promise<void>; restore: () => Promise<void> }
const Context = createContext<ContextValue | null>(null)
export function OwnerSessionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OwnerSession | null>(null), [loading, setLoading] = useState(true), [notice, setNotice] = useState(''), [now, setNow] = useState(Date.now())
  const epoch = useRef(0), lastActivity = useRef(0), activityBusy = useRef(false), expiryBusy = useRef(false), channel = useRef<BroadcastChannel | null>(null), current = useRef(data); current.current = data
  const serverOffset = useRef(0)
  function adopt(result: OwnerSession) {
    if (current.current && Date.parse(result.server_time) < Date.parse(current.current.server_time)) return
    serverOffset.current = Date.parse(result.server_time) - Date.now(); current.current = result; setData(result)
  }
  function invalidate(message = '') { epoch.current++; advanceOwnerAuthGeneration(); current.current = null; setData(null); setNotice(message); setLoading(false) }
  async function restore() {
    const generation = epoch.current
    try { const result = await ownerApi.session(); if (generation === epoch.current) { adopt(result); setNotice('') } }
    catch (failure) { if (generation === epoch.current && !(failure instanceof ApiError && [401, 403].includes(failure.status))) setNotice('Could not connect to the Owner service. Check the connection and try again.') }
    finally { if (generation === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    channel.current = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('have:owner:session') : null
    const remote = () => invalidate('Your Owner session ended in another tab. Sign in again.')
    const ended = () => invalidate('Your Owner session has ended. Sign in again.')
    channel.current?.addEventListener('message', remote); window.addEventListener('have:owner:session-ended', ended)
    void restore()
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { epoch.current++; clearInterval(clock); channel.current?.close(); window.removeEventListener('have:owner:session-ended', ended) }
  }, [])
  useEffect(() => {
    if (!data) return
    if (Date.now() + serverOffset.current >= Math.min(Date.parse(data.idle_expires_at), Date.parse(data.absolute_expires_at))) {
      if (expiryBusy.current) return
      // Another tab may have legitimately renewed the shared cookie session.
      // Hide private screens while checking; an old local deadline must not sign
      // out an active Owner in another tab.
      expiryBusy.current = true; setLoading(true); epoch.current++; advanceOwnerAuthGeneration(); const generation = epoch.current
      void ownerApi.session().then(result => {
        if (generation !== epoch.current) return
        if (Date.parse(result.server_time) >= Math.min(Date.parse(result.idle_expires_at), Date.parse(result.absolute_expires_at))) invalidate('Your Owner session expired. Sign in again.')
        else adopt(result)
      }).catch(() => { if (generation === epoch.current) invalidate('Your session could not be verified. Sign in again.') }).finally(() => { expiryBusy.current = false; if (generation === epoch.current) setLoading(false) })
    }
  }, [data, now])
  useEffect(() => {
    let checking = false
    const status = async () => {
      if (document.hidden || !current.current || checking) return
      checking = true; const generation = epoch.current
      try { const result = await ownerApi.session(); if (generation === epoch.current) adopt(result) }
      catch { /* Authorization failures clear the session through the shared event. A network failure does not invent a new deadline. */ }
      finally { checking = false }
    }
    const visible = () => { if (!document.hidden) void status() }
    const timer = setInterval(() => void status(), 30_000)
    document.addEventListener('visibilitychange', visible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [])
  useEffect(() => {
    const interact = (event: Event) => {
      if (!event.isTrusted || document.hidden || !current.current || activityBusy.current || Date.now() - lastActivity.current < 30_000) return
      lastActivity.current = Date.now(); activityBusy.current = true; const generation = epoch.current
      void ownerApi.activity().then(result => { if (generation === epoch.current) adopt(result) }).catch(() => {}).finally(() => { activityBusy.current = false })
    }
    document.addEventListener('pointerdown', interact); document.addEventListener('keydown', interact)
    return () => { document.removeEventListener('pointerdown', interact); document.removeEventListener('keydown', interact) }
  }, [])
  const login = async (phone_number: string, password: string, signal?: AbortSignal) => {
    epoch.current++; advanceOwnerAuthGeneration(); const generation = epoch.current
    await ownerApi.login({ phone_number, password }, signal)
    const result = await ownerApi.session(signal)
    if (generation === epoch.current && !signal?.aborted) { adopt(result); setNotice(''); channel.current?.postMessage('signed-in') }
  }
  const logout = async () => {
    invalidate(); channel.current?.postMessage('signed-out')
    try { await ownerApi.logout() } catch { setNotice('Signed out on this screen. Server-side sign-out was not confirmed; reconnect and sign in, then sign out to confirm it.') }
  }
  const remaining = data ? Math.max(0, Math.ceil((Math.min(Date.parse(data.idle_expires_at), Date.parse(data.absolute_expires_at)) - now - serverOffset.current) / 1000)) : 0
  return <Context.Provider value={{ data, loading, notice, remaining, login, logout, restore }}>{children}</Context.Provider>
}
export function useOwnerSession() { const value = useContext(Context); if (!value) throw new Error('Owner session provider required'); return value }
