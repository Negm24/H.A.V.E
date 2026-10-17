import { beforeEach, describe, expect, it } from 'vitest'
import en from './en.json'
import ar from './ar.json'
import catalogueEn from './catalogue/en.json'
import catalogueAr from './catalogue/ar.json'
import { createAppI18n, languageDirection } from './index'

beforeEach(() => localStorage.clear())

describe('language foundation', () => {
  it('has matching English/Arabic keys and no empty translations', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
    for (const value of [...Object.values(en), ...Object.values(ar)]) expect(value.trim()).not.toBe('')
  })
  it('uses RTL for Arabic and LTR for English', () => {
    expect(languageDirection('ar-EG')).toBe('rtl')
    expect(languageDirection('en')).toBe('ltr')
  })
  it('shares complete matching catalogue and cart translations across apps', () => {
    expect(Object.keys(catalogueAr).sort()).toEqual(Object.keys(catalogueEn).sort())
    for (const value of [...Object.values(catalogueEn), ...Object.values(catalogueAr)]) expect(value.trim()).not.toBe('')
  })
  it('changes document direction and persists the Hub preference', async () => {
    const instance = await createAppI18n('hub')
    await instance.changeLanguage('ar')
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
    expect(instance.t('loading')).toBe(ar.loading)
    expect(localStorage.getItem('have:hub:language')).toBe('ar')
    const restored = await createAppI18n('hub')
    expect(restored.language).toBe('ar')
  })
  it('does not carry Hub preference into Advisor or kiosk', async () => {
    localStorage.setItem('have:hub:language', 'ar')
    expect((await createAppI18n('advisor')).language).toBe('en')
    const kiosk = await createAppI18n('kiosk')
    await kiosk.changeLanguage('ar')
    expect(localStorage.getItem('have:kiosk:language')).toBeNull()
    expect((await createAppI18n('kiosk')).language).toBe('en')
  })
  it('keeps admin English only', async () => {
    const admin = await createAppI18n('admin')
    expect(admin.options.supportedLngs).not.toContain('ar')
    expect(admin.t('loading')).toBe(en.loading)
    expect(document.documentElement.dir).toBe('ltr')
  })
})
