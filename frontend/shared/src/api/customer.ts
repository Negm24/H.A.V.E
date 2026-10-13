import { request } from './http'
import type { components } from './generated'

type Schemas = components['schemas']
export type Customer = Schemas['CustomerIdentity']
export type HubSession = Schemas['HubSession']
export type SignupData = Schemas['CustomerSignup']
export type Challenge = Schemas['CustomerSignupChallenge']
export type EmailStep = Schemas['SignupEmailStep']
export type RecoveryProof = Schemas['RecoveryProofOutput']
export type QrStatus = Schemas['QrStatusOutput']

const customers = '/api/v1/auth/customers/'
const hub = customers + 'hub/'
export const customerApi = {
  signup: (data: SignupData, signal?: AbortSignal) => request<Challenge>(customers + 'signup/', { method: 'POST', body: data, signal }),
  verifySignup: (data: Schemas['CustomerSignupVerification'], signal?: AbortSignal) => request<Customer | EmailStep>(customers + 'signup/verify/', { method: 'POST', body: data, signal }),
  login: (data: Schemas['HubLogin']) => request<HubSession>(hub + 'login/', { method: 'POST', body: data, csrf: true }),
  refresh: () => request<HubSession>(hub + 'refresh/', { method: 'POST', csrf: true }),
  logout: () => request<void>(hub + 'logout/', { method: 'POST', csrf: true }),
  me: (token: string, signal?: AbortSignal) => request<Customer>(hub + 'me/', { bearerToken: token, signal }),
  requestReset: (phone_number: string, signal?: AbortSignal) => request<Challenge>(hub + 'pin-reset/request/', { method: 'POST', body: { phone_number }, csrf: true, signal }),
  verifyReset: (data: Schemas['RecoveryVerifyInput'], signal?: AbortSignal) => request<RecoveryProof>(hub + 'pin-reset/verify/', { method: 'POST', body: data, csrf: true, signal }),
  completeReset: (data: Schemas['CustomerHubPinResetCompleteInput'], signal?: AbortSignal) => request<{ detail: string }>(hub + 'pin-reset/complete/', { method: 'POST', body: data, csrf: true, signal }),
  scanQr: (token: string, qr_payload: string, signal?: AbortSignal) => request<QrStatus>(hub + 'qr-login/scan/', { method: 'POST', bearerToken: token, body: { qr_payload }, signal }),
  qrStatus: (token: string, id: string, signal?: AbortSignal) => request<QrStatus>(hub + `qr-login/${encodeURIComponent(id)}/`, { bearerToken: token, signal }),
  confirmQr: (token: string, id: string, approve: boolean, signal?: AbortSignal) => request<QrStatus>(hub + `qr-login/${encodeURIComponent(id)}/confirm/`, { method: 'POST', bearerToken: token, body: { approve }, signal }),
}
