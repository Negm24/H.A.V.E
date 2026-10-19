import { useTranslation } from '@have/shared/i18n'
import { checkoutSecondsRemaining } from '../services/payment-status'

export function CheckoutDeadline({ expiresAt, now }: { expiresAt: string | null; now: number }) {
  const { t } = useTranslation('hubPurchase'), remaining = checkoutSecondsRemaining(expiresAt, now)
  return <p className="hub-checkout-deadline">{remaining > 0 ? t('checkoutRemaining', { minutes: Math.floor(remaining / 60), seconds: String(remaining % 60).padStart(2, '0') }) : t('checkoutWindowEnded')}</p>
}
