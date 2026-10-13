import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createAppI18n } from '@have/shared/i18n'
import '@have/shared/styles'
import App from './app/App'
import en from './features/auth/locales/en.json'
import ar from './features/auth/locales/ar.json'

const i18n = await createAppI18n('hub')
i18n.addResourceBundle('en', 'hub', en)
i18n.addResourceBundle('ar', 'hub', ar)
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
