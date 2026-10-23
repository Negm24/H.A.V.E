import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@have/shared/i18n'
import { Button } from '@have/shared/ui/controls'
import { useSession } from '../../session/hooks/use-session'
import { CatalogueModal } from '@have/shared/ui/catalogue'
import { terminalApi, type GuidanceResult } from '@have/shared/api/terminal'
import { ApiError } from '@have/shared/api'
import { SymptomCard } from './SymptomCard'
import { answered, copy, emergency, prune, questions, selectAnswer, type Answers } from '../assessment'
import { useCatalogue } from '../../catalogue/hooks/use-catalogue'
import type { GuideProduct } from '../coverage'
import '../styles/symptoms.css'

export function SymptomsModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation('symptoms')
  const { controller } = useSession()
  const catalogue = useCatalogue()
  const [catalogueSnapshot, setCatalogueSnapshot] = useState<readonly GuideProduct[] | null>(() => catalogue.ready ? catalogue.products : null)
  useEffect(() => { if (catalogueSnapshot === null && catalogue.ready) setCatalogueSnapshot(catalogue.products) }, [catalogueSnapshot, catalogue.ready, catalogue.products])
  const { t: sessionText } = useTranslation('session')
  const [consent, setConsent] = useState(false)
  const [result, setResult] = useState<GuidanceResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [routing, setRouting] = useState(false)
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
      if (!request.signal.aborted) setError(cause instanceof ApiError && cause.status === 400 ? 'ai_answers_changed' : cause instanceof ApiError && cause.status === 429 ? 'ai_limited' : 'ai_unavailable')
    } finally {
      if (!request.signal.aborted) { pending.current = null; setBusy(false) }
    }
  }
  const [answers, setAnswers] = useState<Answers>({})
  const [currentId, setCurrentId] = useState('areas')
  const [trail, setTrail] = useState(['areas'])
  const [review, setReview] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reviewPage, setReviewPage] = useState(0)
  const list = questions(answers, catalogueSnapshot ?? [])
  const supported = list[0]!.options.length > 0
  const index = Math.max(0, list.findIndex(item => item.id === currentId))
  const question = list[index]
  const stop = emergency(answers)
  const completeCount = list.filter(item => answered(item, answers)).length
  const numbers = new Intl.NumberFormat(i18n.language)
  const incomplete = Object.values(answers).some(values => values.includes('unknown'))
  const reviewSize = incomplete ? 1 : 2
  const pages = Math.ceil(list.length / reviewSize)
  const page = Math.min(reviewPage, pages - 1)
  const next = async () => {
    if (!answered(question, answers) || pending.current) return
    const request = new AbortController()
    pending.current = request; setBusy(true); setRouting(true); setError('')
    try {
      const value = await controller.request((token, signal) => terminalApi.guidanceNext(token, answers, AbortSignal.any([signal, request.signal])))
      if (request.signal.aborted) return
      if (value.question_id === null) {
        if (list.some(item => !answered(item, answers))) throw new Error('Incomplete questionnaire')
        setEditing(false); setReviewPage(0); setReview(true)
      } else {
        const target = list.find(item => item.id === value.question_id && !answered(item, answers))
        if (!target) throw new Error('Invalid next question')
        setCurrentId(target.id); setTrail(current => [...current, target.id])
      }
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof ApiError && cause.status === 400 ? 'ai_answers_changed' : cause instanceof ApiError && cause.status === 409 ? 'guide_stock_changed' : 'ai_next_error')
    } finally {
      if (!request.signal.aborted) { pending.current = null; setBusy(false); setRouting(false) }
    }
  }
  const back = () => {
    if (editing) { setEditing(false); const missing = list.find(item => !answered(item, answers)); if (missing) setCurrentId(missing.id); else setReview(true) }
    else if (trail.length > 1) { setCurrentId(trail[trail.length - 2]!); setTrail(current => current.slice(0, -1)) }
    else onClose()
  }
  const heading = !consent ? t('ai_intro_title') : result ? t('ai_result_title') : busy ? t(routing ? 'ai_next_loading' : 'ai_loading') : stop ? t(copy.emergencyTitle) : review ? t(copy.review) : t(question.title)
  return <CatalogueModal title={heading} className="symptom-modal" close={onClose} wide>
    <div className="symptom-modal-toolbar"><span>{consent && !result && !busy && !stop && !review && `${t(copy.step)} ${numbers.format(Math.min(completeCount + 1, list.length))} / ${numbers.format(list.length)}`}</span><Button variant="danger" onClick={() => controller.reset()}>{sessionText('startOver')}</Button></div>
    {!consent ? <div className="symptom-flow"><p>{t('ai_intro')}</p><p>{t('ai_privacy')}</p>{!supported && <p role="status">{t(catalogueSnapshot === null ? 'guide_loading' : 'guide_no_supported')}</p>}<Button variant="primary" disabled={!supported} onClick={() => setConsent(true)}>{t('ai_begin')}</Button></div> : busy ? <div role="status" className="symptom-flow"><p>{t(routing ? 'ai_next_loading' : 'ai_loading')}</p></div> : result ? <div className="symptom-flow">
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
          <Button aria-label={`${t(copy.edit)}: ${t(item.title)}`} onClick={() => { setCurrentId(item.id); setTrail([item.id]); setReview(false); setEditing(true); setError('') }}>{t(copy.edit)}</Button>
        </div>)}</dl>
        <div className="symptom-actions"><Button disabled={page === 0} onClick={() => setReviewPage(page - 1)}>{t('previous_page')}</Button><span>{t('page', { current: numbers.format(page + 1), total: numbers.format(pages) })}</span><Button disabled={page === pages - 1} onClick={() => setReviewPage(page + 1)}>{t('next_page')}</Button><Button variant="primary" onClick={() => void recommend()}>{t('ai_submit')}</Button></div>
      </> : <>
        {error && <p role="alert">{t(error)}</p>}
        <div role="group" aria-label={t(question.title)} className={`symptom-grid${question.id === 'areas' ? ' areas' : ''}`}>
          {question.options.map((option, optionIndex) => <SymptomCard key={option.id} label={t(option.label)} icon={question.id === 'areas' ? ['◉', '◒', '◓', '◐', '◑', '⌾', '◉', '?'][optionIndex] : undefined} selected={answers[question.id]?.includes(option.id) ?? false} onSelect={() => setAnswers(current => selectAnswer(current, question, option.id))} />)}
        </div>
        <div className="symptom-actions"><Button onClick={back}>{t('previous')}</Button><Button variant="primary" disabled={!answered(question, answers)} onClick={() => void next()}>{!answered(question, answers) ? t(copy.choose) : editing ? t(copy.save) : completeCount === list.length ? t(copy.review) : t(copy.next)}</Button></div>
        <div className="symptom-progress" aria-hidden="true"><div style={{ width: `${(completeCount / list.length) * 100}%` }} /></div>
      </>}
    </div>}
  </CatalogueModal>
}
