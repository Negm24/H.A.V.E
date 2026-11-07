import { AppSurface } from '@have/shared/ui'
import { useScreenReady } from '@have/shared/telemetry/react'

export default function App() {
  useScreenReady(true)
  return <AppSurface><h1>H.A.V.E Advisor</h1></AppSurface>
}
