import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { hubCatalogueApi, type CatalogueCategory, type CatalogueProduct } from '@have/shared/api/catalogue'
import { hubCartApi, type CustomerCart } from '@have/shared/api/cart'
import { ApiError } from '@have/shared/api'
import type { PurchaseTerminal } from '@have/shared/api/purchase'
import { useSession } from '../../../app/providers'

interface Snapshot {
  categories: CatalogueCategory[]; products: CatalogueProduct[]; observedAt: string | null
  cart: CustomerCart | null; loading: boolean; catalogueError: boolean; cartError: boolean
  mutationError: '' | 'conflict' | 'unconfirmed' | 'quantityError' | 'limited'; busy: boolean; limitedUntil: number
}
const initial: Snapshot = { categories: [], products: [], observedAt: null, cart: null, loading: true, catalogueError: false, cartError: false, mutationError: '', busy: false, limitedUntil: 0 }
interface CatalogueContext extends Snapshot {
  refresh: () => Promise<void>; setQuantity: (id: number, quantity: number) => Promise<void>
  clearCart: () => Promise<void>; cartOpen: boolean; openCart: () => void; closeCart: () => void
  terminal: PurchaseTerminal | null; selectTerminal: (terminal: PurchaseTerminal) => void
}
const Context = createContext<CatalogueContext | null>(null)

// Data never outlives this customer's authenticated UI. Catalogue reads are
// independent from Redis so an unavailable saved basket cannot hide medicines.
export function HubCatalogueProvider({ children }: { children: ReactNode }) {
  const { customer, status, session } = useSession()
  const [state, setState] = useState(initial), [cartOpen, showCart] = useState(false)
  const [terminal, setTerminal] = useState<PurchaseTerminal | null>(null)
  const current = useRef(state), generation = useRef(0), active = useRef<AbortController | null>(null)
  const flight = useRef<Promise<void> | null>(null), mutation = useRef<Promise<void>>(Promise.resolve())
  const cartRevision = useRef(0), blockedUntil = useRef(0)
  current.current = state
  const update = (expected: number, values: Partial<Snapshot>) => {
    if (expected !== generation.current || active.current?.signal.aborted) return
    current.current = { ...current.current, ...values }; setState(current.current)
  }
  const readCart = async (expected: number, signal: AbortSignal) => {
    const revision = cartRevision.current
    try {
      const cart = await session.authorized(token => hubCartApi.get(token, signal, terminal?.serial_number), true)
      if (revision === cartRevision.current) update(expected, { cart, cartError: false })
    } catch { if (revision === cartRevision.current) update(expected, { cartError: true }) }
  }
  const refresh = (): Promise<void> => {
    if (!active.current || active.current.signal.aborted || status !== 'authenticated' || !terminal) return Promise.resolve()
    if (flight.current) return flight.current
    const expected = generation.current, signal = active.current.signal
    const request = Promise.all([
      Promise.all([
        session.authorized(token => hubCatalogueApi.categories(token, signal, terminal.serial_number), true),
        session.authorized(token => hubCatalogueApi.products(token, signal, terminal.serial_number), true),
      ]).then(([categories, products]) => update(expected, { categories: categories.items, products: products.items, observedAt: products.observed_at, catalogueError: false, loading: false }))
        .catch(() => update(expected, { catalogueError: true, loading: false })),
      readCart(expected, signal),
    ]).then(() => {}).finally(() => { if (flight.current === request) flight.current = null })
    flight.current = request
    return request
  }
  useEffect(() => { setTerminal(null) }, [status, customer?.id])
  useEffect(() => {
    const expected = ++generation.current, controller = new AbortController()
    active.current = controller; flight.current = null; mutation.current = Promise.resolve(); blockedUntil.current = 0
    current.current = initial; setState(initial); showCart(false)
    if (status !== 'authenticated' || !customer || !terminal) return () => controller.abort()
    let timer: ReturnType<typeof setTimeout>, cycle = 0
    const poll = async () => {
      const ticket = ++cycle
      clearTimeout(timer)
      if (document.visibilityState !== 'visible') return
      await refresh()
      if (ticket === cycle && !controller.signal.aborted && generation.current === expected) timer = setTimeout(() => void poll(), 15_000)
    }
    const visible = () => { cycle++; clearTimeout(timer); if (document.visibilityState === 'visible') void poll() }
    void poll(); document.addEventListener('visibilitychange', visible)
    return () => { controller.abort(); cycle++; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); generation.current++ }
  }, [status, customer?.id, session, terminal?.serial_number])
  useEffect(() => {
    if (!state.limitedUntil) return
    const expected = generation.current
    const timer = setTimeout(() => update(expected, { limitedUntil: 0 }), Math.max(0, state.limitedUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [state.limitedUntil])

  const change = (work: (token: string, version: string, signal: AbortSignal) => Promise<CustomerCart>) => {
    const expected = generation.current, signal = active.current?.signal
    if (!signal || signal.aborted || !current.current.cart || current.current.cartError || blockedUntil.current > Date.now()) return Promise.resolve()
    update(expected, { busy: true, mutationError: '' })
    const queued = mutation.current.then(async () => {
      if (expected !== generation.current || signal.aborted || !current.current.cart || current.current.cartError) return
      cartRevision.current++
      try {
        const version = current.current.cart.version
        const cart = await session.authorized(token => work(token, version, signal))
        cartRevision.current++
        update(expected, { cart, cartError: false })
      } catch (error) {
        if (signal.aborted || expected !== generation.current) return
        if (error instanceof ApiError && error.status === 429) {
          blockedUntil.current = Date.now() + (error.retryAfter ?? 15) * 1000
          update(expected, { limitedUntil: blockedUntil.current })
        }
        update(expected, { mutationError: error instanceof ApiError && error.status === 409 ? 'conflict' : error instanceof ApiError && error.status === 429 ? 'limited' : error instanceof ApiError && error.status === 400 ? 'quantityError' : 'unconfirmed' })
        // A timeout may have followed a successful write. Reconcile with a safe
        // read; never repeat a quantity mutation automatically.
        await readCart(expected, signal)
      }
    }).finally(() => { if (mutation.current === queued) update(expected, { busy: false }) })
    mutation.current = queued
    return queued
  }
  const value: CatalogueContext = {
    ...state, terminal, selectTerminal: value => {
      if (terminal?.serial_number === value.serial_number) return
      active.current?.abort(); generation.current++; current.current = initial; setState(initial); showCart(false); setTerminal(value)
    },
    busy: state.busy || state.limitedUntil > Date.now(), refresh, cartOpen, openCart: () => showCart(true), closeCart: () => showCart(false),
    setQuantity: (id, quantity) => change((token, version, signal) => hubCartApi.setQuantity(token, id, quantity, version, signal, terminal?.serial_number)),
    clearCart: () => change((token, version, signal) => hubCartApi.clear(token, version, signal, terminal?.serial_number)),
  }
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useHubCatalogue() {
  const value = useContext(Context)
  if (!value) throw new Error('Hub catalogue requires HubCatalogueProvider')
  return value
}
