import { request } from './http'
import { terminalRequest } from './terminal'
import type { CustomerCart } from './cart'
import type { components } from './generated'

export type PurchaseTerminal = components['schemas']['CollectionTerminalOutput']
export type OrderItem = components['schemas']['OrderItemOutput']
export type PurchaseOrder = components['schemas']['OrderOutput']
export type SavedCard = components['schemas']['SavedCardOutput']
export type CheckoutInput = components['schemas']['CheckoutInput'] & {
  terminal_serial: string; language: 'en' | 'ar'; print_requested: false
}
export type CheckoutResult = components['schemas']['CheckoutOutput']
const base = '/api/v1/hub/orders/'
export const hubPurchaseApi = {
  terminals: (token: string, signal?: AbortSignal) => request<PurchaseTerminal[]>(base + 'terminals/', { bearerToken: token, signal }),
  checkout: (token: string, body: CheckoutInput, signal?: AbortSignal) => request<CheckoutResult>(base + 'checkout/', { method: 'POST', body, bearerToken: token, signal }),
  list: (token: string, signal?: AbortSignal) => request<PurchaseOrder[]>(base, { bearerToken: token, signal }),
  detail: (token: string, id: string, signal?: AbortSignal) => request<PurchaseOrder>(base + `${encodeURIComponent(id)}/`, { bearerToken: token, signal }),
  cancel: (token: string, id: string, signal?: AbortSignal) => request<PurchaseOrder>(base + `${encodeURIComponent(id)}/cancel/`, { method: 'POST', body: {}, bearerToken: token, signal }),
  reorder: (token: string, id: string, cart_version: string, replace_existing: boolean, signal?: AbortSignal) => request<CustomerCart>(base + `${encodeURIComponent(id)}/reorder/`, { method: 'POST', body: { cart_version, replace_existing }, bearerToken: token, signal }),
  cards: (token: string, signal?: AbortSignal) => request<{ cards: SavedCard[]; setup_message: string }>('/api/v1/hub/payments/cards/', { bearerToken: token, signal }),
}

// Only backend-created Kashier TEST checkout sessions may take the browser away
// from H.A.V.E. A URL parameter or payment-return query never proves payment.
export function isHostedCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'payments.kashier.io' && !url.username && !url.password && !url.port
      && url.pathname.startsWith('/session/') && url.searchParams.getAll('mode').length === 1 && url.searchParams.get('mode') === 'test' && !url.hash
  } catch { return false }
}

const terminalBase = '/api/v1/terminals/orders/'
export const terminalPurchaseApi = {
  checkout: (token: string, body: Omit<CheckoutInput, 'terminal_serial' | 'print_requested'> & { print_requested: boolean; return_simulator_id?: string }, signal?: AbortSignal) => terminalRequest<CheckoutResult>(terminalBase + 'checkout/', { method: 'POST', bearerToken: token, body, signal }),
  list: (token: string, signal?: AbortSignal) => terminalRequest<PurchaseOrder[]>(terminalBase, { bearerToken: token, signal }),
  detail: (token: string, id: string, signal?: AbortSignal) => terminalRequest<PurchaseOrder>(terminalBase + `${encodeURIComponent(id)}/`, { bearerToken: token, signal }),
  cancel: (token: string, id: string, signal?: AbortSignal) => terminalRequest<PurchaseOrder>(terminalBase + `${encodeURIComponent(id)}/cancel/`, { method: 'POST', body: {}, bearerToken: token, signal }),
  collect: (token: string, id: string, signal?: AbortSignal) => terminalRequest<PurchaseOrder>(terminalBase + `${encodeURIComponent(id)}/collect/`, { method: 'POST', body: {}, bearerToken: token, signal }),
  reorder: (token: string, id: string, cart_version: string, replace_existing: boolean, signal?: AbortSignal) => terminalRequest<CustomerCart>(terminalBase + `${encodeURIComponent(id)}/reorder/`, { method: 'POST', body: { cart_version, replace_existing }, bearerToken: token, signal }),
  result: (id: string, signal?: AbortSignal) => terminalRequest<PurchaseOrder>(terminalBase + `${encodeURIComponent(id)}/result/`, { signal }),
  endResult: (id: string, signal?: AbortSignal) => terminalRequest<void>(terminalBase + `${encodeURIComponent(id)}/result/end/`, { method: 'POST', body: {}, signal }),
  resultActivity: (id: string, signal?: AbortSignal) => terminalRequest<void>(terminalBase + `${encodeURIComponent(id)}/result/activity/`, { method: 'POST', body: {}, signal }),
}
