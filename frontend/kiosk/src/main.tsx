import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createAppI18n } from '@have/shared/i18n'
import { configureTerminalSimulator } from '@have/shared/api/terminal'
import '@have/shared/styles'
import App from './app/App'
import sessionEn from './features/session/locales/en.json'
import sessionAr from './features/session/locales/ar.json'
import authEn from './features/auth/locales/en.json'
import authAr from './features/auth/locales/ar.json'
import dashboardEn from './features/dashboard/locales/en.json'
import dashboardAr from './features/dashboard/locales/ar.json'
import ordersEn from './features/orders/locales/en.json'
import ordersAr from './features/orders/locales/ar.json'
import catalogueEn from '@have/shared/i18n/catalogue/en.json'
import catalogueAr from '@have/shared/i18n/catalogue/ar.json'

const selectors = new URLSearchParams(window.location.search).getAll('terminal')
const simulatorId = selectors.length ? (selectors.length === 1 && /^[a-f0-9]{32}$/.test(selectors[0]!) ? selectors[0] : 'invalid') : undefined
configureTerminalSimulator(simulatorId)
const i18n = await createAppI18n('kiosk')
i18n.addResourceBundle('en', 'catalogue', catalogueEn)
i18n.addResourceBundle('ar', 'catalogue', catalogueAr)
i18n.addResourceBundle('en', 'orders', ordersEn)
i18n.addResourceBundle('ar', 'orders', ordersAr)
for (const [namespace, en, ar] of [['session', sessionEn, sessionAr], ['auth', authEn, authAr], ['dashboard', dashboardEn, dashboardAr]] as const) {
  i18n.addResourceBundle('en', namespace, en)
  i18n.addResourceBundle('ar', namespace, ar)
}
createRoot(document.getElementById('root')!).render(<StrictMode><App simulatorId={simulatorId} /></StrictMode>)
