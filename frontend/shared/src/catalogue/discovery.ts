import type { CatalogueProduct } from '../api/catalogue'
import { latinDigits } from '../auth/input'

export const normalize = (text: string) => latinDigits(text).normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').toLocaleLowerCase().trim()
function near(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length >= b.length) i++
    if (b.length >= a.length) j++
  }
  return edits + Number(i < a.length || j < b.length) <= 1
}
export function matches(product: CatalogueProduct, query: string) {
  const words = normalize(`${product.name_en} ${product.name_ar} ${product.active_ingredient || ''}`).split(/\s+/)
  return normalize(query).split(/\s+/).every(part => words.some(word => word.includes(part) || near(word, part)))
}
export function sortProducts(products: CatalogueProduct[], descending: boolean) {
  return [...products].sort((a, b) => (Number(a.price) - Number(b.price)) * (descending ? -1 : 1) || a.id - b.id)
}
