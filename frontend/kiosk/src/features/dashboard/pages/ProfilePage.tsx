import { useEffect } from 'react'
import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'
import { useNavigate } from 'react-router-dom'

export function ProfilePage() {
  const { t } = useTranslation('dashboard')
  const { controller, state } = useSession()
  const navigate = useNavigate()
  useEffect(() => { void controller.refreshIdentity() }, [controller])
  const customer = state.customer
  const items = customer ? [
    ['name', `${customer.first_name} ${customer.last_name}`], ['phone', customer.phone_number],
    ['email', customer.email], ['dob', customer.date_of_birth], ['accountId', customer.id],
  ] : []
  return <KioskFrame title={t('profile')} back="/dashboard"><h1>{t('profile')}</h1>
    <p className="page-intro">{t('readOnly')}</p><dl className="profile-grid">{items.map(([label, value]) => <div key={label}><dt>{t(label!)}</dt><dd><bdi>{value}</bdi></dd></div>)}</dl>
    <div className="profile-actions">
      <Button disabled={state.busy} onClick={() => void controller.refreshIdentity()}>{t('refreshProfile')}</Button>
      <Button onClick={() => navigate('/profile/orders')}>{t('orders')}</Button>
    </div>
  </KioskFrame>
}
