import { useState } from 'react'
import { useTranslation } from '@have/shared/i18n'
import { Button, Dialog } from '@have/shared/ui/controls'
import { useSession } from '../../session/hooks/use-session'
import { SymptomCard } from './SymptomCard'
import { answered, copy, emergency, prune, questions, selectAnswer, type Answers } from '../assessment'
import '../styles/symptoms.css'

export function SymptomsModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation('symptoms')
  const { controller, state } = useSession()
  const { t: sessionText } = useTranslation('session')
  const warning = state.remaining > 0 && state.remaining <= 30
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
  const heading = stop ? t(copy.emergencyTitle) : review ? t(copy.review) : t(question.title)
  return <Dialog title={heading} role="dialog" className="symptom-modal" backdropClassName="symptom-modal-backdrop" onClose={onClose} inert={warning}>
    <div className="symptom-modal-toolbar"><span>{!stop && !review && `${t(copy.step)} ${numbers.format(index + 1)} / ${numbers.format(list.length)}`}</span><Button onClick={onClose}>{t('close_guide')}</Button><Button variant="danger" onClick={() => controller.reset()}>{sessionText('startOver')}</Button></div>
    <div className="symptom-flow">
      <div><p className="symptom-intro">{stop ? t(copy.emergencyBody) : review ? t(copy.reviewBody) : t(question.hint ?? (question.kind === 'multi' ? copy.multi : copy.single))}</p></div>
      {stop ? <>
        <div role="alert" className="symptom-urgent"><strong>{t(copy.matched)}</strong><ul>{stop.labels.map(label => <li key={label}>{t(label)}</li>)}</ul></div>
        <Button onClick={() => { const cleared = { ...answers }; delete cleared[stop.question.id]; setAnswers(prune(cleared)); setCurrentId(stop.question.id); setReview(false) }}>{t(copy.correct)}</Button>
        <p className="symptom-note">{t(copy.limits)}</p>
      </> : review ? <>
        <div className="symptom-notice">{t(copy.reviewCaution)}{incomplete && <p>{t(copy.incomplete)}</p>}</div>
        <dl className={`symptom-review${incomplete ? ' incomplete' : ''}`}>{list.slice(page * reviewSize, page * reviewSize + reviewSize).map(item => <div key={item.id}>
          <dt>{t(item.title)}</dt><dd>{(answers[item.id] ?? []).map(value => t(item.options.find(option => option.id === value)!.label)).join(i18n.dir() === 'rtl' ? '، ' : ', ')}</dd>
          <Button aria-label={`${t(copy.edit)}: ${t(item.title)}`} onClick={() => { setCurrentId(item.id); setReview(false); setEditing(true) }}>{t(copy.edit)}</Button>
        </div>)}</dl>
        <div className="symptom-actions"><Button disabled={page === 0} onClick={() => setReviewPage(page - 1)}>{t('previous_page')}</Button><span>{t('page', { current: numbers.format(page + 1), total: numbers.format(pages) })}</span><Button disabled={page === pages - 1} onClick={() => setReviewPage(page + 1)}>{t('next_page')}</Button><Button variant="primary" onClick={onClose}>{t('close_guide')}</Button></div>
      </> : <>
        <div role="group" aria-label={t(question.title)} className={`symptom-grid${question.id === 'areas' ? ' areas' : ''}`}>
          {question.options.map((option, optionIndex) => <SymptomCard key={option.id} label={t(option.label)} icon={question.id === 'areas' ? ['◉', '◒', '◓', '◐', '◑', '⌾', '◉', '?'][optionIndex] : undefined} selected={answers[question.id]?.includes(option.id) ?? false} onSelect={() => setAnswers(current => selectAnswer(current, question, option.id))} />)}
        </div>
        <div className="symptom-actions"><Button onClick={back}>{t('previous')}</Button><Button variant="primary" disabled={!answered(question, answers)} onClick={next}>{!answered(question, answers) ? t(copy.choose) : editing ? t(copy.save) : index === list.length - 1 ? t(copy.review) : t(copy.next)}</Button></div>
        <div className="symptom-progress" aria-hidden="true"><div style={{ width: `${((index + 1) / list.length) * 100}%` }} /></div>
      </>}
    </div>
  </Dialog>
}
