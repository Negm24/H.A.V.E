import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createAppI18n } from '@have/shared/i18n'
import '@have/shared/styles'
import App from './app/App'
import sessionEn from './features/session/locales/en.json'
import sessionAr from './features/session/locales/ar.json'
import authEn from './features/auth/locales/en.json'
import authAr from './features/auth/locales/ar.json'
import dashboardEn from './features/dashboard/locales/en.json'
import dashboardAr from './features/dashboard/locales/ar.json'

const i18n = await createAppI18n('kiosk')
for (const [namespace, en, ar] of [['session', sessionEn, sessionAr], ['auth', authEn, authAr], ['dashboard', dashboardEn, dashboardAr]] as const) {
  i18n.addResourceBundle('en', namespace, en)
  i18n.addResourceBundle('ar', namespace, ar)
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
