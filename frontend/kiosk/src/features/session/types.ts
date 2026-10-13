import type { CustomerIdentity } from '@have/shared/api/terminal'

export interface SessionState {
  phase: 'attract' | 'language' | 'starting' | 'guest' | 'customer'
  language: 'en' | 'ar' | null
  customer: CustomerIdentity | null
  busy: boolean
  remaining: number
  error: 'credentials' | 'unavailable' | 'denied' | 'invalid' | 'limited' | null
  retryUntil: number
}
