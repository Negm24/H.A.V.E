import { Button } from '@have/shared/ui/controls'
import { useTranslation } from '@have/shared/i18n'

export function NumericKeypad({ onKey, disabled }: { onKey: (key: string) => void; disabled: boolean }) {
  const { t, i18n } = useTranslation('auth')
  return <div className="numeric-keypad" dir="ltr" aria-label={t('keypad')}>
    {['1','2','3','4','5','6','7','8','9','clear','0','backspace'].map(key =>
      <Button key={key} disabled={disabled} onPointerDown={event => event.preventDefault()} onClick={() => onKey(key)}
        aria-label={/^\d$/.test(key) ? key : t(key)}>
        {/^\d$/.test(key) ? new Intl.NumberFormat(i18n.language, { numberingSystem: i18n.language === 'ar' ? 'arab' : 'latn' }).format(Number(key)) : key === 'backspace' ? '⌫' : t(key)}
      </Button>)}
  </div>
}
