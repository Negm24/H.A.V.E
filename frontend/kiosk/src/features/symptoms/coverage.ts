/** Discovery-only demo mappings. They are not prescribing or clinical eligibility rules. */
export type GuideProduct = { id: number; active_ingredient: string | null; dosage_form: string | null; requires_prescription: boolean; stock_quantity: number; quantity_limit: number }
export const coverage = {
  head: { label: 'head', ingredients: ['paracetamol', 'ibuprofen'], forms: ['tablet', 'caplet', 'capsule', 'oral'] },
  throat: { label: 'throat_cough', ingredients: ['paracetamol', 'ibuprofen'], forms: ['tablet', 'caplet', 'capsule', 'oral'] },
  back: { label: 'back_joints', ingredients: ['paracetamol', 'ibuprofen'], forms: ['tablet', 'caplet', 'capsule', 'oral'] },
  fever: { label: 'fever', ingredients: ['paracetamol', 'ibuprofen'], forms: ['tablet', 'caplet', 'capsule', 'oral'] },
  nose: { label: 'blocked_nose', ingredients: ['xylometazoline', 'sodium chloride'], forms: ['nasal'] },
  stomach: { label: 'heartburn', ingredients: ['pantoprazole', 'omeprazole', 'magaldrate'], forms: ['tablet', 'capsule', 'oral'] },
  allergy: { label: 'allergy_symptoms', ingredients: ['cetirizine', 'loratadine', 'fexofenadine'], forms: ['tablet', 'capsule', 'oral'] },
  skin: { label: 'dry_skin', ingredients: ['dexpanthenol'], forms: ['cream'] },
} as const
export type Area = keyof typeof coverage
export const areas = Object.keys(coverage) as Area[]
export function matchesPath(product: GuideProduct, area: Area) {
  const rule = coverage[area]
  const ingredient = (product.active_ingredient ?? '').toLowerCase()
  const form = (product.dosage_form ?? '').toLowerCase()
  return !product.requires_prescription && product.stock_quantity > 0 && product.quantity_limit > 0
    && rule.ingredients.some(value => ingredient.includes(value)) && rule.forms.some(value => form.includes(value))
}
export function supportedAreas(products: readonly GuideProduct[]) {
  return areas.filter(area => products.some(product => matchesPath(product, area)))
}
