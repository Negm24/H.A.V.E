import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '@have/shared/api'
import { terminalApi, type CatalogueCategory, type CatalogueProduct, type TerminalCart } from '@have/shared/api/terminal'
import { useSession } from '../../session/hooks/use-session'

const emptyCart = (): TerminalCart => ({ items: [], total_quantity: 0, subtotal: '0.00', total: '0.00', currency: 'EGP', has_issues: false, version: 'empty', created_at: null, updated_at: null, expires_at: null, comparison_required: false, adoption_notice: null })
function useCatalogueState() {
  const { controller, state } = useSession()
  const active = state.phase === 'guest' || state.phase === 'customer'
  const [categories, setCategories] = useState<CatalogueCategory[]>([])
  const [products, setProducts] = useState<CatalogueProduct[]>([])
  const [cart, setCart] = useState(emptyCart)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cartAvailable, setCartAvailable] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [descending, setDescending] = useState(false)
  const generation = useRef(0), reading = useRef(false)
  const writing = useRef<number | null>(null)
  const positions = useRef(new Map<string, number>())
  const refresh = useCallback(async () => {
    if (reading.current || writing.current === generation.current || document.hidden || !['guest', 'customer'].includes(controller.getSnapshot().phase)) return
    reading.current = true
    const current = generation.current
    try {
      const [cats, items] = await controller.request((token, signal) => Promise.all([terminalApi.categories(token, signal), terminalApi.products(token, signal)]))
      if (current !== generation.current) return
      if (!Array.isArray(cats) || !Array.isArray(items)) throw new Error('Invalid catalogue response')
      setCategories(cats); setProducts(items); setReady(true)
      try {
        const basket = await controller.request((token, signal) => terminalApi.cart(token, signal))
        if (current !== generation.current) return
        setCart(basket); setCartAvailable(true); setError(''); setUncertain(false)
      } catch (error) {
        if (current === generation.current && !(error instanceof ApiError && error.status === 401)) { setCartAvailable(false); setError('cartUnavailable') }
      }
    } catch (error) { if (current === generation.current && !(error instanceof ApiError && error.status === 401)) setError('unavailable') }
    finally { reading.current = false; if (current !== generation.current) queueMicrotask(() => void refresh()) }
  }, [controller])
  useEffect(() => {
    generation.current++
    // Guest items must disappear immediately on PIN/QR identity change, even
    // while the authoritative customer-cart read is pending or unavailable.
    setCart(emptyCart()); setCartAvailable(false); setUncertain(false); setBusy(false)
    if (!active) {
      setProducts([]); setCategories([]); setCart(emptyCart()); setReady(false); setBusy(false)
      setCartAvailable(false); setUncertain(false); setError(''); setSearchText(''); setDescending(false); positions.current.clear()
      return
    }
    void refresh()
    const interval = setInterval(() => void refresh(), 15_000)
    const visible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { generation.current++; clearInterval(interval); document.removeEventListener('visibilitychange', visible) }
  }, [active, state.customer?.id, refresh])
  const setQuantity = async (id: number, quantity: number) => {
    if (writing.current === generation.current || uncertain || !cartAvailable) return
    const current = generation.current
    writing.current = current; setBusy(true); setError('')
    try {
      const result = await controller.request((token, signal) => terminalApi.setQuantity(token, id, quantity, cart.version, signal))
      if (current === generation.current) setCart(result)
    } catch (error) {
      if (current !== generation.current) return
      setError(error instanceof ApiError && error.status === 409 ? 'conflict' : error instanceof ApiError && error.status === 400 ? 'quantityError' : 'unconfirmed')
      setUncertain(true)
      try {
        const result = await controller.request((token, signal) => terminalApi.cart(token, signal))
        if (current === generation.current) { setCart(result); setUncertain(false) }
      } catch { if (current === generation.current) setCartAvailable(false) }
    } finally { if (writing.current === current) writing.current = null; if (current === generation.current) setBusy(false) }
  }
  return { categories, products, cart, ready, busy: busy || uncertain || !cartAvailable, error, refresh, setQuantity, positions, searchText, setSearchText, descending, setDescending, cartAvailable }
}

type CatalogueState = ReturnType<typeof useCatalogueState>
const Context = createContext<CatalogueState | null>(null)
export function CatalogueProvider({ children }: { children: ReactNode }) { return <Context.Provider value={useCatalogueState()}>{children}</Context.Provider> }
export function useCatalogue() {
  const context = useContext(Context)
  if (!context) throw new Error('CatalogueProvider is required')
  return context
}
