import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '@have/shared/api'
import { terminalApi, terminalCartApi, type CatalogueCategory, type CatalogueProduct, type TerminalCart } from '@have/shared/api/terminal'
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
  const generation = useRef(0), reading = useRef<number | null>(null)
  const cartWrites = useRef(0), availableRef = useRef(false)
  const availability = useCallback((value: boolean) => { availableRef.current = value; setCartAvailable(value) }, [])
  const cartRef = useRef(cart)
  const acceptCart = useCallback((basket: TerminalCart) => { cartRef.current = basket; setCart(basket) }, [])
  const writing = useRef<number | null>(null)
  const positions = useRef(new Map<string, number>())
  const refresh = useCallback(async () => {
    const current = generation.current
    if (reading.current === current || writing.current === current || document.hidden || !['guest', 'customer'].includes(controller.getSnapshot().phase)) return
    reading.current = current
    const beforeWrite = cartWrites.current
    try {
      const [cats, items] = await controller.request((token, signal) => Promise.all([terminalApi.categories(token, signal), terminalApi.products(token, signal)]))
      if (current !== generation.current) return
      if (!Array.isArray(cats) || !Array.isArray(items)) throw new Error('Invalid catalogue response')
      setCategories(cats); setProducts(items); setReady(true)
      try {
        const basket = await controller.request((token, signal) => terminalApi.cart(token, signal))
        if (current !== generation.current || beforeWrite !== cartWrites.current) return
        acceptCart(basket); availability(true); setError(''); setUncertain(false)
      } catch (error) {
        if (current === generation.current && beforeWrite === cartWrites.current && !(error instanceof ApiError && error.status === 401)) { availability(false); setError('cartUnavailable') }
      }
    } catch (error) { if (current === generation.current && !(error instanceof ApiError && error.status === 401)) setError('unavailable') }
    finally { if (reading.current === current) reading.current = null }
  }, [controller, acceptCart, availability])
  const checkCartVersion = useCallback(async () => {
    const current = generation.current
    if (reading.current === current || writing.current === current || document.hidden || !['guest', 'customer'].includes(controller.getSnapshot().phase)) return
    reading.current = current
    const beforeWrite = cartWrites.current
    try {
      const revision = await controller.request((token, signal) => terminalCartApi.version(token, signal))
      if (current !== generation.current || beforeWrite !== cartWrites.current) return
      if (!availableRef.current || revision.version !== cartRef.current.version) {
        const basket = await controller.request((token, signal) => terminalApi.cart(token, signal))
        if (current !== generation.current || beforeWrite !== cartWrites.current) return
        acceptCart(basket)
      }
      availability(true); setUncertain(false)
      setError(previous => previous === 'cartUnavailable' ? '' : previous)
    } catch (cause) {
      if (current === generation.current && beforeWrite === cartWrites.current && !(cause instanceof ApiError && cause.status === 401)) { availability(false); setError('cartUnavailable') }
    } finally { if (reading.current === current) reading.current = null }
  }, [controller, acceptCart, availability])
  useEffect(() => {
    generation.current++
    // Guest items must disappear immediately on PIN/QR identity change, even
    // while the authoritative customer-cart read is pending or unavailable.
    acceptCart(emptyCart()); availability(false); setUncertain(false); setBusy(false)
    setSearchText(''); setDescending(false); positions.current.clear()
    if (!active) {
      setProducts([]); setCategories([]); setCart(emptyCart()); setReady(false); setBusy(false)
      availability(false); setUncertain(false); setError(''); setSearchText(''); setDescending(false); positions.current.clear()
      return
    }
    void refresh()
    const interval = setInterval(() => void refresh(), 15_000)
    const versions = setInterval(() => void checkCartVersion(), 2_000)
    const visible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    return () => { generation.current++; clearInterval(interval); clearInterval(versions); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible) }
  }, [active, state.customer?.id, refresh, checkCartVersion, acceptCart, availability])
  const setQuantity = async (id: number, quantity: number) => {
    if (writing.current === generation.current || uncertain || !cartAvailable) return
    const current = generation.current
    cartWrites.current++
    writing.current = current; setBusy(true); setError('')
    try {
      const result = await controller.request((token, signal) => terminalApi.setQuantity(token, id, quantity, cart.version, signal))
      if (current === generation.current) acceptCart(result)
    } catch (error) {
      if (current !== generation.current) return
      setError(error instanceof ApiError && error.status === 409 ? 'conflict' : error instanceof ApiError && error.status === 400 ? 'quantityError' : 'unconfirmed')
      setUncertain(true)
      try {
        const result = await controller.request((token, signal) => terminalApi.cart(token, signal))
        if (current === generation.current) { acceptCart(result); setUncertain(false) }
      } catch { if (current === generation.current) availability(false) }
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
