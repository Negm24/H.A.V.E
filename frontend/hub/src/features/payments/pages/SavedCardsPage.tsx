import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { hubPurchaseApi, type SavedCard } from '@have/shared/api/purchase'
import { useTranslation } from '@have/shared/i18n'
import { Alert, Button } from '@have/shared/ui/controls'
import { useSession } from '../../../app/providers'
import '../../orders/styles/orders.css'

export function SavedCardsPage() {
  const { t } = useTranslation('hubPurchase'), { session } = useSession(), [cards, setCards] = useState<SavedCard[]>([]), [failed, setFailed] = useState(false), [loading, setLoading] = useState(true), [attempt, retry] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setFailed(false)
    void session.authorized(token => hubPurchaseApi.cards(token, controller.signal), true)
      .then(result => { if (!controller.signal.aborted) setCards(result.cards) }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [session, attempt])
  return <section className="hub-saved-cards"><Link to="/profile">← {t('profile')}</Link><h1>{t('savedCards')}</h1><p className="hub-test-banner">{t('testMode')}</p><p>{t('savedCardsInfo')}</p>
    {failed && <Alert>{t('unavailable')} <Button onClick={() => retry(value => value + 1)}>{t('refresh')}</Button></Alert>}
    {loading ? <p role="status">{t('loading')}</p> : !failed && !cards.length ? <p className="hub-muted">{t('noCards')}</p> : <div className="hub-saved-card-list">{cards.map((card, index) => <article key={index}><span aria-hidden="true">▣</span><strong>{card.brand}</strong><bdi>•••• {card.last_four}</bdi><small>{t('cardExpiry')}: <bdi>{String(card.expiry_month).padStart(2, '0')}/{card.expiry_year}</bdi></small></article>)}</div>}
    <Link className="hub-qr-action" to="/browse">{t('browseMedicines')} →</Link>
  </section>
}
