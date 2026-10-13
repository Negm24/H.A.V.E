import { z } from 'zod'

export const loginSchema = z.object({
  // The backend owns phone validation and normalization (including a missing leading zero).
  phone: z.string(),
  pin: z.string().regex(/^[0-9]{4}$/, 'pinInvalid'),
})
export type LoginFields = z.infer<typeof loginSchema>

export { latinDigits } from '@have/shared/auth/input'
