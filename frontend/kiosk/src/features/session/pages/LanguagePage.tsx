import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../hooks/use-session'

export function LanguagePage() {
  const { t } = useTranslation('session')
  const { controller, state } = useSession()
  return <KioskFrame title="H.A.V.E Terminal">
    <div className="language-page"><div><h1>{t('chooseLanguage', { lng: 'en' })}</h1>
      <p lang="ar" dir="rtl">{t('chooseLanguage', { lng: 'ar' })}</p></div>
      <div className="language-options">
        <Button disabled={state.busy} onClick={() => void controller.start('en')}><strong>English</strong><span>Continue in English</span></Button>
        <Button disabled={state.busy} onClick={() => void controller.start('ar')} lang="ar" dir="rtl"><strong>العربية</strong><span>المتابعة بالعربية</span></Button>
      </div>
      {state.busy && <p role="status">{t('starting')}</p>}
    </div>
  </KioskFrame>
}
