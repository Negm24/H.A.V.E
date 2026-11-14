import { ApiError, request, type RequestOptions } from "./http";
import type { components } from "./generated";

type Schemas = components["schemas"];
export type Doctor = Schemas["DoctorIdentity"];
export type DoctorSession = Schemas["AdvisorSession"];
export type RecordData = Record<string, unknown>;
export type Medicine = Schemas["AdvisorMedicine"];
export type PrescriptionLine = Schemas["AdvisorPrescriptionLine"];
export type Prescription = Schemas["AdvisorPrescription"];
export interface Patient {
  found?: boolean;
  patient_phone_number: string;
  patient_first_name: string;
  patient_last_name: string;
  patient_date_of_birth: string;
}
export type Letterhead = Schemas["AdvisorLetterhead"];
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
const auth = "/api/v1/auth/doctors/";
const base = "/api/v1/advisor/";
export type RegistrationDocumentKind = 'graduation' | 'id_front' | 'id_back' | 'passport' | 'syndicate' | 'practice_license';
export interface RegistrationDraft {
  id: string;
  status: 'DRAFT' | 'SUBMITTED';
  data: Record<string, string>;
  expires_at: string;
  last_saved_at: string;
  documents: { kind: RegistrationDocumentKind; uploaded_at: string; content_type: string }[];
  doctor_id?: string | null;
}
const registration = auth + 'registration/';
async function privateImage(path: string, signal?: AbortSignal) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: signal ?? AbortSignal.timeout(15000) });
  if (!response.ok) throw new ApiError('Document unavailable. Try again.', response.status);
  if (!response.headers.get('content-type')?.startsWith('image/')) throw new ApiError('Invalid document response.', 0);
  return response.blob();
}
export const registrationApi = {
  start: (body: RecordData) => request<Schemas['RecoveryChallengeOutput']>(registration + 'start/', { method: 'POST', body, csrf: true }),
  verify: (body: RecordData) => request<RegistrationDraft | Schemas['SignupEmailStep']>(registration + 'verify/', { method: 'POST', body, csrf: true }),
  resume: (body: RecordData) => request<RegistrationDraft>(registration + 'resume/', { method: 'POST', body, csrf: true }),
  current: (signal?: AbortSignal) => request<RegistrationDraft>(registration + 'current/', { signal }),
  update: (body: RecordData) => request<RegistrationDraft>(registration + 'current/', { method: 'PATCH', body, csrf: true }),
  restart: () => request<void>(registration + 'restart/', { method: 'POST', csrf: true }),
  upload: (kind: RegistrationDocumentKind, file: File) => {
    const body = new FormData(); body.set('image', file);
    return request<RegistrationDraft>(registration + `documents/${kind}/`, { method: 'PUT', body, csrf: true, timeoutMs: 60000 });
  },
  remove: (kind: RegistrationDocumentKind) => request<RegistrationDraft>(registration + `documents/${kind}/`, { method: 'DELETE', csrf: true }),
  image: (kind: RegistrationDocumentKind, signal?: AbortSignal) => privateImage(registration + `documents/${kind}/`, signal),
  submit: (action_id: string) => request<Doctor>(registration + 'submit/', { method: 'POST', body: { action_id }, csrf: true }),
};
export const advisorApi = {
  readProfile: (token: string) => request<Doctor>(auth + 'profile/', { bearerToken: token }),
  updateProfile: (token: string, body: RecordData) => request<Doctor>(auth + 'profile/', { method: 'PATCH', bearerToken: token, body }),
  requestPhoneChange: (token: string, phone_number: string) => request<Schemas['RecoveryChallengeOutput']>(auth + 'profile/phone/request/', { method: 'POST', bearerToken: token, body: { phone_number } }),
  verifyPhoneChange: (token: string, body: RecordData) => request<{ detail: string }>(auth + 'profile/phone/verify/', { method: 'POST', bearerToken: token, body }),
  login: (body: RecordData) =>
    request<Schemas["DoctorLoginStep"]>(auth + "login/", {
      method: "POST",
      body,
      csrf: true,
    }),
  mfa: (body: { mfa_token: string; code: string }) =>
    request<DoctorSession>(auth + "login/mfa/", {
      method: "POST",
      body,
      csrf: true,
    }),
  refresh: () =>
    request<DoctorSession>(auth + "refresh/", { method: "POST", csrf: true }),
  logout: () => request<void>(auth + "logout/", { method: "POST", csrf: true }),
  requestReset: (phone_number: string) =>
    request<Schemas["RecoveryChallengeOutput"]>(
      auth + "password-reset/request/",
      { method: "POST", csrf: true, body: { phone_number } },
    ),
  verifyReset: (body: RecordData) =>
    request<Schemas["RecoveryProofOutput"]>(auth + "password-reset/verify/", {
      method: "POST",
      csrf: true,
      body,
    }),
  completeReset: (body: RecordData) =>
    request<{ detail: string }>(auth + "password-reset/complete/", {
      method: "POST",
      csrf: true,
      body,
    }),
  read: <T>(token: string, path: string, options: RequestOptions = {}) =>
    request<T>(base + path, { ...options, bearerToken: token }),
  async logo(token: string) {
    const response = await fetch(base + 'letterhead/logo/', {
      headers: { Authorization: `Bearer ${token}` }, credentials: 'same-origin',
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new ApiError('Clinic logo unavailable.', response.status);
    return response.blob();
  },
  async pdf(token: string, path: string, body?: unknown) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ApiError(
        data.detail || "PDF unavailable. Try again.",
        response.status,
        null,
        {},
        data.code,
      );
    }
    if (!response.headers.get("content-type")?.includes("application/pdf"))
      throw new ApiError("Invalid PDF response.", 0);
    return response.blob();
  },
};
