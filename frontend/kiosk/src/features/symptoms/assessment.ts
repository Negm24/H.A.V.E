/** Finite, catalogue-aware demo intake. No AI-generated questions. */
import { areas, coverage, supportedAreas, type GuideProduct, type Area } from './coverage.ts'
export type Copy = string
export type Answers = Record<string, string[]>
export type Condition = { question: string; values: string[] }
export type Option = { id: string; label: Copy; exclusive?: boolean; urgent?: boolean; when?: Condition[] }
export type Question = { id: string; title: Copy; kind: 'single' | 'multi'; options: Option[]; hint?: Copy }
export const MAX_QUESTIONS = 9
const c = (key: string): Copy => key
const o = (id: string, label: string, exclusive = false, urgent = false, when?: Condition[]): Option => ({ id, label, exclusive, urgent, ...(when ? { when } : {}) })
const unknown = () => o('unknown', 'i_m_not_sure', true)
const none = () => o('none', 'none_of_these', true)
const q = (id: string, title: string, options: Option[], kind: Question['kind'] = 'single'): Question => ({ id, title, options, kind })
export const copy = {
  single: c("choose_one_answer"), multi: c("choose_all_that_apply"),
  next: c("next_question"), choose: c("choose_an_answer_to_continue"),
  step: c("step"), adaptive: c("a_few_quick_taps_no_typing"),
  review: c("review_your_answers"), edit: c("edit"), save: c("save_answer"),
  menu: c("back_to_menu"), correct: c("correct_this_answer"),
  type: c("tap_to_enter_details"), details: c("your_details"),
  unknown: c("not_sure"),
  emergencyTitle: c("get_urgent_medical_help_now"),
  emergencyBody: c("your_answer_includes_a_warning_sign_stop_using_the_kiosk_and_cont"),
  matched: c("you_selected"),
  reviewBody: c("check_your_answers_before_finishing"),
  reviewCaution: c("questionnaire_only"),
  incomplete: c("unknown_details"),
  limits: c("university_demo_answers_stay_in_this_session_no_automated_dispens"),
}

const has = (a: Answers, id: string, value: string) => a[id]?.includes(value) ?? false
const when = (question: string, ...values: string[]): Condition => ({ question, values })

