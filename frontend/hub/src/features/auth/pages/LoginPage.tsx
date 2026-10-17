import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { Field, FormSection } from '@have/shared/ui/forms'
import { loginSchema, type LoginData } from '../schemas'
import { useOperation } from '../hooks/useOperation'
import { useSession } from '../../../app/providers'

export function LoginPage() {
  const { t } = useTranslation('hub'), { session } = useSession(), operation = useOperation()
  const navigate = useNavigate(), location = useLocation()
  const { register, handleSubmit, formState: { errors } } = useForm<LoginData>({ resolver: zodResolver(loginSchema), defaultValues: { phone_number: '', pin: '', remember_me: false } })
  return <FormSection title={t('signIn')} description={t('loginDescription')}>
    {location.state?.message && <p className="hub-success" role="status">{t(location.state.message)}</p>}
    {operation.error && <Alert>{operation.error}</Alert>}
    <form className="hub-form" onSubmit={handleSubmit(data => operation.run(() => session.login(data), () => {
      const requested = location.state?.from
      navigate(typeof requested === 'string' && /^\/(orders|browse|checkout)(\/|\?|$)/.test(requested) ? requested : '/dashboard', { replace: true })
    }))}>
      <Field label={t('phone')} {...register('phone_number')} type="tel" autoComplete="tel" dir="ltr" error={operation.fields.phone_number || (errors.phone_number && t('validation.required'))} />
      <Field label={t('pin')} {...register('pin')} type="password" inputMode="numeric" autoComplete="current-password" dir="ltr" maxLength={4} error={errors.pin && t('validation.pin')} />
      <div className="hub-form-row"><label className="hub-check"><input type="checkbox" {...register('remember_me')} />{t('rememberMe')}</label><Link to="/forgot-pin">{t('forgotPin')}</Link></div>
      {operation.remaining > 0 && <p role="status">{t('resendWait', { seconds: operation.remaining })}</p>}
      <Button variant="primary" disabled={operation.busy || operation.remaining > 0}>{operation.busy ? t('working') : t('signIn')}</Button>
    </form><p className="hub-form-bottom">{t('noAccount')} <Link to="/signup">{t('createAccount')}</Link></p>
  </FormSection>
}
