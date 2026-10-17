import { expect, it } from 'vitest'
import type { CatalogueProduct } from '@have/shared/api/terminal'
import { matches, normalize, sortProducts } from '../services/discovery'
import en from '@have/shared/i18n/catalogue/en.json'
import ar from '@have/shared/i18n/catalogue/ar.json'

const product = { id: 1, name_en: 'Demo Paracetamol', name_ar: 'دواء ألم الرأس', active_ingredient: 'Paracetamol', price: '18.50' } as CatalogueProduct
it('matches bilingual names, ingredients, partial words and a single typo', () => {
  for (const query of ['para', 'paracetmol', 'DEMO', 'راس', 'دواء الم']) expect(matches(product, query)).toBe(true)
  expect(matches(product, 'unrelated')).toBe(false)
  expect(normalize('أَلَم')).toBe('الم')
})
it('sorts decimal prices numerically and retains deterministic ties', () => {
  const rows = [product, { ...product, id: 3, price: '100.00' }, { ...product, id: 2, price: '18.50' }]
  expect(sortProducts(rows, false).map(p => p.id)).toEqual([1, 2, 3])
  expect(sortProducts(rows, true).map(p => p.id)).toEqual([3, 1, 2])
  expect(rows.map(p => p.id)).toEqual([1, 3, 2])
})
it('has complete matching bilingual catalogue resources', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort())
})