/** Complete definitions, including conditional options, exported to the backend. */
export function definitions(area: Area): Question[] {
  const feel: Record<Area, Option[]> = {
    head: [o('ache', 'aching'), o('pulse', 'throbbing'), o('pressure', 'pressure'), o('fever', 'headache_fever'), unknown()],
    throat: [o('sore', 'sore_throat'), o('swallow', 'pain_when_swallowing'), o('fever', 'sore_throat_fever'), unknown()],
    back: [o('ache', 'muscle_ache'), o('movement', 'pain_after_movement'), o('joint', 'joint_stiffness'), unknown()],
    fever: [o('hot', 'feeling_hot'), o('aches', 'fever_body_aches'), o('cold', 'fever_cold'), unknown()],
    nose: [o('blocked', 'blocked_nose'), o('pressure', 'blocked_nose_pressure'), o('runny', 'runny_blocked_nose'), unknown()],
    stomach: [o('burning', 'burning_heartburn'), o('sour', 'sour_taste'), o('meal', 'heartburn_after_meal'), unknown()],
    allergy: [o('sneeze', 'sneezing_itchy_nose'), o('eyes', 'itchy_watery_eyes'), o('hives', 'raised_itchy_rash'), unknown()],
    skin: [o('dry', 'dry_flaky'), o('rough', 'rough_dry_skin'), o('irritated', 'mild_dry_irritation'), unknown()],
  }
  const safety: Option[] = [o('breathing', 'trouble_breathing_mouth_or_throat_swelling', false, true), o('collapse', 'fainting_new_weakness_or_trouble_speaking', false, true)]
  if (area === 'head') safety.push(
    o('sudden', 'sudden_extremely_painful_headache', false, true),
    o('stiff', 'fever_stiff_neck_light', false, true, [when('head.feel', 'fever'), when('severity', 'severe')]),
    o('injury', 'recent_head_injury', false, true, [when('severity', 'severe')]))
  if (area === 'throat') safety.push(o('swallow', 'cannot_swallow_drooling', false, true),
    o('worsening', 'rapid_worsening_throat', false, true, [when('severity', 'severe'), when('throat.feel', 'swallow', 'fever')]))
  if (area === 'back') safety.push(o('nerve', 'both_legs_numb_numb_around_genitals', false, true), o('bladder', 'new_bladder_bowel_control_problems', false, true),
    o('accident', 'pain_after_a_serious_accident', false, true, [when('back.feel', 'movement'), when('severity', 'severe')]))
  if (area === 'fever') safety.push(o('stiff', 'fever_stiff_neck_light', false, true), o('rash', 'non_fading_rash', false, true),
    o('baby', 'very_young_baby_fever', false, true, [when('age', 'child')]))
  if (area === 'nose') safety.push(o('eyes', 'eye_swelling_vision', false, true, [when('nose.feel', 'pressure'), when('severity', 'severe')]))
  if (area === 'stomach') safety.push(o('blood', 'blood_in_vomit_bloody_or_black_stool', false, true), o('chest', 'chest_pain_spreading_to_arm_jaw_or_back', false, true),
    o('severe', 'sudden_severe_pain_or_painful_to_touch', false, true, [when('severity', 'severe')]))
  if (area === 'allergy') safety.push(o('rash', 'blistering_peeling_rash', false, true, [when('allergy.feel', 'hives')]),
    o('vision', 'sudden_loss_of_vision_severe_eye_pain', false, true, [when('allergy.feel', 'eyes')]))
  if (area === 'skin') safety.push(o('infection', 'rapid_painful_skin', false, true))
  return [
    { ...q('areas', 'what_is_bothering_you_most', areas.map(value => o(value, coverage[value].label))), hint: 'catalogue_paths_hint' },
    q(area + '.feel', 'what_does_it_feel_like', feel[area], 'multi'),
    q('duration', 'how_long_has_it_been', [o('today', 'started_today'), o('days', '1_3_days'), o('longer', '4_days_or_more'), unknown()]),
    q('severity', 'how_much_is_it_bothering_you', [o('mild', 'mild_can_carry_on'), o('moderate', 'moderate_gets_in_the_way'), o('severe', 'severe_cannot_carry_on'), unknown()]),
    q('age', 'who_is_this_for', [o('child', 'child_under_12'), o('teen', 'teen_12_17'), o('adult', 'adult_18_64'), o('older', '65_or_older'), unknown()]),
    { ...q('urgent', 'targeted_safety_title', [...safety, none(), unknown()], 'multi'), hint: 'targeted_safety_hint' },
    q('history', 'anything_we_should_know', [o('allergy', 'medicine_allergy_past_reaction'), o('condition', 'an_ongoing_medical_condition'), o('medicines', 'taking_medicines_tried_a_treatment'), o('pregnant', 'pregnant_possibly_pregnant'), o('feeding', 'breastfeeding'), none(), unknown()], 'multi'),
    { ...q('allergy.reaction', 'what_happened_with_the_medicine', [o('rash', 'rash_itching'), o('breathing', 'breathing_trouble_swelling_fainting'), o('stomach', 'stomach_upset'), o('other', 'another_reaction'), unknown()], 'multi'), hint: 'think_about_a_past_reaction_a_pharmacist_will_need_to_confirm_the' },
    q('conditions', 'which_conditions_apply', [o('heart', 'heart_blood_pressure'), o('asthma', 'asthma_lung_disease'), o('diabetes', 'diabetes'), o('kidney', 'kidney_liver_disease'), o('ulcer', 'ulcer_bleeding_problem'), o('other', 'another_condition'), unknown()], 'multi'),
  ]
}
export function questions(a: Answers, products?: readonly GuideProduct[]): Question[] {
  const area = areas.includes(a.areas?.[0] as Area) ? a.areas![0] as Area : areas[0]!
  const allowedAreas = products === undefined ? areas : supportedAreas(products)
  return definitions(area).filter(item => (item.id !== 'allergy.reaction' || has(a, 'history', 'allergy')) && (item.id !== 'conditions' || has(a, 'history', 'condition')))
    .map(item => ({ ...item, options: item.options.filter(option => item.id === 'areas' ? allowedAreas.includes(option.id as Area) : !option.when || option.when.some(condition => condition.values.some(value => has(a, condition.question, value)))) }))
}
export function selectAnswer(a: Answers, question: Question, value: string): Answers {
  const option = question.options.find(item => item.id === value)
  if (!option) return a
  const current = a[question.id] ?? []
  const values = question.kind === 'single' ? [value] : current.includes(value) ? current.filter(item => item !== value) : option.exclusive ? [value] : [...current.filter(item => !question.options.find(opt => opt.id === item)?.exclusive), value]
  const updated = { ...a, [question.id]: values }
  // Every upstream answer that may alter urgent cards invalidates the old checklist.
  if ((question.id === 'areas' || question.id.endsWith('.feel') || ['duration', 'severity', 'age'].includes(question.id)) && JSON.stringify(current) !== JSON.stringify(values)) delete updated.urgent
  return prune(updated)
}
export function prune(a: Answers): Answers {
  const allowed = new Map(questions(a).map(question => [question.id, question]))
  return Object.fromEntries(Object.entries(a).filter(([id]) => allowed.has(id)).map(([id, values]) => {
    const question = allowed.get(id)!
    const valid = values.filter(value => question.options.some(option => option.id === value))
    return [id, question.kind === 'single' ? valid.slice(0, 1) : valid]
  }))
}
export function answered(question: Question, a: Answers) { return Boolean(a[question.id]?.some(value => question.options.some(option => option.id === value))) }
export function emergency(a: Answers): { question: Question; labels: Copy[] } | undefined {
  for (const question of questions(a)) {
    const labels = question.options.filter(option => option.urgent && has(a, question.id, option.id)).map(option => option.label)
    if (labels.length) return { question, labels }
  }
  if (has(a, 'areas', 'stomach') && has(a, 'severity', 'severe')) return { question: questions(a).find(question => question.id === 'severity')!, labels: ['severe_stomach_symptoms'] }
}
export function nextQuestion(a: Answers, currentId: string, editing = false): string | null {
  const list = questions(a)
  const current = list.find(question => question.id === currentId)
  if (!current || !answered(current, a)) return current?.id ?? list[0]!.id
  if (!editing) {
    const next = list[list.indexOf(current) + 1]
    if (next) return next.id
  }
  return list.find(question => !answered(question, a))?.id ?? null
}
