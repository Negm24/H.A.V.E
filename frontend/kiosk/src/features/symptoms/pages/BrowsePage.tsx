import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { useState } from 'react'
import { SymptomsModal } from '../components/SymptomsModal'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useSession } from '../../session/hooks/use-session'

export function BrowsePage() {
  const { t } = useTranslation('symptoms')
  const { state } = useSession()
  const [open, setOpen] = useState(false)
  return <KioskFrame title={t('browse_title')} back={state.phase === 'customer' ? '/dashboard' : '/guest'}>
    <h1>{t('browse_title')}</h1>
    <p className="page-intro">{t('browse_pending')}</p>
    <Button variant="primary" onClick={() => setOpen(true)}>{t('need_help')}</Button>
    {open && <SymptomsModal onClose={() => setOpen(false)} />}
  </KioskFrame>
}
