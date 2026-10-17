import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@have/shared/api'
import type { QrChallenge, QrStatus } from '@have/shared/api/terminal'
import { useSession } from '../../session/hooks/use-session'

export function useQrLogin() {
  const { controller } = useSession()
  const [qr, setQr] = useState<QrChallenge | null>(null)
  const [status, setStatus] = useState<QrStatus['status'] | 'expired' | 'unavailable' | 'ready'>('ready')
  const [busy, setBusy] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const generation = useRef(0)
  const deadline = useRef(0)
  const completed = useRef(false)
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 500)
    return () => { generation.current++; clearInterval(timer) }
  }, [])

  async function generate() {
    if (busy || Date.now() < retryAt) return
    const current = ++generation.current
    completed.current = false
    setBusy(true); setQr(null)
    try {
      const result = await controller.createQr()
      if (current !== generation.current) return
      deadline.current = Date.now() + result.expires_in * 1000
      setRetryAt(Date.now() + ((result as QrChallenge & { generate_again_in?: number }).generate_again_in ?? 10) * 1000)
      setClock(Date.now())
      setQr(result); setStatus(result.status)
    } catch (error) {
      if (current !== generation.current) return
      setStatus('unavailable')
      if (error instanceof ApiError) setRetryAt(previous => Math.max(previous, Date.now() + (error.retryAfter || 0) * 1000))
    } finally { if (current === generation.current) setBusy(false) }
  }

  useEffect(() => {
    if (!qr || !['waiting_for_scan', 'waiting_for_confirmation'].includes(status)) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let running = false
    const current = generation.current
    async function poll() {
      if (stopped || running || document.visibilityState === 'hidden') return
      if (Date.now() >= deadline.current) { setQr(null); setStatus('expired'); return }
      running = true
      try {
        const result = await controller.qrStatus(qr!.challenge_id)
        if (stopped || current !== generation.current) return
        if (result.status === 'approved' && !completed.current) {
          completed.current = true
          setBusy(true)
          await controller.completeQr(qr!.challenge_id)
          if (!stopped) { setBusy(false); setQr(null); setStatus('unavailable') }
        } else {
          setStatus(result.status)
          if (result.status === 'rejected') setQr(null)
        }
      } catch (error) {
        if (stopped || current !== generation.current) return
        setQr(null)
        setStatus(error instanceof ApiError && error.status === 400 ? 'expired' : 'unavailable')
        if (error instanceof ApiError) setRetryAt(previous => Math.max(previous, Date.now() + (error.retryAfter || 0) * 1000))
      } finally {
        running = false
        if (!stopped) timer = setTimeout(() => void poll(), 2000)
      }
    }
    const visible = () => { clearTimeout(timer); void poll() }
    timer = setTimeout(() => void poll(), 2000)
    document.addEventListener('visibilitychange', visible)
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [qr, status, controller])
  return { qr, status, busy, generate, waiting: Math.max(0, Math.ceil((retryAt - clock) / 1000)), expires: Math.max(0, Math.ceil((deadline.current - clock) / 1000)) }
}
