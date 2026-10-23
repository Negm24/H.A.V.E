import { request, type RequestOptions } from './http'
import type { components } from './generated'

export type CustomerIdentity = components['schemas']['CustomerIdentity']
export type TerminalSession = components['schemas']['TerminalSession']
export type QrStatus = components['schemas']['QrStatusOutput']
export type QrChallenge = components['schemas']['CustomerTerminalQrCreateOutput']
export type CatalogueCategory = components['schemas']['CategoryOutput']
export type CatalogueProduct = components['schemas']['ProductOutput']
export type TerminalCart = components['schemas']['CartOutput']
const sessions = '/api/v1/terminals/sessions/'
const customers = '/api/v1/auth/customers/terminal/'

// A local simulator selector, never a device credential. Fixed for this page load.
let simulatorId: string | undefined
export function configureTerminalSimulator(id: string | undefined) { simulatorId = id }
export function terminalRequest<T>(path: string, options: RequestOptions = {}) {
  return request<T>(path, { ...options, terminalSimulatorId: simulatorId })
}

export type GuidanceResult = components['schemas']['GuidanceOutput']
export const terminalApi = {
  guidanceNext: (token: string, answers: Record<string, string[]>, signal?: AbortSignal) => terminalRequest<components['schemas']['GuidanceNextOutput']>('/api/v1/terminals/guidance/next-question/', { method: 'POST', body: { answers, demo_consent: true }, bearerToken: token, signal }),
  guidance: (token: string, answers: Record<string, string[]>, signal?: AbortSignal) => terminalRequest<GuidanceResult>('/api/v1/terminals/guidance/', { method: 'POST', body: { answers, demo_consent: true }, bearerToken: token, signal }),
  categories: (token: string, signal?: AbortSignal) => terminalRequest<CatalogueCategory[]>('/api/v1/terminals/catalogue/categories/', { bearerToken: token, signal }),
  products: (token: string, signal?: AbortSignal) => terminalRequest<CatalogueProduct[]>('/api/v1/terminals/catalogue/products/', { bearerToken: token, signal }),
  product: (token: string, id: number, signal?: AbortSignal) => terminalRequest<CatalogueProduct>(`/api/v1/terminals/catalogue/products/${id}/`, { bearerToken: token, signal }),
  cart: (token: string, signal?: AbortSignal) => terminalRequest<TerminalCart>('/api/v1/terminals/cart/', { bearerToken: token, signal }),
  setQuantity: (token: string, id: number, quantity: number, expected_version: string, signal?: AbortSignal) => terminalRequest<TerminalCart>(`/api/v1/terminals/cart/items/${id}/`, { method: 'PUT', body: { quantity, expected_version }, bearerToken: token, signal }),
  clearCart: (token: string, expected_version: string, signal?: AbortSignal) => terminalRequest<TerminalCart>('/api/v1/terminals/cart/', { method: 'DELETE', body: { expected_version }, bearerToken: token, signal }),
  start: (signal?: AbortSignal) => terminalRequest<TerminalSession>(sessions, { method: 'POST', signal }),
  activity: (token: string, signal?: AbortSignal) => terminalRequest<TerminalSession>(sessions + 'activity/', { method: 'POST', bearerToken: token, signal }),
  end: (token: string, signal?: AbortSignal) => terminalRequest<void>(sessions + 'end/', { method: 'POST', bearerToken: token, signal }),
  login: (token: string, phone_number: string, pin: string, signal?: AbortSignal) => terminalRequest<TerminalSession>(customers + 'login/', {
    method: 'POST', bearerToken: token, body: { phone_number, pin }, signal,
  }),
  me: (token: string, signal?: AbortSignal) => terminalRequest<CustomerIdentity>(customers + 'me/', { bearerToken: token, signal }),
  createQr: (token: string, signal?: AbortSignal) => terminalRequest<QrChallenge>(customers + 'qr-login/', { method: 'POST', bearerToken: token, signal }),
  qrStatus: (token: string, id: string, signal?: AbortSignal) => terminalRequest<QrStatus>(customers + `qr-login/${encodeURIComponent(id)}/`, { bearerToken: token, signal }),
  completeQr: (token: string, id: string, signal?: AbortSignal) => terminalRequest<TerminalSession>(customers + `qr-login/${encodeURIComponent(id)}/complete/`, { method: 'POST', bearerToken: token, signal }),
}

export const terminalCartApi = {
  version: (token: string, signal?: AbortSignal) => terminalRequest<{ version: string }>('/api/v1/terminals/cart/version/', { bearerToken: token, signal }),
}
