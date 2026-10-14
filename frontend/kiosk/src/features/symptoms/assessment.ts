/** Demo intake only. No diagnosis, risk score, dosage, or medicine selection. */
export type Copy = string
export type Answers = Record<string, string[]>
export type Option = { id: string; label: Copy; exclusive?: boolean; urgent?: boolean }
export type Question = { id: string; title: Copy; kind: 'single' | 'multi'; options: Option[]; hint?: Copy }
const c = (key: string): Copy => key
const o = (id: string, key: string, exclusive = false, urgent = false): Option => ({ id, label: c(key), exclusive, urgent })
const unknown = () => o('unknown', "i_m_not_sure", true)
const none = () => o('none', "none_of_these", true)
const q = (id: string, key: string, options: Option[], kind: Question['kind'] = 'single'): Question => ({ id, title: c(key), options, kind })
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


export function questions(a: Answers): Question[] {
  const area = a.areas?.[0]
  const safety = [
    o('breathing', "trouble_breathing_mouth_or_throat_swelling", false, true),
    o('collapse', "fainting_new_weakness_or_trouble_speaking", false, true),
  ]
  if (area === 'chest') safety.push(
    o('persistent', "sudden_chest_pain_that_does_not_go_away", false, true),
    o('spread', "chest_pain_spreading_to_arm_jaw_or_back", false, true),
    o('associated', "chest_pain_with_sweating_nausea_or_breathlessness", false, true))
  if (area === 'stomach') safety.push(
    o('severe', "sudden_severe_pain_or_painful_to_touch", false, true),
    o('blood', "blood_in_vomit_bloody_or_black_stool", false, true),
    o('blocked', "cannot_urinate_or_pass_stool_or_gas", false, true))
  if (area === 'head') safety.push(o('sudden', "sudden_extremely_painful_headache", false, true))
  if (area === 'throat') safety.push(o('swallow', "cannot_swallow_drooling", false, true))
  if (area === 'back') safety.push(
    o('nerve', "both_legs_numb_numb_around_genitals", false, true),
    o('bladder', "new_bladder_bowel_control_problems", false, true),
    o('accident', "pain_after_a_serious_accident", false, true))
  if (area === 'eyes') safety.push(o('vision', "sudden_loss_of_vision_severe_eye_pain", false, true))
  const list: Question[] = [
    { ...q('areas', "what_is_bothering_you_most", [
      o('head', "head"), o('throat', "throat_cough"),
      o('chest', "chest"), o('stomach', "stomach"),
      o('back', "back_joints"), o('skin', "skin"),
      o('eyes', "eyes"), o('other', "something_else"),
    ]), hint: c("start_with_your_main_symptom_just_tap_cards_no_typing") },
    { ...q('urgent', "quick_safety_check", [...safety, none(), unknown()], 'multi'),
      hint: c("are_any_of_these_happening_now") },
  ]
  const locations: Record<string, Option[]> = {
    chest: [o('middle', "middle"), o('left', "left_side"), o('right', "right_side"), o('ribs', "ribs_chest_wall"), o('all', "all_over"), unknown()],
    stomach: [o('upper', "upper_middle"), o('lower', "lower_middle"), o('right', "right_side"), o('left', "left_side"), o('all', "all_over"), unknown()],
    head: [o('front', "forehead_face"), o('side', "one_side"), o('both', "both_sides"), o('back', "back_neck"), o('all', "all_over"), unknown()],
    back: [o('upper', "upper_back_neck"), o('lower', "lower_back"), o('arm', "shoulder_arm_hand"), o('leg', "hip_knee_foot"), unknown()],
  }
  if (area && locations[area]) list.push(q(area + '.location', "where_exactly", locations[area]))
  const pain = [o('ache', "aching_dull"), o('sharp', "sharp_stabbing"), o('burning', "burning"), o('pressure', "pressure_tightness"), o('cramp', "cramping"), unknown()]
  const feels: Record<string, Option[]> = {
    head: [o('ache', "aching"), o('pulse', "throbbing"), o('pressure', "pressure"), o('dizzy', "dizziness"), unknown()],
    throat: [o('sore', "sore_throat"), o('dry', "dry_cough"), o('mucus', "cough_with_mucus"), o('swallow', "pain_when_swallowing"), unknown()],
    stomach: [o('cramp', "cramps"), o('burning', "burning_heartburn"), o('bloat', "bloating"), o('vomit', "nausea_vomiting"), o('diarrhoea', "diarrhoea"), unknown()],
    skin: [o('itch', "itching"), o('rash', "rash_redness"), o('dry', "dry_flaky"), o('pain', "pain_burning"), unknown()],
    eyes: [o('itch', "itching"), o('watery', "watery_eyes"), o('red', "redness"), o('dry', "dryness"), unknown()],
    other: [o('fever', "fever"), o('cold', "runny_blocked_nose"), o('nausea', "nausea"), o('tired', "tiredness"), o('other', "another_symptom"), unknown()],
  }
  if (area) list.push(q(area + '.feel', "what_does_it_feel_like", feels[area] ?? pain, 'multi'))
  list.push(
    q('duration', "how_long_has_it_been", [o('today', "started_today"), o('days', "1_3_days"), o('longer', "4_days_or_more"), unknown()]),
    q('severity', "how_much_is_it_bothering_you", [o('mild', "mild_can_carry_on"), o('moderate', "moderate_gets_in_the_way"), o('severe', "severe_cannot_carry_on"), unknown()]),
    q('age', "who_is_this_for", [o('child', "child_under_12"), o('teen', "teen_12_17"), o('adult', "adult_18_64"), o('older', "65_or_older"), unknown()]),
    q('history', "anything_we_should_know", [
      o('allergy', "medicine_allergy_past_reaction"),
      o('condition', "an_ongoing_medical_condition"),
      o('medicines', "taking_medicines_tried_a_treatment"),
      o('pregnant', "pregnant_possibly_pregnant"),
      o('feeding', "breastfeeding"), none(), unknown(),
    ], 'multi'),
  )
  if (has(a, 'history', 'allergy')) list.push({
    ...q('allergy.reaction', "what_happened_with_the_medicine", [
      o('rash', "rash_itching"), o('breathing', "breathing_trouble_swelling_fainting"),
      o('stomach', "stomach_upset"), o('other', "another_reaction"), unknown(),
    ], 'multi'), hint: c("think_about_a_past_reaction_a_pharmacist_will_need_to_confirm_the")
  })
  if (has(a, 'history', 'condition')) list.push(q('conditions', "which_conditions_apply", [
    o('heart', "heart_blood_pressure"), o('asthma', "asthma_lung_disease"),
    o('diabetes', "diabetes"), o('kidney', "kidney_liver_disease"),
    o('ulcer', "ulcer_bleeding_problem"), o('other', "another_condition"), unknown(),
  ], 'multi'))
  return list
}

export function selectAnswer(a: Answers, question: Question, value: string): Answers {
  const option = question.options.find(item => item.id === value)
  if (!option) return a
  const current = a[question.id] ?? []
  const values = question.kind === 'single' ? [value] : current.includes(value) ? current.filter(item => item !== value) : option.exclusive ? [value] : [...current.filter(item => !question.options.find(opt => opt.id === item)?.exclusive), value]
  const updated = { ...a, [question.id]: values }
  // Safety choices depend on the main symptom, including shared none/unknown IDs.
  if (question.id === 'areas' && a.areas?.[0] !== values[0]) delete updated.urgent
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
export function answered(q: Question, a: Answers) { return Boolean(a[q.id]?.some(value => q.options.some(option => option.id === value))) }
export function emergency(a: Answers): { question: Question; labels: Copy[] } | undefined {
  for (const question of questions(a)) {
    const labels = question.options.filter(option => option.urgent && has(a, question.id, option.id)).map(option => option.label)
    if (labels.length) return { question, labels }
  }
  if (has(a, 'areas', 'stomach') && has(a, 'severity', 'severe')) {
    return { question: questions(a).find(question => question.id === 'severity')!, labels: [c("severe_stomach_symptoms")] }
  }
}
