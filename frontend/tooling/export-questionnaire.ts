// Regenerate backend/apps/catalogue/guidance_questions.json after changing branches.
import { questions } from '../kiosk/src/features/symptoms/assessment.ts'
const areas = questions({})[0]!.options.map(option => option.id)
console.log(JSON.stringify(Object.fromEntries(areas.map(area => [area, questions({ areas: [area], history: ['allergy', 'condition'] })])), null, 2))
