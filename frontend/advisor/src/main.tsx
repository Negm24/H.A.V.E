import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createAppI18n } from '@have/shared/i18n'
import '@have/shared/styles'
import App from './app/App'

await createAppI18n('advisor')
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
