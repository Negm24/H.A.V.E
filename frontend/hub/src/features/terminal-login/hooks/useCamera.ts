import { useEffect, useRef, useState } from 'react'
import type { IScannerControls } from '@zxing/browser'

export function useCamera(onScan: (payload: string) => void) {
  const video = useRef<HTMLVideoElement>(null), controls = useRef<IScannerControls | null>(null), generation = useRef(0)
  const callback = useRef(onScan); callback.current = onScan
  const [active, setActive] = useState(false), [error, setError] = useState('')
  function stop() {
    generation.current++; controls.current?.stop(); controls.current = null
    const stream = video.current?.srcObject
    if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop())
    if (video.current) video.current.srcObject = null
    setActive(false)
  }
  async function start() {
    stop(); setError('')
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError('cameraSecure'); return }
    const expected = generation.current; setActive(true)
    try {
      // Camera code is loaded only on demand, not on every sign-in page load.
      const { BrowserQRCodeReader } = await import('@zxing/browser')
      if (expected !== generation.current) return
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 350 })
      const scanner = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video.current!, (result, _error, scannerControls) => {
        if (!result || expected !== generation.current) return
        scannerControls.stop(); stop(); callback.current(result.getText())
      })
      if (expected !== generation.current) scanner.stop()
      else controls.current = scanner
    } catch (failure) {
      if (expected !== generation.current) return
      stop(); setError(failure instanceof DOMException && failure.name === 'NotAllowedError' ? 'cameraDenied' : 'cameraUnavailable')
    }
  }
  useEffect(() => {
    const hide = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', hide)
    return () => { document.removeEventListener('visibilitychange', hide); stop() }
  }, [])
  return { video, active, error, start, stop }
}
