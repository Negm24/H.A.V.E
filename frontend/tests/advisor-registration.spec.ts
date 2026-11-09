import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const origin = 'http://localhost:5175';
const base = '/api/v1/auth/doctors/registration/';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXkAAAAASUVORK5CYII=', 'base64');
const details = { first_name: 'Example', last_name: 'Doctor', name_ar: 'طبيب تجريبي', clinic_name: 'Fictional clinic', clinic_name_ar: 'عيادة تجريبية', clinic_address: '12 Example Road', clinic_address_ar: '١٢ شارع تجريبي', medical_school: 'Fictional test institution', nationality: 'EG', country_of_graduation: 'EG', phone_number: '+201000000901', email: 'doctor@example.test' };
type Draft = { id: string; status: 'DRAFT' | 'SUBMITTED'; data: Record<string, string>; expires_at: string; last_saved_at: string; documents: { kind: string; content_type: string; uploaded_at: string }[] };
function savedDraft(): Draft { return { id: '11111111-2222-4333-8444-555555555555', status: 'DRAFT', data: { ...details }, expires_at: new Date(Date.now() + 5 * 86400000).toISOString(), last_saved_at: new Date(Date.now() - 2 * 86400000).toISOString(), documents: [] }; }
async function fixture(context: BrowserContext, saved = false) {
  const state = { draft: saved ? savedDraft() : null as Draft | null, started: {} as Record<string, string>, verified: [] as string[], submissions: [] as string[], loseSubmit: false, failUpload: '' };
  await context.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
    const body = req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : {};
    if (path.endsWith('/csrf/')) return route.fulfill({ json: { csrf_token: 'fictional-csrf' } });
    if (path.includes('/telemetry/')) return route.fulfill({ status: 204 });
    if (path.endsWith('/doctors/refresh/')) return route.fulfill({ status: 401, json: { detail: 'Sign in' } });
    if (path === base + 'current/') {
      if (!state.draft) return route.fulfill({ status: 404, json: { detail: 'No draft' } });
      if (method === 'PATCH') Object.assign(state.draft.data, body);
      return route.fulfill({ json: state.draft });
    }
    if (path === base + 'start/') { const { password: _secret, ...data } = body; state.started = data; return route.fulfill({ status: 202, json: { challenge_id: 'fictional-challenge', expires_in: 600, resend_after: 60 } }); }
    if (path === base + 'verify/') {
      state.verified.push(body.code);
      if (state.verified.length === 1) return route.fulfill({ status: 202, json: { challenge_id: 'fictional-challenge', next_step: 'email' } });
      state.draft = { ...savedDraft(), data: state.started, last_saved_at: new Date().toISOString() };
      return route.fulfill({ json: state.draft });
    }
    if (path === base + 'restart/') { state.draft = null; return route.fulfill({ status: 204 }); }
    if (path === base + 'resume/') { state.draft ??= savedDraft(); return route.fulfill({ json: state.draft }); }
    const document = path.match(/\/registration\/documents\/([^/]+)\//)?.[1];
    if (document) {
      if (method === 'GET') return route.fulfill({ contentType: 'image/png', body: png });
      if (state.failUpload === document) { state.failUpload = ''; return route.fulfill({ status: 503, json: { detail: 'Fictional interrupted upload. Try again.' } }); }
      if (!state.draft) return route.fulfill({ status: 401, json: { detail: 'No draft' } });
      state.draft.documents = state.draft.documents.filter(item => item.kind !== document);
      if (method === 'PUT') state.draft.documents.push({ kind: document, content_type: 'image/png', uploaded_at: new Date().toISOString() });
      return route.fulfill({ json: state.draft });
    }
    if (path === base + 'submit/') {
      state.submissions.push(body.action_id);
      if (state.draft) state.draft.status = 'SUBMITTED';
      if (state.loseSubmit && state.submissions.length === 1) return route.abort('failed');
      return route.fulfill({ status: state.submissions.length === 1 ? 201 : 200, json: { id: 'HAV-D-FICTIONAL', ...details, approval_status: 'PENDING' } });
    }
    return route.fulfill({ status: 404, json: { detail: 'Unmocked endpoint' } });
  });
  return state;
}
async function enter(page: Page) { await page.goto(origin); await page.getByRole('button', { name: 'Apply as a doctor', exact: true }).click(); }
async function fillDetails(page: Page) {
  for (const [name, value] of Object.entries(details).filter(([key]) => !['phone_number', 'email', 'nationality', 'country_of_graduation'].includes(key))) await page.locator(`input[name="${name}"]`).fill(value);
}
async function upload(page: Page, kind: string) {
  const labels: Record<string, string> = { graduation: 'Graduation certificate', id_front: 'National ID · front', id_back: 'National ID · back', passport: 'Passport identity page', syndicate: 'Egyptian Medical Syndicate card' };
  await page.getByLabel('Upload ' + labels[kind], { exact: true }).setInputFiles({ name: 'fictional.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.advisor-document-card').filter({ has: page.getByRole('heading', { name: labels[kind], exact: true }) })).toHaveClass(/is-uploaded/);
}

