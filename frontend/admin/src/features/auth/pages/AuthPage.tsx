import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@have/shared/ui/controls'
import { Field } from '@have/shared/ui/forms'
import { ownerApi, type RecoveryChallenge, type RecoveryProof } from '@have/shared/api/owner'
import { useOwnerSession } from '../../../app/session'
import { useTask } from '../../../app/hooks'

const loginSchema = z.object({ phone_number: z.string().trim().min(1, 'Enter your phone number.'), password: z.string().min(1, 'Enter your password.') })
type LoginFields = z.infer<typeof loginSchema>
export function LoginPage() {
  const task = useTask(), session = useOwnerSession(), navigate = useNavigate(), location = useLocation()
  const { register, handleSubmit, formState: { errors } } = useForm<LoginFields>({ resolver: zodResolver(loginSchema) })
  return <AuthFrame title="Welcome back" description="Sign in to your Owner workspace."><form onSubmit={handleSubmit(values => task.run(signal => session.login(values.phone_number, values.password, signal), () => navigate('/overview', { replace: true })))}>
    {(session.notice || location.state?.notice) && <p className="admin-notice" role="status">{session.notice || location.state.notice}</p>}
    {task.error && <p className="admin-error" role="alert">{task.error}</p>}
    <Field label="Phone number" {...register('phone_number')} type="tel" autoComplete="username" error={errors.phone_number?.message} />
    <Field label="Password" {...register('password')} type="password" autoComplete="current-password" error={errors.password?.message} />
    <div className="admin-form-aside"><Link to="/forgot-password">Forgot password?</Link></div>
    <Button variant="primary" disabled={task.busy}>{task.busy ? 'Signing in…' : 'Sign in'}</Button>
  </form><p className="admin-auth-note">Owner accounts are provided privately by your project administrator.</p></AuthFrame>
}
export function RecoveryPage() {
  const task = useTask(), navigate = useNavigate()
  const [phone, setPhone] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState<RecoveryChallenge | null>(null), [proof, setProof] = useState<RecoveryProof | null>(null)
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [deadline, setDeadline] = useState(0), [resendAt, setResendAt] = useState(0), [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => { if (challenge || proof) { const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) } }, [challenge, proof])
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  useEffect(() => { if (proof && !remaining) { setPassword(''); setConfirmation('') } }, [remaining === 0, !!proof])
  const send = () => task.run(signal => ownerApi.requestReset(phone, signal), result => { setChallenge(result); setProof(null); setCode(''); setDeadline(Date.now() + result.expires_in * 1000); setResendAt(Date.now() + result.resend_after * 1000) })
  const submit = () => {
    if (!challenge) return send()
    if (!proof) return task.run(signal => ownerApi.verifyReset({ challenge_id: challenge.challenge_id, phone_number: phone, code }, signal), result => { setProof(result); setCode(''); setDeadline(Date.now() + result.expires_in * 1000) })
    if (password !== confirmation) { task.setError('The passwords do not match.'); return }
    return task.run(signal => ownerApi.completeReset({ reset_token: proof.reset_token, new_password: password, confirm_password: confirmation }, signal), () => { setProof(null); setChallenge(null); setPassword(''); setConfirmation(''); navigate('/login', { replace: true, state: { notice: 'Password changed. Sign in with your new password.' } }) })
  }
  return <AuthFrame title="Recover your access" description={proof ? 'Choose a strong new password. You will sign in again afterward.' : challenge ? 'Enter the six-digit verification code sent to your phone.' : 'If an eligible Owner account exists, a verification code will be sent to its phone.'}>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      {task.error && <p className="admin-error" role="alert">{task.error}</p>}
      {!challenge ? <Field label="Phone number" type="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} required maxLength={32} /> : !proof ? <Field label="Verification code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /> : <><Field label="New password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} /><Field label="Confirm password" type="password" autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></>}
      {challenge && <p role="status" className="admin-muted">{remaining ? `Expires in ${remaining} seconds` : 'Verification expired. Request a new code.'}</p>}
      <Button variant="primary" disabled={task.busy || !!challenge && !remaining}>{task.busy ? 'Please wait…' : proof ? 'Reset password' : challenge ? 'Verify code' : 'Send verification code'}</Button>
      {challenge && <Button type="button" disabled={task.busy || now < resendAt} onClick={() => void send()}>{now < resendAt ? `Request another code in ${Math.ceil((resendAt - now) / 1000)}s` : 'Request a new code'}</Button>}
    </form><p className="admin-auth-note"><Link to="/login">← Back to sign in</Link></p>
  </AuthFrame>
}
function AuthFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="admin-auth"><aside className="admin-auth-brand"><Link to="/login" className="admin-brand"><span>H<span className="admin-brand-plus">+</span></span><strong>H.A.V.E <small>ADMIN WORKSPACE</small></strong></Link><div><span className="admin-eyebrow">HEALTH ACCESS & VENDING EVERYWHERE</span><h2>A clear view.<br />Confident decisions.</h2><p>Manage your network, support your customers, and keep every service moving.</p></div><p className="admin-auth-foot">One secure workspace for your AutoPharm network.</p></aside><section className="admin-auth-content"><div className="admin-auth-card"><span className="admin-eyebrow">OWNER ACCESS</span><h1>{title}</h1><p>{description}</p>{children}</div></section></main>
}
