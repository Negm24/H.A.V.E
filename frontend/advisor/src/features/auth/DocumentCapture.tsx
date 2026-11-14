import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@have/shared/i18n';
import { registrationApi, type RegistrationDocumentKind } from '@have/shared/api/advisor';
import { ApiError } from '@have/shared/api';
import { Dialog } from '../../components/ui';
import { RegistrationIcon } from './RegistrationIcon';
import { validateDocument } from './registration';

export function DocumentCapture({ kind, uploaded, optional, busy, upload, remove }: {
  kind: RegistrationDocumentKind; uploaded?: string; optional?: boolean; busy: boolean;
  upload: (file: File) => Promise<void>; remove: () => Promise<void>;
}) {
  const { t } = useTranslation('advisor');
  const input = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<'inspect' | 'capture' | null>(null), [preview, setPreview] = useState(''), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let url = '';
    const controller = new AbortController();
    setPreview(''); setError('');
    if (uploaded) void registrationApi.image(kind, controller.signal).then(blob => {
      if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setPreview(url); }
    }).catch(() => { if (!controller.signal.aborted) setError(t('registration.previewError')); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [kind, uploaded, retry, t]);
  const choose = async (file: File) => {
    const invalid = validateDocument(file);
    if (invalid) { setError(t(`registration.${invalid}`)); return; }
    setError('');
    try { await upload(file); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : t('error')); }
  };
  return <article className={`advisor-document-card ${uploaded ? 'is-uploaded' : ''}`}>
    <div className="advisor-document-heading"><span className="advisor-registration-icon"><RegistrationIcon name={uploaded ? 'check' : 'documents'} /></span><div><h3>{t(`registration.document.${kind}`)}</h3><span>{t(optional ? 'registration.optional' : uploaded ? 'registration.uploaded' : 'registration.required')}</span></div></div>
    {preview ? <button type="button" className="advisor-document-preview" aria-label={t('registration.inspectDocument', { document: t(`registration.document.${kind}`) })} onClick={() => setCamera('inspect')} disabled={busy}><img src={preview} alt={t(`registration.document.${kind}`)} /></button> : <div className="advisor-document-placeholder" aria-hidden="true"><RegistrationIcon name="documents" /><span>{t(`registration.documentHint.${kind}`)}</span></div>}
    <div className="advisor-document-actions">
      <button type="button" disabled={busy} onClick={() => setCamera('capture')}><RegistrationIcon name="camera" />{t(uploaded ? 'registration.retake' : 'registration.takePhoto')}</button>
      <button type="button" disabled={busy} onClick={() => input.current?.click()}><RegistrationIcon name="upload" />{t(uploaded ? 'registration.replace' : 'registration.uploadImage')}</button>
      {uploaded && <button type="button" className="advisor-document-remove" disabled={busy} onClick={() => { setError(''); void remove().catch(() => setError(t('error'))); }}>{t('remove')}</button>}
    </div>
    <input ref={input} className="advisor-registration-file" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-label={t('registration.uploadFor', { document: t(`registration.document.${kind}`) })} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void choose(file); }} />
    {error && <div className="advisor-error" role="alert">{error}{uploaded && !preview && <button type="button" onClick={() => setRetry(value => value + 1)}>{t('retry')}</button>}</div>}
    {camera && <CaptureDialog kind={kind} storedPreview={camera === 'inspect' ? preview : ''} close={() => setCamera(null)} save={async file => { const invalid = validateDocument(file); if (invalid) throw new Error(t(`registration.${invalid}`)); await upload(file); setCamera(null); }} />}
  </article>;
}

