import { useEffect, useLayoutEffect, useRef } from 'react'
import { onCLS, onINP, onLCP } from 'web-vitals'
import { startTelemetry, type FeatureName, type TelemetryApp } from './telemetry'

let client: ReturnType<typeof startTelemetry> | undefined

export function initializeTelemetry(app: TelemetryApp) {
  if (!client) client = startTelemetry(app, { vitals: { onCLS, onINP, onLCP } })
}

export function recordFeature(name: FeatureName) { client?.feature(name) }

/** Call from a screen with its critical-data readiness, never a polling timer. */
export function useScreenReady(ready: boolean, feature?: FeatureName) {
  const screen = useRef<{ path: string; token: number; reported: boolean } | null>(null)
  useLayoutEffect(() => {
    const path = location.pathname
    if (client) screen.current = { path, token: client.beginScreen(path), reported: false }
    return () => { screen.current = null }
  }, [])
  useEffect(() => {
    const current = screen.current
    if (!ready || !current || current.reported) return
    current.reported = true
    client?.screenReady(current.path, current.token)
    if (feature) client?.feature(feature)
  }, [ready, feature])
}
