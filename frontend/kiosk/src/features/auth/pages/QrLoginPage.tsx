import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { KioskFrame } from '../../../layouts/KioskFrame'
import { useQrLogin } from '../hooks/use-qr-login'

export function QrLoginPage() {
  const { t } = useTranslation('auth')
  const { qr, status, busy, generate, waiting, expires } = useQrLogin()
  return <KioskFrame title={t('qrTitle')} back="/auth/pin"><div className="qr-page">
    <div><h1>{t('qrTitle')}</h1><p>{t('qrInstructions')}</p>
      <ol><li>{t('qrStep1')}</li><li>{t('qrStep2')}</li><li>{t('qrStep3')}</li></ol>
      <p className="qr-status" role="status">{t(`qrStates.${status}`)}</p>
      {qr && expires > 0 && <p>{t('qrExpiry', { count: expires })}</p>}
      <Button variant="primary" disabled={busy || waiting > 0 || status === 'approved'} onClick={() => void generate()}>{t(busy ? 'generating' : qr ? 'regenerate' : 'generate')}</Button>
      {waiting > 0 && <p>{t('retryIn', { count: waiting })}</p>}
    </div>
    <div className="qr-panel">{qr && expires > 0 ? <QRCodeSVG value={qr.qr_payload} size={256} marginSize={4} level="M" title={t('qrTitle')} /> : <div className="qr-placeholder" aria-hidden="true">▧</div>}</div>
  </div></KioskFrame>
}