function CaptureDialog({ kind, storedPreview, close, save }: { kind: RegistrationDocumentKind; storedPreview: string; close: () => void; save: (file: File) => Promise<void> }) {
  const { t } = useTranslation('advisor');
  const video = useRef<HTMLVideoElement>(null), media = useRef<MediaStream | null>(null), active = useRef(true);
  const [ready, setReady] = useState(false), [captured, setCaptured] = useState<File | null>(null), [url, setUrl] = useState(storedPreview), [error, setError] = useState(''), [busy, setBusy] = useState(false), [cameraStarted, setCameraStarted] = useState(!storedPreview);
  const fileInput = useRef<HTMLInputElement>(null);
  const stop = () => { media.current?.getTracks().forEach(track => track.stop()); media.current = null; };
  useEffect(() => { active.current = true; return () => { active.current = false; stop(); }; }, []);
  useEffect(() => {
    if (!cameraStarted || captured) return;
    let canceled = false;
    setReady(false); setError('');
    if (!navigator.mediaDevices?.getUserMedia) { setError(t('registration.cameraUnavailable')); return; }
    void navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } }).then(stream => {
      if (canceled) { stream.getTracks().forEach(track => track.stop()); return; }
      media.current = stream;
      if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => setError(t('registration.cameraUnavailable'))); }
    }).catch(() => { if (!canceled) setError(t('registration.cameraUnavailable')); });
    return () => { canceled = true; stop(); };
  }, [cameraStarted, captured, t]);
  useEffect(() => {
    if (!captured) return;
    const objectUrl = URL.createObjectURL(captured); setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [captured]);
  const takePhoto = () => {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight) return;
    const canvas = document.createElement('canvas'); canvas.width = source.videoWidth; canvas.height = source.videoHeight;
    const graphics = canvas.getContext('2d');
    if (!graphics) { setError(t('error')); return; }
    graphics.drawImage(source, 0, 0);
    canvas.toBlob(blob => { if (blob && active.current) { stop(); setCaptured(new File([blob], `${kind}.jpg`, { type: 'image/jpeg' })); } }, 'image/jpeg', .94);
  };
  const useImage = () => {
    if (!captured || busy) return;
    setBusy(true); setError('');
    void save(captured).catch(failure => { if (active.current) setError(failure instanceof Error ? failure.message : t('error')); }).finally(() => { if (active.current) setBusy(false); });
  };
  const viewing = !cameraStarted || !!captured;
  return <Dialog title={t(`registration.document.${kind}`)} close={() => { if (!busy) close(); }}>
    <p className="advisor-registration-copy">{t('registration.captureHelp')}</p>
    <div className={`advisor-capture-stage ${kind === 'graduation' || kind === 'practice_license' ? 'is-paper' : ''}`}>
      {viewing && url ? <img src={url} alt={t(`registration.document.${kind}`)} /> : <><video ref={video} autoPlay muted playsInline onLoadedData={() => setReady(true)} /><div className="advisor-capture-guide" aria-hidden="true"><div className="advisor-capture-sample"><i /><span /><span /><span /></div><b /><b /><b /><b /></div></>}
    </div>
    <p className="advisor-registration-copy">{t(`registration.documentHint.${kind}`)}</p>
    {error && <p className="advisor-error" role="alert">{error}</p>}
    <div className="advisor-registration-actions">
      {viewing ? <><button type="button" disabled={busy} onClick={() => { setCaptured(null); setUrl(''); setCameraStarted(true); }}>{t('registration.retake')}</button>{captured ? <button type="button" className="advisor-primary" disabled={busy} onClick={useImage}>{t(busy ? 'working' : 'registration.usePhoto')}</button> : <button type="button" onClick={close}>{t('close')}</button>}</> : <><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>{t('registration.uploadInstead')}</button><button type="button" className="advisor-primary" disabled={!ready || !!error || busy} onClick={takePhoto}><RegistrationIcon name="camera" />{t('registration.capture')}</button></>}
    </div>
    <input ref={fileInput} className="advisor-registration-file" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-label={t('registration.uploadImage')} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return; const invalid = validateDocument(file); if (invalid) setError(t(`registration.${invalid}`)); else { stop(); setCaptured(file); setError(''); } }} />
  </Dialog>;
}
