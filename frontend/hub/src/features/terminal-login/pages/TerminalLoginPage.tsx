import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { customerApi, type QrStatus } from '@have/shared/api/customer'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { useSession } from '../../../app/providers'
import { useOperation, useCountdown } from '../../auth/hooks/useOperation'
import { useCamera } from '../hooks/useCamera'

export function TerminalLoginPage() {
  const { t, i18n } = useTranslation('hub'), { session } = useSession(), operation = useOperation()
  const [challenge, setChallenge] = useState<QrStatus | null>(null), [deadline, setDeadline] = useState(0), [pollError, setPollError] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [visible, setVisible] = useState(!document.hidden)
  const remaining = useCountdown(deadline), pollDelay = useCountdown(retryAt)
  const valid = remaining > 0, delayed = pollDelay > 0
  useEffect(() => { const update = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update) }, [])
  const adopt = (result: QrStatus) => { setChallenge(result); setDeadline(Date.now() + result.expires_in * 1000); setPollError(false) }
  const camera = useCamera(payload => {
    if (!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/i.test(payload) || payload.length > 150) { setPollError(true); return }
    void operation.run(signal => session.authorized(token => customerApi.scanQr(token, payload, signal)), adopt)
  })
  useEffect(() => {
    if (!challenge || !['waiting_for_confirmation', 'approved'].includes(challenge.status) || !valid || delayed || !visible || operation.busy) return
    const controller = new AbortController(); let cancelled = false
    const timer = setTimeout(async () => {
      if (document.hidden || operation.busy) return
      try { const result = await session.authorized(token => customerApi.qrStatus(token, challenge.challenge_id, controller.signal), true); if (!cancelled) adopt(result) }
      catch (failure) {
        if (cancelled) return
        const retry = failure && typeof failure === 'object' && 'retryAfter' in failure ? Number(failure.retryAfter) : 0
        setPollError(true); setRetryAt(Date.now() + Math.max(2, retry || 2) * 1000)
      }
    }, 2000)
    return () => { cancelled = true; clearTimeout(timer); controller.abort() }
  }, [challenge, valid, delayed, visible, operation.busy, session])
  // Countdown changes every second: do not use it to recreate a two-second poll.
  const status = challenge?.status
  return <section className="hub-terminal-page"><Link to="/dashboard">← {t('backHome')}</Link><h1>{t('terminalLogin')}</h1><p>{t('scanDescription')}</p>
    {operation.error && <Alert>{operation.error}</Alert>}{camera.error && <Alert>{t(camera.error)}</Alert>}{pollError && <Alert>{t('qrProblem')}</Alert>}
    {!challenge ? <><div className="hub-camera"><video ref={camera.video} muted playsInline aria-label={t('scanner')} />{!camera.active && <span aria-hidden="true">▦</span>}</div><Button variant="primary" disabled={operation.busy || operation.remaining > 0} onClick={() => void camera.start()}>{camera.active ? t('restartCamera') : t('startCamera')}</Button>{camera.active && <Button onClick={camera.stop}>{t('stopCamera')}</Button>}</> : <div className="hub-terminal-review">
      {challenge.terminal && <dl><div><dt>{t('terminal')}</dt><dd>{challenge.terminal.display_name}</dd></div><div><dt>{t('serial')}</dt><dd dir="ltr">{challenge.terminal.serial_number}</dd></div><div><dt>{t('address')}</dt><dd>{i18n.language === 'ar' ? challenge.terminal.address_ar : challenge.terminal.address_en}</dd></div></dl>}
      <p className={status === 'completed' ? 'hub-success' : ''} role="status">{remaining || status === 'completed' || status === 'rejected' ? t(`qrStatus.${status}`) : t('expired')}</p>
      {status === 'waiting_for_confirmation' && remaining > 0 && <><p>{t('approveWarning')}</p><div className="hub-form-row"><Button variant="primary" disabled={operation.busy || operation.remaining > 0} onClick={() => void operation.run(signal => session.authorized(token => customerApi.confirmQr(token, challenge.challenge_id, true, signal)), adopt)}>{t('approve')}</Button><Button disabled={operation.busy || operation.remaining > 0} onClick={() => void operation.run(signal => session.authorized(token => customerApi.confirmQr(token, challenge.challenge_id, false, signal)), adopt)}>{t('reject')}</Button></div></>}
      {status !== 'completed' && status !== 'rejected' && <p className="hub-muted">{t('expires', { seconds: remaining })}</p>}
      <Button disabled={operation.busy} onClick={() => { setChallenge(null); setDeadline(0); setPollError(false); operation.clear() }}>{t('scanAnother')}</Button>
    </div>}
  </section>
}
