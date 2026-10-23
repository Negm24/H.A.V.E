// Run inside the frontend container; redirect stdout to the backend contract file.
import { definitions } from '../kiosk/src/features/symptoms/assessment.ts'
import { areas, coverage } from '../kiosk/src/features/symptoms/coverage.ts'
console.log(JSON.stringify({ version: 2, max_questions: 9, coverage, paths: Object.fromEntries(areas.map(area => [area, definitions(area)])) }, null, 2))
