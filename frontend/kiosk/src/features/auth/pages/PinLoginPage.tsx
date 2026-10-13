import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'
import { NumericKeypad } from '../components/NumericKeypad'
import { latinDigits, loginSchema, type LoginFields } from '../schemas'

export function PinLoginPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const { controller, state } = useSession()
  const [field, setField] = useState<'phone' | 'pin'>('phone')
  const { register, handleSubmit, watch, setValue, getValues, trigger, formState: { errors } } = useForm<LoginFields>({
    resolver: zodResolver(loginSchema), defaultValues: { phone: '', pin: '' },
  })
  const pin = watch('pin')
  const disabled = state.busy || Date.now() < state.retryUntil
  const key = (value: string) => {
    const old = getValues(field)
    const next = value === 'clear' ? '' : value === 'backspace' ? old.slice(0, -1) : old + value
    if (next.length <= (field === 'pin' ? 4 : 11)) setValue(field, next, { shouldValidate: false })
  }
  return <KioskFrame title={t('title')} back="/guest">
    <form className="pin-page" onSubmit={field === 'phone' ? async event => {
      event.preventDefault()
      if (await trigger('phone')) setField('pin')
    } : handleSubmit(async values => {
      await controller.login(values.phone, values.pin)
      setValue('pin', '')
    })} autoComplete="off">
      <div className="pin-fields"><h1>{t(field === 'phone' ? 'phone' : 'enterPin')}</h1>
        {field === 'phone' ? <><label>{t('phone')}<input {...register('phone')} dir="ltr" type="tel" inputMode="none" maxLength={13} placeholder="01012345678"
          disabled={disabled} onChange={event => setValue('phone', latinDigits(event.target.value))} /></label>
          {errors.phone && <span className="field-error" role="alert">{t(errors.phone.message || 'phoneInvalid')}</span>}</>
        : <><p><bdi>{getValues('phone')}</bdi></p><label>{t('pin')}<div className="pin-entry">
          <input {...register('pin')} className="pin-native" dir="ltr" type="password" inputMode="none" maxLength={4} autoFocus
            disabled={disabled} onChange={event => setValue('pin', latinDigits(event.target.value))} />
          <div className="pin-boxes" dir="ltr" aria-hidden="true">{[0,1,2,3].map(index => <span key={index}>{pin[index] ? '•' : ''}</span>)}</div>
        </div></label></>}
        {errors.pin && <span className="field-error" role="alert">{t(errors.pin.message || 'pinInvalid')}</span>}
        <div className="pin-actions">{field === 'pin' && <Button type="button" onClick={() => setField('phone')} disabled={disabled}>{t('changePhone')}</Button>}
          <Button type="submit" variant="primary" disabled={disabled}>{t(state.busy ? 'signingIn' : field === 'phone' ? 'enterPin' : 'signIn')}</Button></div>
        {field === 'phone' && <Button type="button" disabled={disabled} onClick={() => { controller.clearError(); navigate('/auth/qr') }}>{t('qrAlternative')}</Button>}
        <p className="small-note">{t('hubHelp')}</p>
      </div>
      <div className="keypad-panel"><p>{t(field === 'phone' ? 'phone' : 'pin')}</p><NumericKeypad disabled={disabled} onKey={key} /></div>
    </form>
  </KioskFrame>
}
