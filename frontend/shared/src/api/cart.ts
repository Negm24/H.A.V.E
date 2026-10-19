import { request } from './http'
import type { components } from './generated'

export type CustomerCart = components['schemas']['CartOutput']
const base = '/api/v1/hub/cart/'
const scope = (path: string, serial?: string) => path + (serial ? `?terminal_serial=${encodeURIComponent(serial)}` : '')
export const hubCartApi = {
  version: (token: string, serial: string, signal?: AbortSignal) => request<{ version: string }>(scope(base + 'version/', serial), { bearerToken: token, signal }),
  get: (token: string, signal?: AbortSignal, serial?: string) => request<CustomerCart>(scope(base, serial), { bearerToken: token, signal }),
  setQuantity: (token: string, id: number, quantity: number, expected_version: string, signal?: AbortSignal, serial?: string) => request<CustomerCart>(scope(base + `items/${id}/`, serial), { method: 'PUT', bearerToken: token, body: { quantity, expected_version }, signal }),
  clear: (token: string, expected_version: string, signal?: AbortSignal, serial?: string) => request<CustomerCart>(scope(base, serial), { method: 'DELETE', bearerToken: token, body: { expected_version }, signal }),
}
