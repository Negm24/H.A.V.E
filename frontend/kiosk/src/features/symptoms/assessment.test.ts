import { describe, expect, it } from 'vitest'
import { answered, emergency, prune, questions, selectAnswer, type Answers } from './assessment'
import en from './locales/en.json'
import ar from './locales/ar.json'
const arabic = (key: string) => ar[key as keyof typeof ar]
const ids = (a: Answers) => questions(a).map(q => q.id)
const areas = ['head', 'throat', 'chest', 'stomach', 'back', 'skin', 'eyes', 'other']
describe('short card-only intake', () => {
  it('caps every combination at ten questions and never requests text', () => {
    const flags = ['allergy', 'condition', 'medicines', 'pregnant', 'feeding']
    for (const area of areas) for (let mask = 0; mask < 32; mask++) {
      const history = flags.filter((_, i) => mask & (1 << i))
      const qs = questions({ areas: [area], history })
      expect(qs.length).toBeLessThanOrEqual(10)
      expect(qs.every(q => q.kind === 'single' || q.kind === 'multi')).toBe(true)
    }
  })
  it('starts with one main symptom and asks only its relevant location', () => {
    const areaQuestion = questions({})[0]
    let a = selectAnswer({}, areaQuestion, 'chest')
    a = selectAnswer(a, areaQuestion, 'stomach')
    expect(a.areas).toEqual(['stomach'])
    expect(ids(a)).toContain('stomach.location')
    expect(ids(a)).not.toContain('chest.location')
  })
  it('adds only the two relevant optional history questions', () => {
    expect(questions({ areas: ['chest'], history: ['none'] })).toHaveLength(8)
    expect(questions({ areas: ['chest'], history: ['allergy', 'condition', 'medicines', 'pregnant', 'feeding'] })).toHaveLength(10)
    expect(ids({ history: ['medicines'] })).not.toContain('allergy.reaction')
  })
  it('removes stale branches and invalid safety choices after editing', () => {
    expect(prune({ areas: ['head'], 'stomach.location': ['upper'], urgent: ['blood'], history: ['none'], 'allergy.reaction': ['rash'], conditions: ['heart'] })).toEqual({ areas: ['head'], urgent: [], history: ['none'] })
  })
  it('keeps none and unknown exclusive without losing other flags', () => {
    const q = questions({}).find(q => q.id === 'history')!
    let a = selectAnswer({}, q, 'none')
    a = selectAnswer(a, q, 'allergy')
    a = selectAnswer(a, q, 'condition')
    expect(a.history).toEqual(['allergy', 'condition'])
    expect(selectAnswer(a, q, 'unknown').history).toEqual(['unknown'])
  })
  it('stops immediately for every displayed emergency choice', () => {
    for (const area of areas) for (const q of questions({ areas: [area] })) {
      for (const option of q.options.filter(o => o.urgent)) {
        expect(emergency({ areas: [area], [q.id]: [option.id] })?.question.id).toBe(q.id)
      }
    }
    expect(emergency({ areas: ['stomach'], severity: ['severe'] })?.question.id).toBe('severity')
  })
  it('does not treat a past severe allergy as a current emergency', () => {
    expect(emergency({ history: ['allergy'], 'allergy.reaction': ['breathing'] })).toBeUndefined()
  })
  it('rejects missing or invalid answers', () => {
    const q = questions({})[0]
    expect(answered(q, {})).toBe(false)
    expect(answered(q, { areas: ['made-up'] })).toBe(false)
    expect(answered(q, { areas: ['head'] })).toBe(true)
  })
  it('provides both languages and unique identifiers for each path', () => {
    for (const area of areas) {
      const qs = questions({ areas: [area], history: ['allergy', 'condition'] })
      expect(new Set(qs.map(q => q.id)).size).toBe(qs.length)
      for (const q of qs) {
        expect(arabic(q.title)).toMatch(/[\u0600-\u06ff]/)
        expect(new Set(q.options.map(o => o.id)).size).toBe(q.options.length)
        for (const o of q.options) expect(arabic(o.label)).toMatch(/[\u0600-\u06ff]/)
      }
    }
  })
})
