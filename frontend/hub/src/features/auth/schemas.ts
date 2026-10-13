import { z } from 'zod'
import { latinDigits } from '@have/shared/auth/input'

// Phone canonicalization belongs to Django. Preserve leading zeros and PIN strings.
export const phoneSchema = z.string().trim().transform(latinDigits).pipe(z.string().min(1, 'required').max(32, 'phone'))
export const pinSchema = z.string().transform(latinDigits).pipe(z.string().regex(/^\d{4}$/, 'pin'))
export const loginSchema = z.object({ phone_number: phoneSchema, pin: pinSchema, remember_me: z.boolean() })
const name = z.string().trim().transform(value => value.replace(/\s+/g, ' ')).pipe(z.string().min(1, 'required').max(32, 'name').regex(/^[A-Za-z][A-Za-z '\-]*$/, 'name'))
export function isValidDob(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return false
  const [day, month, year] = value.split('/').map(Number)
  if (!year || !month || !day) return false
  const date = new Date(year, month - 1, day)
  return year >= 1000 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && date <= new Date()
}
export function formatDob(value: string) {
  const digits = latinDigits(value).replace(/\D/g, '').slice(0, 8)
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/')
}
export const signupSchema = z.object({
  first_name: name, last_name: name, phone_number: phoneSchema,
  email: z.email('email').max(128, 'email'),
  date_of_birth: z.string().refine(isValidDob, 'dob'),
  pin: pinSchema, confirm_pin: pinSchema,
}).refine(data => data.pin === data.confirm_pin, { message: 'match', path: ['confirm_pin'] })
export const resetSchema = z.object({ new_pin: pinSchema, confirm_pin: pinSchema })
  .refine(data => data.new_pin === data.confirm_pin, { message: 'match', path: ['confirm_pin'] })
export type LoginData = z.infer<typeof loginSchema>
export type SignupForm = z.infer<typeof signupSchema>
export type ResetForm = z.infer<typeof resetSchema>
