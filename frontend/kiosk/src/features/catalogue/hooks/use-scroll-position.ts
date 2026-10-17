import { useLayoutEffect, useRef } from 'react'
import { useCatalogue } from './use-catalogue'

export function useScrollPosition(key: string) {
  const ref = useRef<HTMLDivElement>(null)
  const { positions } = useCatalogue()
  useLayoutEffect(() => { if (ref.current) ref.current.scrollTop = positions.current.get(key) || 0 }, [key, positions])
  return { ref, onScroll: () => { if (ref.current) positions.current.set(key, ref.current.scrollTop) } }
}
