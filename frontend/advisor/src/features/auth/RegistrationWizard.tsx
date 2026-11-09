import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@have/shared/api';
import { registrationApi, type RegistrationDraft, type RegistrationDocumentKind, type RecordData } from '@have/shared/api/advisor';
import { useTranslation } from '@have/shared/i18n';
import { Dialog, ErrorNotice } from '../../components/ui';
import { DocumentCapture } from './DocumentCapture';
import { RegistrationIcon } from './RegistrationIcon';
import { countryOptions, registrationFields, requiredDocuments } from './registration';
import './registration.css';

const emptyDetails = () => ({ nationality: 'EG', country_of_graduation: 'EG' } as Record<string, string>);
const steps = ['details', 'account', 'documents', 'review'] as const;
const stepIcons = ['doctor', 'account', 'documents', 'review'] as const;

export function RegistrationWizard({ back }: { back: (submitted?: boolean) => void }) {
  const { t, i18n } = useTranslation('advisor');
  const [data, setData] = useState<Record<string, string>>(emptyDetails), [step, setStep] = useState(0), [draft, setDraft] = useState<RegistrationDraft | null>(null);
  const [challenge, setChallenge] = useState<RecordData | null>(null), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [welcome, setWelcome] = useState<RegistrationDraft | null>(null), [resume, setResume] = useState(false), [completed, setCompleted] = useState(false), [initializing, setInitializing] = useState(true), [actionId, setActionId] = useState(() => crypto.randomUUID());
  const active = useRef(true), locked = useRef(false), heading = useRef<HTMLHeadingElement>(null), submissionUncertain = useRef(false);
  const countries = useMemo(() => countryOptions(i18n.language), [i18n.language]);
  const required = requiredDocuments(data.nationality || 'EG');
  const documents = [...required, 'practice_license'] as RegistrationDocumentKind[];
  const present = new Set(draft?.documents.map(document => document.kind) || []);
  const documentsComplete = required.every(kind => present.has(kind));
  const unsaved = draft ? [...registrationFields, 'professional_license_number'].some(key => (data[key] || '') !== (draft.data[key] || '')) : Object.keys(data).some(key => !['nationality', 'country_of_graduation'].includes(key) && !!data[key]);

  useEffect(() => {
    active.current = true;
    const abort = new AbortController();
    void registrationApi.current(abort.signal).then(saved => {
      if (!active.current || abort.signal.aborted) return;
      if (saved.status === 'SUBMITTED') { setCompleted(true); setDraft(saved); }
      else setWelcome(saved);
    }).catch(failure => {
      if (active.current && !abort.signal.aborted && !(failure instanceof ApiError && [401, 403, 404, 410].includes(failure.status))) setError(t('registration.restoreError'));
    }).finally(() => { if (active.current && !abort.signal.aborted) setInitializing(false); });
    return () => { active.current = false; abort.abort(); };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!completed && (challenge || unsaved)) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved, challenge, completed]);

  async function run<T>(work: () => Promise<T>, success?: (result: T) => void) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setFieldErrors({});
    try { const result = await work(); if (active.current) success?.(result); }
    catch (failure) { if (active.current) {
      setError(failure instanceof ApiError ? failure.message : t('error'));
      if (failure instanceof ApiError) {
        setFieldErrors(failure.fields);
        if (registrationFields.some(key => failure.fields[key])) setStep(0);
      }
    } }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  function restore(saved: RegistrationDraft) {
    setDraft(saved); setData(saved.data); setChallenge(null); setCode(''); setWelcome(null); setResume(false); setStep(2); setCompleted(saved.status === 'SUBMITTED');
  }
  function reset() {
    setDraft(null); setWelcome(null); setData(emptyDetails()); setChallenge(null); setCode(''); setStep(0); setError(''); setFieldErrors({}); setActionId(crypto.randomUUID()); submissionUncertain.current = false;
  }
  function leave() {
    if (busy) return;
    if (completed) { void run(() => registrationApi.restart(), () => back(true)); return; }
    if (!unsaved || window.confirm(t('registration.leaveUnsaved'))) back();
  }
  const detailsPayload = () => Object.fromEntries(registrationFields.map(key => [key, data[key] || '']));
  const change = (key: string, value: string) => { setData(before => ({ ...before, [key]: value })); setFieldErrors(before => ({ ...before, [key]: '' })); };
  const input = (key: string, options: { type?: string; optional?: boolean; direction?: 'ltr' | 'rtl' | 'auto'; disabled?: boolean; autoComplete?: string; maxLength?: number } = {}) => <label className="advisor-field" key={key}>
    <span>{t(`registration.field.${key}`)}{options.optional && <small> · {t('registration.optional')}</small>}</span>
    <input name={key} type={options.type || 'text'} value={data[key] || ''} onChange={event => change(key, event.target.value)} disabled={busy || options.disabled} required={!options.optional} dir={options.direction || (key.endsWith('_ar') || key === 'name_ar' ? 'rtl' : 'ltr')} maxLength={options.maxLength || (key.includes('password') ? 128 : key.includes('address') ? 1000 : ['first_name', 'last_name'].includes(key) ? 32 : 200)} autoComplete={options.autoComplete || 'off'} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `registration-${key}-error` : undefined} />
    {fieldErrors[key] && <small className="advisor-registration-field-error" id={`registration-${key}-error`}>{fieldErrors[key]}</small>}
  </label>;
  const country = (key: string) => <label className="advisor-field"><span>{t(`registration.field.${key}`)}</span><select name={key} required value={data[key] || ''} disabled={busy} onChange={event => change(key, event.target.value)}><option value="">{t('dose.choose')}</option>{countries.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select>{fieldErrors[key] && <small className="advisor-registration-field-error">{fieldErrors[key]}</small>}</label>;
  async function advance(event: FormEvent) {
    event.preventDefault();
    if (step === 0) {
      if (draft) await run(() => registrationApi.update(detailsPayload()), saved => { setDraft(saved); setData(before => ({ ...before, ...saved.data, professional_license_number: before.professional_license_number || '' })); setStep(2); });
      else setStep(1);
    } else if (step === 1) {
      if (draft) { setStep(2); return; }
      if (!challenge) await run(() => registrationApi.start({ ...detailsPayload(), phone_number: data.phone_number, email: data.email, password: data.password }), result => { setChallenge(result); change('password', ''); });
      else await run(() => registrationApi.verify({ phone_number: data.phone_number, challenge_id: challenge.challenge_id, code }), result => {
        setCode('');
        if ('next_step' in result) setChallenge(result);
        else restore(result as RegistrationDraft);
      });
    } else if (step === 2) {
      if (!documentsComplete) { setError(t('registration.documentsMissing')); return; }
      await run(() => registrationApi.update({ professional_license_number: data.professional_license_number || '' }), saved => { setDraft(saved); setData(saved.data); setStep(3); });
    } else {
      submissionUncertain.current = true;
      await run(() => registrationApi.submit(actionId), () => { submissionUncertain.current = false; setCompleted(true); setData({}); });
    }
  }
  async function upload(kind: RegistrationDocumentKind, file: File) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { const saved = await registrationApi.upload(kind, file); if (active.current) setDraft(saved); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  async function remove(kind: RegistrationDocumentKind) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { const saved = await registrationApi.remove(kind); if (active.current) setDraft(saved); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  const savedAgo = (value: string) => {
    const hours = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 3600000));
    return new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(hours >= 24 ? -Math.floor(hours / 24) : -hours, hours >= 24 ? 'day' : 'hour');
  };
  const date = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

  return <main className="advisor-registration">
    <aside className="advisor-registration-sidebar">
      <div className="advisor-registration-brand"><span className="advisor-brand-mark">H⁺</span><div><strong>H.A.V.E</strong><span>{t('advisor')}</span></div></div>
      <div className="advisor-registration-intro"><span>{t('registration.eyebrow')}</span><h1>{t('registration.title')}</h1><p>{t('registration.introduction')}</p></div>
      <ol className="advisor-registration-steps" aria-label={t('registration.progress')}>
        {steps.map((item, index) => <li key={item} className={index === step ? 'is-current' : index < step ? 'is-complete' : ''} aria-current={!completed && index === step ? 'step' : undefined}><span className="advisor-registration-step-icon"><RegistrationIcon name={index < step ? 'check' : stepIcons[index]!} /></span><span><small>{t('registration.stepNumber', { count: index + 1 })}</small><strong>{t(`registration.step.${item}`)}</strong></span></li>)}
      </ol>
      <div className="advisor-registration-privacy"><RegistrationIcon name="shield" /><p>{t('registration.privateHelp')}</p></div>
    </aside>
    <section className="advisor-registration-workspace" aria-busy={busy || initializing}>
      <header className="advisor-registration-topline"><button type="button" onClick={leave} disabled={busy}>{t('registration.backToLogin')}</button>{draft && !completed && <span className={`advisor-registration-saved ${unsaved ? 'has-unsaved-changes' : ''}`}><RegistrationIcon name={unsaved ? 'documents' : 'check'} />{t(unsaved ? 'registration.unsavedChanges' : 'registration.savedDraft')}</span>}</header>
      {completed ? <div className="advisor-registration-complete"><span><RegistrationIcon name="check" /></span><h2>{t('registration.submittedTitle')}</h2><p>{t('registration.submittedBody')}</p><ErrorNotice message={error} /><button type="button" className="advisor-primary" disabled={busy} onClick={leave}>{t('registration.backToLogin')}</button></div> : <>
        <div className="advisor-registration-heading"><span>{t('registration.stepOf', { current: step + 1, total: 4 })}</span><h2 ref={heading} tabIndex={-1}>{t(`registration.step.${steps[step]}`)}</h2><p>{t(`registration.help.${steps[step]}`)}</p></div>
        {initializing && <p role="status">{t('loading')}</p>}
        <ErrorNotice message={error} />
        {draft && <p className="advisor-registration-expiry">{t('registration.draftExpiry', { date: date(draft.expires_at) })}</p>}
        <form className="advisor-registration-form" onSubmit={event => void advance(event)}>
          <fieldset disabled={busy || initializing}>
            {step === 0 && <>
              <div className="advisor-registration-section-heading"><RegistrationIcon name="doctor" /><h3>{t('registration.doctorIdentity')}</h3></div>
              <div className="advisor-form-grid">{input('first_name')}{input('last_name')}<div className="advisor-registration-full">{input('name_ar')}</div>{country('nationality')}{country('country_of_graduation')}<div className="advisor-registration-full">{input('medical_school', { direction: 'auto' })}<small className="advisor-registration-hint">{t('registration.schoolHelp')}</small></div></div>
              <div className="advisor-registration-section-heading"><RegistrationIcon name="documents" /><h3>{t('registration.clinicDetails')}</h3></div>
              <div className="advisor-form-grid">{input('clinic_name')}{input('clinic_name_ar')}{input('clinic_address')}{input('clinic_address_ar')}</div>
            </>}
            {step === 1 && <>
              {draft ? <div className="advisor-registration-verified"><RegistrationIcon name="check" /><p>{t('registration.contactsVerified')}</p><span dir="ltr">{data.phone_number} · {data.email}</span></div> : !challenge ? <div className="advisor-registration-account-fields">{input('phone_number', { type: 'tel', autoComplete: 'tel', maxLength: 32 })}{input('email', { type: 'email', autoComplete: 'email', maxLength: 128 })}{input('password', { type: 'password', autoComplete: 'new-password' })}<p className="advisor-registration-hint">{t('registration.passwordHelp')}</p></div> : <div className="advisor-registration-code"><span className="advisor-registration-code-icon"><RegistrationIcon name="account" /></span><h3>{t(challenge.next_step === 'email' ? 'emailCode' : 'sms')}</h3><p dir="ltr">{challenge.next_step === 'email' ? data.email : data.phone_number}</p><label className="advisor-field"><span>{t('code')}</span><input value={code} required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code" dir="ltr" onChange={event => setCode(event.target.value.replace(/\D/g, ''))} /></label><p className="advisor-registration-hint">{t('registration.verificationHelp')}</p><button type="button" disabled={busy} onClick={() => { setChallenge(null); setCode(''); setError(''); }}>{t('registration.restartVerification')}</button></div>}
            </>}
            {step === 2 && <>
              <div className="advisor-registration-document-summary"><RegistrationIcon name="shield" /><div><strong>{t('registration.documentPrivacy')}</strong><p>{t('registration.retention')}</p><small>{t('registration.imageHelp')}</small></div></div>
              <div className="advisor-document-grid">{documents.map(kind => <DocumentCapture key={kind} kind={kind} optional={kind === 'practice_license'} uploaded={draft?.documents.find(item => item.kind === kind)?.uploaded_at} busy={busy} upload={file => upload(kind, file)} remove={() => remove(kind)} />)}</div>
              <details className="advisor-registration-optional"><summary>{t('registration.licenceNumberDisclosure')}</summary><p>{t('registration.licenceNumberHelp')}</p>{input('professional_license_number', { optional: true, maxLength: 100 })}</details>
              <p className="advisor-registration-progress-count" role="status">{t('registration.documentProgress', { completed: required.filter(kind => present.has(kind)).length, total: required.length })}</p>
            </>}
            {step === 3 && <>
              <section className="advisor-registration-review"><header><h3>{t('registration.doctorIdentity')}</h3><button type="button" onClick={() => setStep(0)}>{t('registration.edit')}</button></header><dl>{registrationFields.slice(0, 3).map(key => <div key={key}><dt>{t(`registration.field.${key}`)}</dt><dd dir={key === 'name_ar' ? 'rtl' : 'ltr'}>{data[key]}</dd></div>)}{['nationality', 'country_of_graduation', 'medical_school'].map(key => <div key={key}><dt>{t(`registration.field.${key}`)}</dt><dd>{key === 'medical_school' ? data[key] : countries.find(item => item.code === data[key])?.label || data[key]}</dd></div>)}</dl></section>
              <section className="advisor-registration-review"><header><h3>{t('registration.clinicDetails')}</h3><button type="button" onClick={() => setStep(0)}>{t('registration.edit')}</button></header><dl>{['clinic_name', 'clinic_name_ar', 'clinic_address', 'clinic_address_ar'].map(key => <div key={key}><dt>{t(`registration.field.${key}`)}</dt><dd dir={key.endsWith('_ar') ? 'rtl' : 'ltr'}>{data[key]}</dd></div>)}</dl></section>
              <section className="advisor-registration-review"><header><h3>{t('registration.step.account')}</h3><span className="advisor-registration-verified-label"><RegistrationIcon name="check" />{t('registration.contactsVerified')}</span></header><dl>{['phone_number', 'email'].map(key => <div key={key}><dt>{t(`registration.field.${key}`)}</dt><dd dir="ltr">{data[key]}</dd></div>)}</dl></section>
              <section className="advisor-registration-review"><header><h3>{t('registration.step.documents')}</h3><button type="button" onClick={() => setStep(2)}>{t('registration.edit')}</button></header><div className="advisor-registration-review-docs">{documents.filter(kind => present.has(kind)).map(kind => <ReviewDocument key={kind} kind={kind} />)}</div>{data.professional_license_number && <p>{t('professional_license_number')}: <bdi>{data.professional_license_number}</bdi></p>}</section>
              <p className="advisor-registration-hint">{t('registration.finalNotice')}</p>{submissionUncertain.current && error && <p className="advisor-notice">{t('registration.retrySubmission')}</p>}
            </>}
          </fieldset>
          <footer className="advisor-registration-footer"><button type="button" disabled={busy || step === 0 || !!challenge} onClick={() => { setError(''); setStep(value => value - 1); }}>{t('back')}</button><button className="advisor-primary" disabled={busy || initializing || (step === 2 && !documentsComplete)}>{t(busy ? 'working' : step === 3 ? 'registration.submit' : step === 1 && challenge ? 'verify' : 'continue')}</button></footer>
        </form>
        {step === 0 && !draft && <button type="button" className="advisor-registration-resume-link" disabled={busy || initializing} onClick={() => setResume(true)}>{t('registration.resumeLink')}</button>}
      </>}
    </section>
    {welcome && <Dialog title={t('registration.welcomeBack')} close={() => { if (!busy) { setWelcome(null); back(); } }}><p>{t('registration.remembered', { ago: savedAgo(welcome.last_saved_at) })}</p><p className="advisor-registration-copy">{t('registration.draftExpiry', { date: date(welcome.expires_at) })}</p><ErrorNotice message={error} /><div className="advisor-registration-actions"><button type="button" disabled={busy} onClick={() => void run(() => registrationApi.restart(), reset)}>{t('registration.startOver')}</button><button type="button" className="advisor-primary" disabled={busy} onClick={() => restore(welcome)}>{t('registration.continueApplication')}</button></div></Dialog>}
    {resume && <ResumeDialog busy={busy} error={error} close={() => { if (!busy) setResume(false); }} submit={(phone_number, password) => void run(() => registrationApi.resume({ phone_number, password }), saved => { setResume(false); if (saved.status === 'SUBMITTED') restore(saved); else setWelcome(saved); })} />}
  </main>;
}

function ResumeDialog({ busy, error, close, submit }: { busy: boolean; error: string; close: () => void; submit: (phone: string, password: string) => void }) {
  const { t } = useTranslation('advisor');
  const [phone, setPhone] = useState(''), [password, setPassword] = useState('');
  return <Dialog title={t('registration.resumeTitle')} close={close}><p className="advisor-registration-copy">{t('registration.resumeHelp')}</p><form onSubmit={event => { event.preventDefault(); submit(phone, password); }}><label className="advisor-field"><span>{t('phone_number')}</span><input type="tel" required dir="ltr" autoComplete="tel" value={phone} disabled={busy} onChange={event => setPhone(event.target.value)} /></label><label className="advisor-field"><span>{t('password')}</span><input type="password" required dir="ltr" autoComplete="current-password" maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label><ErrorNotice message={error} /><button className="advisor-primary" disabled={busy}>{t(busy ? 'working' : 'registration.resumeTitle')}</button></form></Dialog>;
}

function ReviewDocument({ kind }: { kind: RegistrationDocumentKind }) {
  const { t } = useTranslation('advisor');
  const [url, setUrl] = useState(''), [expanded, setExpanded] = useState(false), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = ''; setFailed(false);
    void registrationApi.image(kind, controller.signal).then(blob => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [kind, retry]);
  return <><button className="advisor-registration-review-image" type="button" onClick={() => failed ? setRetry(value => value + 1) : setExpanded(true)} disabled={!url && !failed}>{url ? <img src={url} alt="" /> : <RegistrationIcon name="documents" />}<span>{t(`registration.document.${kind}`)}</span>{failed && <small>{t('registration.previewError')} · {t('retry')}</small>}</button>{expanded && <Dialog title={t(`registration.document.${kind}`)} close={() => setExpanded(false)}><img className="advisor-registration-expanded-image" src={url} alt={t(`registration.document.${kind}`)} /></Dialog>}</>;
}
