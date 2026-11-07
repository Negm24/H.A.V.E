import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createAppI18n } from '@have/shared/i18n'
import { initializeTelemetry } from '@have/shared/telemetry/react'
import '@have/shared/styles'
import App from './app/App'

initializeTelemetry('advisor')
await createAppI18n('advisor')
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
