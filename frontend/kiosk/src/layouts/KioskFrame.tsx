import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from '@have/shared/i18n'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Dialog } from '@have/shared/ui/controls'
import { useSession } from '../features/session/hooks/use-session'

export function KioskFrame({ title, back, children }: { title: string; back?: string; children: ReactNode }) {
  const { t } = useTranslation('session')
  const { controller, state } = useSession()
  const navigate = useNavigate()
  const warning = state.remaining > 0 && state.remaining <= 30 && (state.phase === 'guest' || state.phase === 'customer')
  const continueButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (warning) continueButton.current?.focus() }, [warning])
  const waiting = Math.max(0, Math.ceil((state.retryUntil - Date.now()) / 1000))
  return <main className="terminal-frame" onPointerDown={() => controller.interact()} onKeyDown={() => controller.interact()}>
    <header className="terminal-header">
      {back && <Button onClick={() => { controller.clearError(); navigate(back) }}>{t('back')}</Button>}
      <span className="brand-mark" aria-hidden="true">℞</span><span>{title}</span>
      <span className="terminal-brand">H.A.V.E Terminal</span>
    </header>
    <section className="terminal-content">
      {state.error && <Alert>{t(`errors.${state.error}`)}{waiting > 0 && <> {t('retryIn', { count: waiting })}</>}</Alert>}
      {children}
    </section>
    <footer className="terminal-footer"><span>{t('footer')}</span>
      <Button variant="danger" onClick={() => controller.reset()}>{t('startOver')}</Button>
    </footer>
    {warning && <Dialog title={t('warningTitle')}><p>{t('warningBody')}</p>
      <Button ref={continueButton} variant="primary" disabled={state.busy} onClick={() => void controller.continueSession()}>{t('continue')}</Button>
      <Button onClick={() => controller.reset()}>{t('end')}</Button>
    </Dialog>}
  </main>
}
