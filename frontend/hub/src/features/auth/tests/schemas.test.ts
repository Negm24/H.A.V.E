import { describe, expect, it } from 'vitest'
import { formatDob, isValidDob, loginSchema, signupSchema, resetSchema } from '../schemas'
import en from '../locales/en.json'
import ar from '../locales/ar.json'

describe('Hub input contracts', () => {
  it('preserves phone and PIN strings, leaving phone normalization to Django', () => {
    expect(loginSchema.parse({ phone_number: '1203218887', pin: '0482', remember_me: false }).pin).toBe('0482')
    expect(loginSchema.safeParse({ phone_number: '', pin: '4826', remember_me: false }).success).toBe(false)
  })
  it('formats DD/MM/YYYY and rejects invalid calendar/future dates', () => {
    expect(formatDob('24012005')).toBe('24/01/2005')
    expect(formatDob('24/01/2005')).toBe('24/01/2005')
    expect(isValidDob('29/02/2000')).toBe(true)
    expect(isValidDob('31/02/2005')).toBe(false)
    expect(isValidDob('01/01/2999')).toBe(false)
  })
  it('requires confirmation, Latin names and an email within the current limit', () => {
    const data = { first_name: 'Ahmed', last_name: 'Sherif', phone_number: '01012345678', email: 'a@example.test', date_of_birth: '24/01/2005', pin: '4826', confirm_pin: '4826' }
    expect(signupSchema.safeParse(data).success).toBe(true)
    expect(signupSchema.safeParse({ ...data, first_name: 'أحمد' }).success).toBe(false)
    expect(signupSchema.safeParse({ ...data, confirm_pin: '7392' }).success).toBe(false)
    expect(resetSchema.safeParse({ new_pin: '4826', confirm_pin: '7392' }).success).toBe(false)
  })
  it('provides the same English and Arabic resource keys', () => {
    function keys(data: object, prefix = ''): string[] { return Object.entries(data).flatMap(([key, value]) => typeof value === 'object' ? keys(value, prefix + key + '.') : [prefix + key]).sort() }
    expect(keys(ar)).toEqual(keys(en))
  })
})
