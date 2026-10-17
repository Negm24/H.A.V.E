import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { useState } from 'react'

export function SearchKeyboard({ value, change, email = false, label, maxLength = 100 }: { value: string; change: (text: string) => void; email?: boolean; label?: string; maxLength?: number }) {
  const { t, i18n } = useTranslation('catalogue')
  const arabic = !email && i18n.language === 'ar'
  const [numeric, setNumeric] = useState(false)
  const rows = numeric ? [arabic ? '١٢٣٤٥٦٧٨٩٠' : '1234567890', email ? '@._-+' : '.-%/+', ''] : arabic ? ['ضصثقفغعهخحج', 'شسيبلاتنمكط', 'ئءؤرىةوزظدذ'] : ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  const append = (text: string) => change((value + text).slice(0, maxLength))
  return <div className="search-keyboard" dir={arabic ? 'rtl' : 'ltr'} aria-label={label ?? t('keyboard')} onPointerDown={e => e.preventDefault()}>
    {rows.map((row, index) => <div key={index}>{[...row].map(key => <Button key={key} onClick={() => append(key)}>{key}</Button>)}{index === 0 && <Button aria-label={t('backspace')} onClick={() => change(value.slice(0, -1))}>⌫</Button>}{index === 2 && <><Button onClick={() => setNumeric(value => !value)}>{numeric ? (arabic ? 'أبج' : 'ABC') : '123'}</Button>{email ? <><Button onClick={() => append('@')}>@</Button><Button onClick={() => append('.com')}>.com</Button></> : <Button className="keyboard-space" onClick={() => append(' ')}>{t('space')}</Button>}</>}</div>)}
  </div>
}
