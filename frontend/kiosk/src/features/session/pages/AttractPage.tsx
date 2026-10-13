import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { useSession } from '../hooks/use-session'

export function AttractPage() {
  const { t } = useTranslation('session')
  const { controller } = useSession()
  return <main className="terminal-attract">
    <div className="attract-primary">
      <div className="attract-brand"><span className="brand-mark">℞</span> H.A.V.E Terminal</div>
      <div><h1>{t('attractTitle', { lng: 'en' })}</h1>
        <p lang="ar" dir="rtl">{t('attractTitle', { lng: 'ar' })}</p>
        <div className="attract-rule" />
        <p className="attract-subtitle">Health Access &amp; Vending Everywhere</p>
      </div>
      <Button variant="primary" onClick={controller.chooseLanguage}>{t('start', { lng: 'en' })} <span lang="ar" dir="rtl">{t('start', { lng: 'ar' })}</span></Button>
    </div>
    <aside className="attract-aside"><div className="attract-emblem" aria-hidden="true">℞</div>
      <p>{t('attractNote', { lng: 'en' })}</p><p lang="ar" dir="rtl">{t('attractNote', { lng: 'ar' })}</p>
    </aside>
  </main>
}
