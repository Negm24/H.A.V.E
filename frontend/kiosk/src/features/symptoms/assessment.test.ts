import { describe, expect, it } from 'vitest'
import { answered, definitions, emergency, MAX_QUESTIONS, nextQuestion, prune, questions, selectAnswer, type Answers } from './assessment'
import { areas, supportedAreas, type GuideProduct } from './coverage'
import en from './locales/en.json'
import ar from './locales/ar.json'
const product = (id: number, ingredient: string, form = 'Tablets', stock = 8): GuideProduct => ({ id, active_ingredient: ingredient, dosage_form: form, stock_quantity: stock, quantity_limit: stock, requires_prescription: false })
const ids = (a: Answers) => questions(a).map(q => q.id)
const base = (area = 'head'): Answers => ({ areas: [area], [area + '.feel']: [area === 'head' ? 'ache' : 'dry'], duration: ['today'], severity: ['mild'], age: ['adult'], urgent: ['none'], history: ['none'] })

describe('finite catalogue-aware questionnaire', () => {
  it('offers only paths with a matching in-stock non-prescription ingredient and form', () => {
    const rows = [product(1, 'Paracetamol'), product(2, 'Pantoprazole'), product(3, 'Cetirizine'), product(4, 'Dexpanthenol', 'Topical cream'), product(5, 'Xylometazoline hydrochloride', 'Nasal drops')]
    expect(supportedAreas(rows)).toEqual(areas)
    expect(supportedAreas([rows[1]!])).toEqual(['stomach'])
    expect(questions({}, [rows[1]!])[0]!.options.map(o => o.id)).toEqual(['stomach'])
    expect(supportedAreas([{ ...rows[0]!, requires_prescription: true }, product(6, 'Paracetamol', 'Tablets', 0), product(7, 'Vitamin C'), product(8, 'Sodium chloride', 'Eye drops')])).toEqual([])
    expect(questions({}, [])[0]!.options).toEqual([])
    expect(questions({})[0]!.options.some(o => ['chest', 'eyes', 'other'].includes(o.id))).toBe(false)
    expect(questions({ areas: ['throat'] }).find(q => q.id === 'throat.feel')!.options.some(o => ['dry', 'mucus'].includes(o.id))).toBe(false)
  })
  it('terminates at review in 7–9 completed questions for every area and history combination', () => {
    const flags = ['allergy', 'condition', 'medicines', 'pregnant', 'feeding']
    for (const area of areas) for (let mask = 0; mask < 32; mask++) {
      let a: Answers = {}, current: string | null = 'areas', count = 0
      while (current !== null && count <= MAX_QUESTIONS) {
        const question = questions(a).find(q => q.id === current)!
        const values = question.id === 'areas' ? [area] : question.id === 'history' ? flags.filter((_, i) => mask & (1 << i)) : [question.options.find(o => o.id === 'none')?.id ?? question.options[0]!.id]
        for (const value of values.length ? values : ['none']) a = selectAnswer(a, question, value)
        count++; current = nextQuestion(a, question.id)
      }
      expect(current).toBeNull(); expect(count).toBeGreaterThanOrEqual(7); expect(count).toBeLessThanOrEqual(9)
      expect(questions(a)).toHaveLength(count)
    }
  })
  it('adds targeted urgency for fever, severe answers and very young children without adding questions', () => {
    const urgent = (a: Answers) => questions(a).find(q => q.id === 'urgent')!.options.map(o => o.id)
    expect(urgent(base())).not.toContain('stiff')
    expect(urgent({ ...base(), 'head.feel': ['fever'] })).toContain('stiff')
    expect(urgent({ ...base(), severity: ['severe'] })).toContain('injury')
    expect(urgent({ areas: ['fever'], age: ['child'] })).toContain('baby')
    expect(urgent({ areas: ['nose'], 'nose.feel': ['pressure'] })).toContain('eyes')
    expect(questions({ ...base(), 'head.feel': ['fever'] })).toHaveLength(7)
  })
  it('clears safety answers after any upstream change and prunes unrelated symptom branches', () => {
    for (const [id, value] of [['areas', 'stomach'], ['head.feel', 'fever'], ['severity', 'severe'], ['duration', 'days'], ['age', 'child']]) {
      const a = base(), q = questions(a).find(q => q.id === id)!
      const changed = selectAnswer(a, q, value!)
      expect(changed.urgent).toBeUndefined()
      expect(answered(questions(changed).find(q => q.id === 'urgent')!, changed)).toBe(false)
      expect(changed.history).toEqual(['none'])
    }
    expect(selectAnswer(base(), questions(base())[0]!, 'stomach')['head.feel']).toBeUndefined()
    expect(selectAnswer(base(), questions(base())[0]!, 'head').urgent).toEqual(['none'])
  })
  it('has only selected history followups and removes stale ones', () => {
    expect(ids({ history: ['none'] })).not.toContain('conditions')
    expect(ids({ history: ['allergy', 'condition'] })).toContain('allergy.reaction')
    expect(ids({ history: ['allergy', 'condition'] })).toContain('conditions')
    expect(prune({ ...base(), 'allergy.reaction': ['rash'], conditions: ['heart'] })).not.toHaveProperty('conditions')
    const q = questions(base()).find(q => q.id === 'history')!
    let a = selectAnswer(base(), q, 'allergy'); a = selectAnswer(a, q, 'condition')
    expect(a.history).toEqual(['allergy', 'condition'])
    expect(selectAnswer(a, q, 'unknown').history).toEqual(['unknown'])
  })
  it('stops every currently displayed urgent choice and distinguishes past allergies', () => {
    for (const area of areas) {
      const a: Answers = { areas: [area], [area + '.feel']: definitions(area)[1]!.options.filter(o => o.id !== 'unknown').map(o => o.id), severity: ['severe'], age: ['child'] }
      for (const q of questions(a)) for (const option of q.options.filter(o => o.urgent)) expect(emergency({ ...a, [q.id]: [option.id] })).toBeDefined()
    }
    expect(emergency({ history: ['allergy'], 'allergy.reaction': ['breathing'] })).toBeUndefined()
  })
  it('provides bilingual labels, unique IDs, bounded cards and no free text', () => {
    for (const area of areas) {
      const list = definitions(area)
      expect(list.length).toBeLessThanOrEqual(MAX_QUESTIONS)
      expect(new Set(list.map(q => q.id)).size).toBe(list.length)
      for (const q of list) {
        expect(q.options.length).toBeLessThanOrEqual(8)
        expect(q.kind === 'single' || q.kind === 'multi').toBe(true)
        expect(ar[q.title as keyof typeof ar]).toMatch(/[\u0600-\u06ff]/)
        expect(new Set(q.options.map(o => o.id)).size).toBe(q.options.length)
        for (const o of q.options) { expect(en[o.label as keyof typeof en]).toBeTruthy(); expect(ar[o.label as keyof typeof ar]).toMatch(/[\u0600-\u06ff]/) }
      }
    }
  })
})
