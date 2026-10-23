import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { useSession } from '../../session/hooks/use-session'
import { CatalogueModal } from '@have/shared/ui/catalogue'
import { terminalApi, type GuidanceResult } from '@have/shared/api/terminal'
import { ApiError } from '@have/shared/api'
import { SymptomCard } from './SymptomCard'
import { answered, copy, emergency, prune, questions, selectAnswer, type Answers } from '../assessment'
import '../styles/symptoms.css'

export function SymptomsModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation('symptoms')
  const { controller } = useSession()
  const { t: sessionText } = useTranslation('session')
  const [consent, setConsent] = useState(false)
  const [result, setResult] = useState<GuidanceResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => { pending.current?.abort() }, [])
  const recommend = async () => {
    if (pending.current) return
    const request = new AbortController()
    pending.current = request; setBusy(true); setError('')
    try {
      const value = await controller.request((token, signal) => terminalApi.guidance(token, answers, AbortSignal.any([signal, request.signal])))
      if (!request.signal.aborted) setResult(value)
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof ApiError && cause.status === 429 ? 'ai_limited' : 'ai_unavailable')
    } finally {
      if (!request.signal.aborted) { pending.current = null; setBusy(false) }
    }
  }
  const [answers, setAnswers] = useState<Answers>({})
  const [currentId, setCurrentId] = useState('areas')
  const [review, setReview] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reviewPage, setReviewPage] = useState(0)
  const list = questions(answers)
  const index = Math.max(0, list.findIndex(item => item.id === currentId))
  const question = list[index]
  const stop = emergency(answers)
  const numbers = new Intl.NumberFormat(i18n.language)
  const incomplete = Object.values(answers).some(values => values.includes('unknown'))
  const reviewSize = incomplete ? 1 : 2
  const pages = Math.ceil(list.length / reviewSize)
  const page = Math.min(reviewPage, pages - 1)
  const next = () => {
    if (!answered(question, answers)) return
    if (editing || index === list.length - 1) {
      const missing = list.find(item => !answered(item, answers))
      if (missing) { setEditing(true); setCurrentId(missing.id) }
      else { setEditing(false); setReviewPage(0); setReview(true) }
    } else setCurrentId(list[index + 1].id)
  }
  const back = () => {
    if (editing) { setEditing(false); const missing = list.find(item => !answered(item, answers)); if (missing) setCurrentId(missing.id); else setReview(true) }
    else if (index > 0) setCurrentId(list[index - 1].id)
    else onClose()
  }
  const heading = !consent ? t('ai_intro_title') : result ? t('ai_result_title') : busy ? t('ai_loading') : stop ? t(copy.emergencyTitle) : review ? t(copy.review) : t(question.title)
  return <CatalogueModal title={heading} className="symptom-modal" close={onClose} wide>
    <div className="symptom-modal-toolbar"><span>{consent && !result && !busy && !stop && !review && `${t(copy.step)} ${numbers.format(index + 1)} / ${numbers.format(list.length)}`}</span><Button variant="danger" onClick={() => controller.reset()}>{sessionText('startOver')}</Button></div>
    {!consent ? <div className="symptom-flow"><p>{t('ai_intro')}</p><p>{t('ai_privacy')}</p><Button variant="primary" onClick={() => setConsent(true)}>{t('ai_begin')}</Button></div> : busy ? <div role="status" className="symptom-flow"><p>{t('ai_loading')}</p></div> : result ? <div className="symptom-flow">
      <div className="symptom-result" role="status"><h3>{t(result.status === 'needs_advice' ? 'ai_no_match' : `ai_${result.status}`)}</h3>
        {result.product && <><h3>{i18n.language === 'ar' ? result.product.name_ar : result.product.name_en}</h3><p><bdi>{result.product.active_ingredient} · {result.product.strength}</bdi></p><p>{result.product.pack_description}</p><p>{t('ai_stock', { count: result.product.stock_quantity })}</p><p>{t('ai_reason')}</p></>}
      </div>
      <div className="symptom-actions"><Button onClick={() => setResult(null)}>{t('ai_back')}</Button><Button onClick={onClose}>{t('close_guide')}</Button></div>
    </div> : <div className="symptom-flow">
      <div><p className="symptom-intro">{stop ? t(copy.emergencyBody) : review ? t(copy.reviewBody) : t(question.hint ?? (question.kind === 'multi' ? copy.multi : copy.single))}</p></div>
      {stop ? <>
        <div role="alert" className="symptom-urgent"><strong>{t(copy.matched)}</strong><ul>{stop.labels.map(label => <li key={label}>{t(label)}</li>)}</ul></div>
        <Button onClick={() => { const cleared = { ...answers }; delete cleared[stop.question.id]; setAnswers(prune(cleared)); setCurrentId(stop.question.id); setReview(false) }}>{t(copy.correct)}</Button>
        <p className="symptom-note">{t(copy.limits)}</p>
      </> : review ? <>
        <div className="symptom-notice">{error ? <span role="alert">{t(error)}</span> : t('ai_submit_notice')}{incomplete && <p>{t(copy.incomplete)}</p>}</div>
        <dl className={`symptom-review${incomplete ? ' incomplete' : ''}`}>{list.slice(page * reviewSize, page * reviewSize + reviewSize).map(item => <div key={item.id}>
          <dt>{t(item.title)}</dt><dd>{(answers[item.id] ?? []).map(value => t(item.options.find(option => option.id === value)!.label)).join(i18n.dir() === 'rtl' ? '، ' : ', ')}</dd>
          <Button aria-label={`${t(copy.edit)}: ${t(item.title)}`} onClick={() => { setCurrentId(item.id); setReview(false); setEditing(true) }}>{t(copy.edit)}</Button>
        </div>)}</dl>
        <div className="symptom-actions"><Button disabled={page === 0} onClick={() => setReviewPage(page - 1)}>{t('previous_page')}</Button><span>{t('page', { current: numbers.format(page + 1), total: numbers.format(pages) })}</span><Button disabled={page === pages - 1} onClick={() => setReviewPage(page + 1)}>{t('next_page')}</Button><Button variant="primary" onClick={() => void recommend()}>{t('ai_submit')}</Button></div>
      </> : <>
        <div role="group" aria-label={t(question.title)} className={`symptom-grid${question.id === 'areas' ? ' areas' : ''}`}>
          {question.options.map((option, optionIndex) => <SymptomCard key={option.id} label={t(option.label)} icon={question.id === 'areas' ? ['◉', '◒', '◓', '◐', '◑', '⌾', '◉', '?'][optionIndex] : undefined} selected={answers[question.id]?.includes(option.id) ?? false} onSelect={() => setAnswers(current => selectAnswer(current, question, option.id))} />)}
        </div>
        <div className="symptom-actions"><Button onClick={back}>{t('previous')}</Button><Button variant="primary" disabled={!answered(question, answers)} onClick={next}>{!answered(question, answers) ? t(copy.choose) : editing ? t(copy.save) : index === list.length - 1 ? t(copy.review) : t(copy.next)}</Button></div>
        <div className="symptom-progress" aria-hidden="true"><div style={{ width: `${((index + 1) / list.length) * 100}%` }} /></div>
      </>}
    </div>}
  </CatalogueModal>
}
