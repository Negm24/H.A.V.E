import { expect, it } from 'vitest';
import { dosagePayload } from './DosageEditor';
it('changing to once-only cannot send stale repeat or duration settings', () => {
  expect(dosagePayload({ mode:'structured',amount:'1',schedule:'once',food:'unspecified',hours:'8',duration:'days',duration_count:'3',meals:['breakfast'] })).toEqual({ mode:'structured',amount:'1',schedule:'once',food:'unspecified' });
});
it('explicit omission and custom text cannot retain a hidden dosing schedule', () => {
  for (const mode of ['none','custom']) expect(dosagePayload({ mode,amount:'2',schedule:'interval',hours:'8' })).toEqual({ mode });
});
it('interval payload does not silently become a daily or meal-based schedule', () => {
  expect(dosagePayload({ mode:'structured',amount:'1',schedule:'interval',hours:'8',duration:'ongoing',food:'after',daily_count:'3',times:['12:00'],meals:['breakfast'] })).toEqual({ mode:'structured',amount:'1',schedule:'interval',hours:8,duration:'ongoing',food:'after' });
});
