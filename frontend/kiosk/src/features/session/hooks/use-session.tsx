import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createSessionController, type SessionController } from '../services/session-controller'

const SessionContext = createContext<SessionController | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(createSessionController)
  useEffect(() => controller.connect(), [controller])
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible' && controller.getSnapshot().phase === 'customer') void controller.refreshIdentity()
    }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [controller])
  return <SessionContext.Provider value={controller}>{children}</SessionContext.Provider>
}

export function useSession() {
  const controller = useContext(SessionContext)
  if (!controller) throw new Error('SessionProvider is required')
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return { controller, state }
}
