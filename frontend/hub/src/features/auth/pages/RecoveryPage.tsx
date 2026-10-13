import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { customerApi, type Challenge, type RecoveryProof } from '@have/shared/api/customer'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { Field, FormSection } from '@have/shared/ui/forms'
import { resetSchema, type ResetForm } from '../schemas'
import { useOperation, useCountdown, useReloadWarning } from '../hooks/useOperation'
import { VerificationForm } from '../components/VerificationForm'
import { useSession } from '../../../app/providers'
import { latinDigits } from '@have/shared/auth/input'

export function RecoveryPage() {
  const { t } = useTranslation('hub'), navigate = useNavigate(), operation = useOperation(), { session } = useSession()
  const [phone, setPhone] = useState(''), [step, setStep] = useState<'request' | 'code' | 'pin'>('request')
  const [challenge, setChallenge] = useState<Challenge | null>(null), [proof, setProof] = useState<RecoveryProof | null>(null)
  const [deadline, setDeadline] = useState(0), [resendAt, setResendAt] = useState(0)
  const expires = useCountdown(deadline)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ResetForm>({ resolver: zodResolver(resetSchema), defaultValues: { new_pin: '', confirm_pin: '' } })
  useEffect(() => { if (step === 'pin' && !expires) { setProof(null); reset() } }, [step, expires === 0, reset])
  useReloadWarning(step !== 'request')
  const send = () => operation.run(signal => customerApi.requestReset(latinDigits(phone), signal), result => {
    setChallenge(result); setDeadline(Date.now() + result.expires_in * 1000); setResendAt(Date.now() + result.resend_after * 1000); setStep('code'); setProof(null); reset()
  })
  return <FormSection title={t('forgotPin')} description={t('recoveryDescription')}>
    {operation.error && <Alert>{operation.error}</Alert>}
    {step === 'request' ? <form className="hub-form" onSubmit={event => { event.preventDefault(); if (phone.trim()) void send() }}>
      <Field label={t('phone')} value={phone} onChange={event => setPhone(event.target.value)} type="tel" autoComplete="tel" dir="ltr" maxLength={32} required error={operation.fields.phone_number} />
      {operation.remaining > 0 && <p role="status">{t('resendWait', { seconds: operation.remaining })}</p>}
      <Button variant="primary" disabled={operation.busy || operation.remaining > 0}>{operation.busy ? t('working') : t('sendCode')}</Button>
    </form> : step === 'code' ? <VerificationForm deadline={deadline} resendAt={resendAt} busy={operation.busy || operation.remaining > 0} onResend={() => void send()} onVerify={code => { if (challenge) void operation.run(signal => customerApi.verifyReset({ challenge_id: challenge.challenge_id, phone_number: latinDigits(phone), code }, signal), result => { setProof(result); setDeadline(Date.now() + result.expires_in * 1000); setStep('pin') }) }} /> : <form className="hub-form" onSubmit={handleSubmit(data => { if (proof && expires) void operation.run(signal => customerApi.completeReset({ ...data, reset_token: proof.reset_token }, signal), () => { setProof(null); reset(); session.invalidate(); navigate('/login', { replace: true, state: { message: 'pinReset' } }) }) })}>
      <Field label={t('newPin')} {...register('new_pin')} type="password" inputMode="numeric" autoComplete="new-password" dir="ltr" maxLength={4} error={operation.fields.new_pin || (errors.new_pin && t('validation.pin'))} />
      <Field label={t('confirmPin')} {...register('confirm_pin')} type="password" inputMode="numeric" autoComplete="new-password" dir="ltr" maxLength={4} error={operation.fields.confirm_pin || (errors.confirm_pin && t(`validation.${errors.confirm_pin.message}`))} />
      <p role="status">{expires ? t('expires', { seconds: expires }) : t('expired')}</p><Button variant="primary" disabled={operation.busy || operation.remaining > 0 || !expires}>{t('resetPin')}</Button>
      {!expires && <Button type="button" onClick={() => { setProof(null); reset(); setStep('request') }}>{t('restartConfirm')}</Button>}
    </form>}
    <p className="hub-form-bottom"><Link to="/login">{t('backToLogin')}</Link></p>
  </FormSection>
}
