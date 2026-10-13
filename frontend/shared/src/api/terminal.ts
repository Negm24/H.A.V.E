import { request } from './http'
import type { components } from './generated'

export type CustomerIdentity = components['schemas']['CustomerIdentity']
export type TerminalSession = components['schemas']['TerminalSession']
export type QrStatus = components['schemas']['QrStatusOutput']
export type QrChallenge = components['schemas']['CustomerTerminalQrCreateOutput']
const sessions = '/api/v1/terminals/sessions/'
const customers = '/api/v1/auth/customers/terminal/'

export const terminalApi = {
  start: (signal?: AbortSignal) => request<TerminalSession>(sessions, { method: 'POST', signal }),
  activity: (token: string, signal?: AbortSignal) => request<TerminalSession>(sessions + 'activity/', { method: 'POST', bearerToken: token, signal }),
  end: (token: string, signal?: AbortSignal) => request<void>(sessions + 'end/', { method: 'POST', bearerToken: token, signal }),
  login: (token: string, phone_number: string, pin: string, signal?: AbortSignal) => request<TerminalSession>(customers + 'login/', {
    method: 'POST', bearerToken: token, body: { phone_number, pin }, signal,
  }),
  me: (token: string, signal?: AbortSignal) => request<CustomerIdentity>(customers + 'me/', { bearerToken: token, signal }),
  createQr: (token: string, signal?: AbortSignal) => request<QrChallenge>(customers + 'qr-login/', { method: 'POST', bearerToken: token, signal }),
  qrStatus: (token: string, id: string, signal?: AbortSignal) => request<QrStatus>(customers + `qr-login/${encodeURIComponent(id)}/`, { bearerToken: token, signal }),
  completeQr: (token: string, id: string, signal?: AbortSignal) => request<TerminalSession>(customers + `qr-login/${encodeURIComponent(id)}/complete/`, { method: 'POST', bearerToken: token, signal }),
}
