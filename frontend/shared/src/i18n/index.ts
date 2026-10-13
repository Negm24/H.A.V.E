import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import ar from './ar.json'
export { useTranslation } from 'react-i18next'

export type AppName = 'kiosk' | 'hub' | 'advisor' | 'admin'
export type Language = 'en' | 'ar'

export function languageDirection(language: string): 'rtl' | 'ltr' {
  return language.split('-')[0] === 'ar' ? 'rtl' : 'ltr'
}

export function applyDocumentLanguage(language: string) {
  document.documentElement.lang = language
  document.documentElement.dir = languageDirection(language)
}

// Instance per app: sharing translation tools does not share customer/session state.
export async function createAppI18n(app: AppName) {
  const persistent = app === 'hub' || app === 'advisor'
  const storageKey = `have:${app}:language`
  let language: Language = 'en'
  if (persistent) {
    try { if (localStorage.getItem(storageKey) === 'ar') language = 'ar' } catch { /* Storage may be disabled. */ }
  }
  const instance = createInstance()
  await instance.use(initReactI18next).init({
    resources: app === 'admin' ? { en: { common: en } } : { en: { common: en }, ar: { common: ar } },
    lng: language,
    fallbackLng: 'en',
    supportedLngs: app === 'admin' ? ['en'] : ['en', 'ar'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  })
  applyDocumentLanguage(language)
  instance.on('languageChanged', (next) => {
    const selected: Language = app !== 'admin' && next === 'ar' ? 'ar' : 'en'
    applyDocumentLanguage(selected)
    if (persistent) {
      try { localStorage.setItem(storageKey, selected) } catch { /* Preference is optional. */ }
    }
  })
  return instance
}