test('registration verifies contacts before documents and retries uncertain final submission with the same action ID', async ({ context, page }) => {
  const state = await fixture(context); state.loseSubmit = true;
  await enter(page); await fillDetails(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Phone number', { exact: true }).fill('01000000901');
  await page.getByLabel('Email address', { exact: true }).fill(details.email);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-Strong-Password-901!');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code sent to your phone' })).toBeVisible();
  await page.getByLabel('Verification code', { exact: true }).fill('111111');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code sent to your email' })).toBeVisible();
  await page.getByLabel('Verification code', { exact: true }).fill('222222');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Professional verifications', exact: true })).toBeVisible();
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/advisor-registration-documents.png', fullPage: true });
  expect(state.submissions).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  for (const kind of ['graduation', 'id_front', 'id_back', 'syndicate']) await upload(page, kind);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review and submit', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect(page.getByText(/result is uncertain/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Application submitted', exact: true })).toBeVisible();
  expect(state.verified).toEqual(['111111', '222222']);
  expect(new Set(state.submissions).size).toBe(1);
  const persisted = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  expect(persisted).not.toContain(details.email); expect(persisted).not.toContain(details.name_ar); expect(persisted).not.toContain('Fictional-Strong');
  await page.locator('.advisor-registration-complete').getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Apply as a doctor', exact: true }).click();
  await expect(page.locator('input[name="first_name"]')).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Application submitted', exact: true })).toHaveCount(0);
});

test('saved draft offers a welcome modal, preserves other uploads on failure and substitutes a passport for non-Egyptians', async ({ context, page }) => {
  const state = await fixture(context, true); state.draft!.data.nationality = 'GB'; state.failUpload = 'syndicate';
  await enter(page);
  await expect(page.getByRole('dialog', { name: 'Welcome back!' })).toBeVisible();
  await expect(page.getByText(/saved your progress from 2 days ago/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue application', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Passport identity page', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'National ID · front', exact: true })).toHaveCount(0);
  await upload(page, 'graduation'); await upload(page, 'passport');
  await page.getByLabel('Upload Egyptian Medical Syndicate card', { exact: true }).setInputFiles({ name: 'fictional.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Fictional interrupted upload. Try again.')).toBeVisible();
  expect(state.draft!.documents.map(item => item.kind)).toEqual(['graduation', 'passport']);
  await upload(page, 'syndicate');
  await expect(page.getByText('3 of 3 required images saved')).toBeVisible();
});

test('camera denial has an upload fallback and does not remove the saved document', async ({ context, page }) => {
  await context.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } }); });
  await fixture(context, true); await enter(page); await page.getByRole('button', { name: 'Continue application', exact: true }).click();
  await page.locator('.advisor-document-card').first().getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Graduation certificate' })).toBeVisible();
  await expect(page.getByText(/We could not open your camera/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload instead', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await upload(page, 'graduation');
});

for (const width of [390, 820, 1440]) test(`registration retains bilingual entries without horizontal overflow at ${width}px`, async ({ context, page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(context); await enter(page); await fillDetails(page);
  await page.getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('input[name="name_ar"]')).toHaveValue(details.name_ar);
  await expect(page.locator('input[name="clinic_name"]')).toHaveValue(details.clinic_name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/advisor-registration-${width}-rtl.png`, fullPage: true });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('input[name="first_name"]')).toHaveValue(details.first_name);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('input[name="medical_school"]')).toHaveValue(details.medical_school);
});

test('start over removes the saved draft and resets the wizard', async ({ context, page }) => {
  const state = await fixture(context, true); await enter(page);
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('input[name="first_name"]')).toHaveValue('');
  expect(state.draft).toBeNull();
});

test('editing a saved draft reports unsaved changes and warns before leaving', async ({ context, page }) => {
  await fixture(context, true); await enter(page);
  await page.getByRole('button', { name: 'Continue application', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('input[name="clinic_name"]').fill('Unsaved fictional clinic');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  let warned = false;
  page.once('dialog', async dialog => { warned = true; expect(dialog.message()).toContain('not yet saved'); await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  expect(warned).toBe(true);
  await expect(page.locator('input[name="clinic_name"]')).toHaveValue('Unsaved fictional clinic');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Progress saved', { exact: true })).toBeVisible();
});
