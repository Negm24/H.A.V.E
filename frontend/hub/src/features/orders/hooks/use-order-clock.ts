import { useEffect, useState } from 'react'

// Display only: passing a deadline never calls activity, refresh or resume.
export function useOrderClock(active: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'visible') return
      setNow(Date.now()); timer = setTimeout(tick, 1_000)
    }
    void tick(); document.addEventListener('visibilitychange', tick); window.addEventListener('focus', tick)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick) }
  }, [active])
  return now
}
