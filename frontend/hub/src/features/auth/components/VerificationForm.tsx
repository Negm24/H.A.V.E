import { useEffect, useState } from 'react'
import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { Field } from '@have/shared/ui/forms'
import { useCountdown } from '../hooks/useOperation'
import { latinDigits } from '@have/shared/auth/input'

export function VerificationForm({ deadline, resendAt, busy, onVerify, onResend }: { deadline: number; resendAt: number; busy: boolean; onVerify: (code: string) => void; onResend: () => void }) {
  const { t } = useTranslation('hub'), [code, setCode] = useState('')
  const expires = useCountdown(deadline), resend = useCountdown(resendAt)
  useEffect(() => { if (!expires) setCode('') }, [expires === 0])
  return <form className="hub-form" onSubmit={event => { event.preventDefault(); if (/^\d{6}$/.test(code) && expires) onVerify(code) }}>
    <Field label={t('code')} value={code} onChange={event => setCode(latinDigits(event.target.value).replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} required />
    <p className="hub-muted" role="status">{expires ? t('expires', { seconds: expires }) : t('expired')}</p>
    <Button variant="primary" disabled={busy || !expires || code.length !== 6}>{busy ? t('working') : t('verify')}</Button>
    <Button type="button" onClick={onResend} disabled={busy || resend > 0}>{resend ? t('resendWait', { seconds: resend }) : t('resend')}</Button>
  </form>
}
