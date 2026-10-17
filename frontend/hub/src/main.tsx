import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createAppI18n } from '@have/shared/i18n'
import '@have/shared/styles'
import App from './app/App'
import en from './features/auth/locales/en.json'
import ar from './features/auth/locales/ar.json'
import catalogueEn from './features/catalogue/locales/en.json'
import catalogueAr from './features/catalogue/locales/ar.json'
import commonCatalogueEn from '@have/shared/i18n/catalogue/en.json'
import commonCatalogueAr from '@have/shared/i18n/catalogue/ar.json'
import purchaseEn from './features/orders/locales/en.json'
import purchaseAr from './features/orders/locales/ar.json'

const i18n = await createAppI18n('hub')
i18n.addResourceBundle('en', 'hub', en)
i18n.addResourceBundle('ar', 'hub', ar)
i18n.addResourceBundle('en', 'hubCatalogue', catalogueEn)
i18n.addResourceBundle('ar', 'hubCatalogue', catalogueAr)
i18n.addResourceBundle('en', 'catalogue', commonCatalogueEn)
i18n.addResourceBundle('ar', 'catalogue', commonCatalogueAr)
i18n.addResourceBundle('en', 'hubPurchase', purchaseEn)
i18n.addResourceBundle('ar', 'hubPurchase', purchaseAr)
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
