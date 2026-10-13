import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { customerApi, type Challenge } from '@have/shared/api/customer'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button, Dialog } from '@have/shared/ui/controls'
import { Field, FormSection } from '@have/shared/ui/forms'
import { formatDob, signupSchema, type SignupForm } from '../schemas'
import { useOperation, useReloadWarning } from '../hooks/useOperation'
import { VerificationForm } from '../components/VerificationForm'

const empty: SignupForm = { first_name: '', last_name: '', phone_number: '', email: '', date_of_birth: '', pin: '', confirm_pin: '' }
export function SignupPage() {
  const { t } = useTranslation('hub'), navigate = useNavigate(), operation = useOperation()
  const [step, setStep] = useState<'form' | 'sms' | 'email'>('form')
  const [challenge, setChallenge] = useState<Challenge | null>(null), [deadline, setDeadline] = useState(0), [resendAt, setResendAt] = useState(0), [restart, setRestart] = useState(false)
  const { register, handleSubmit, getValues, setValue, resetField, formState: { errors, isDirty } } = useForm<SignupForm>({ resolver: zodResolver(signupSchema), defaultValues: empty })
  useReloadWarning(isDirty || step !== 'form')
  const fieldError = (key: keyof SignupForm) => operation.fields[key] || (errors[key] ? t(`validation.${errors[key]?.message ?? 'required'}`) : undefined)
  const submit = handleSubmit(data => operation.run(signal => {
    const { confirm_pin: _confirmation, ...body } = data
    return customerApi.signup({ ...body, date_of_birth: body.date_of_birth.replaceAll('/', '-') }, signal)
  }, result => {
    setChallenge(result); setDeadline(Date.now() + result.expires_in * 1000); setResendAt(Date.now() + result.resend_after * 1000)
    resetField('pin'); resetField('confirm_pin'); setStep('sms')
  }))
  const verify = (code: string) => { if (!challenge) return; void operation.run(signal => customerApi.verifySignup({ challenge_id: challenge.challenge_id, phone_number: getValues('phone_number'), code }, signal), result => {
    if ('next_step' in result) { setDeadline(Date.now() + result.expires_in * 1000); setStep('email') }
    else navigate('/login', { replace: true, state: { message: 'accountCreated' } })
  }) }
  return <FormSection title={step === 'form' ? t('createAccount') : t(step === 'sms' ? 'verifyPhone' : 'verifyEmail')} description={step === 'form' ? t('signupDescription') : t(step === 'sms' ? 'smsDescription' : 'emailDescription')}>
    {operation.error && <Alert>{operation.error}</Alert>}
    {step === 'form' ? <form className="hub-form" onSubmit={submit}>
      <div className="hub-two-fields"><Field label={t('firstName')} {...register('first_name')} autoComplete="given-name" dir="ltr" error={fieldError('first_name')} /><Field label={t('lastName')} {...register('last_name')} autoComplete="family-name" dir="ltr" error={fieldError('last_name')} /></div>
      <Field label={t('phone')} {...register('phone_number')} type="tel" autoComplete="tel" dir="ltr" error={fieldError('phone_number')} />
      <Field label={t('email')} {...register('email')} type="email" autoComplete="email" dir="ltr" error={fieldError('email')} />
      <Field label={t('dob')} {...register('date_of_birth', { onChange: event => setValue('date_of_birth', formatDob(event.target.value), { shouldDirty: true }) })} inputMode="numeric" placeholder="DD/MM/YYYY" dir="ltr" maxLength={10} error={fieldError('date_of_birth')} />
      <div className="hub-two-fields"><Field label={t('pin')} {...register('pin')} type="password" inputMode="numeric" autoComplete="new-password" dir="ltr" maxLength={4} error={fieldError('pin')} /><Field label={t('confirmPin')} {...register('confirm_pin')} type="password" inputMode="numeric" autoComplete="new-password" dir="ltr" maxLength={4} error={fieldError('confirm_pin')} /></div>
      {operation.remaining > 0 && <p role="status">{t('resendWait', { seconds: operation.remaining })}</p>}
      <Button variant="primary" disabled={operation.busy || operation.remaining > 0}>{operation.busy ? t('working') : t('sendCode')}</Button>
    </form> : <VerificationForm key={step} deadline={deadline} resendAt={Math.max(resendAt, Date.now() + operation.remaining * 1000)} busy={operation.busy || operation.remaining > 0} onVerify={verify} onResend={() => setRestart(true)} />}
    <p className="hub-form-bottom"><Link to="/login">{t('backToLogin')}</Link></p>
    {restart && <Dialog title={t('restartTitle')}><p>{t('restartDescription')}</p><Button variant="primary" onClick={() => { setRestart(false); setStep('form'); setChallenge(null); operation.clear() }}>{t('restartConfirm')}</Button><Button onClick={() => setRestart(false)}>{t('cancel')}</Button></Dialog>}
  </FormSection>
}
