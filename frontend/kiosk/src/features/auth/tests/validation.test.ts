import { expect, it } from 'vitest'
import { latinDigits, loginSchema } from '../schemas'
import sessionEn from '../../session/locales/en.json'
import sessionAr from '../../session/locales/ar.json'
import authEn from '../locales/en.json'
import authAr from '../locales/ar.json'
import dashboardEn from '../../dashboard/locales/en.json'
import dashboardAr from '../../dashboard/locales/ar.json'

it('delegates phone formats to the backend and keeps PINs as four-digit strings', () => {
  expect(loginSchema.parse({ phone: '01012345678', pin: '0123' }).pin).toBe('0123')
  expect(loginSchema.safeParse({ phone: '+201012345678', pin: '4826' }).success).toBe(true)
  expect(loginSchema.safeParse({ phone: '1203218887', pin: '4826' }).success).toBe(true)
  expect(loginSchema.safeParse({ phone: '1234', pin: '4826' }).success).toBe(true)
  expect(loginSchema.safeParse({ phone: '01012345678', pin: 4826 }).success).toBe(false)
  expect(latinDigits('٠١٢۳۴')).toBe('01234')
})

function keys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, entry]) => typeof entry === 'object' ? keys(entry, prefix + key + '.') : [prefix + key]).sort()
}
it('has matching English and Arabic resource keys in every feature', () => {
  for (const [en, ar] of [[sessionEn, sessionAr], [authEn, authAr], [dashboardEn, dashboardAr]]) expect(keys(en!)).toEqual(keys(ar!))
})
