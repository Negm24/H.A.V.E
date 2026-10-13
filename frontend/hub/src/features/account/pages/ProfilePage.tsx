import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { customerApi } from '@have/shared/api/customer'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { useSession } from '../../../app/providers'
import { useOperation } from '../../auth/hooks/useOperation'

export function ProfilePage() {
  const { t } = useTranslation('hub'), { customer, session } = useSession(), operation = useOperation()
  const refresh = () => operation.run(signal => session.authorized(token => customerApi.me(token, signal), true), result => session.setCustomer(result))
  // Reads may refresh and retry once; profile never changes the session's lifetime.
  useEffect(() => { void refresh() }, [])
  return <section className="hub-profile"><Link to="/dashboard">← {t('backHome')}</Link><h1>{t('myProfile')}</h1>{operation.error && <Alert>{operation.error}</Alert>}
    <dl className="hub-profile-details">{customer && ([['firstName', customer.first_name], ['lastName', customer.last_name], ['phone', customer.phone_number], ['email', customer.email], ['dob', customer.date_of_birth], ['accountId', customer.id]] as const).map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd dir="ltr">{value}</dd></div>)}</dl>
    <Button onClick={() => void refresh()} disabled={operation.busy || operation.remaining > 0}>{t('refreshProfile')}</Button><div className="hub-order-history"><h2>{t('orderHistory')}</h2><p>{t('comingLater')}</p></div>
  </section>
}
