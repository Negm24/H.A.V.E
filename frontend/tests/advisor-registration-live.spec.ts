import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Opt in only alongside tools.advisor_registration_acceptance and Vite:5177,
// which proxies to its separate Django test database on backend:8001.
test.skip(process.env.E2E_ADVISOR_REGISTRATION_LIVE !== 'true', 'Requires isolated registration test server.');
const origin = 'http://localhost:5177';

async function openRegistration(page: Page) {
  await page.goto(origin);
  await page.getByRole('button', { name: 'Apply as a doctor', exact: true }).click();
}

test('real registration: contact proofs, private uploads, authenticated draft resume and pending application', async ({ context, page }) => {
  test.setTimeout(140_000);
  const fixture = JSON.parse(readFileSync('/development/advisor-registration-browser.local.json', 'utf8'));
  const errors: string[] = [];
  context.on('page', active => active.on('pageerror', error => errors.push(error.message)));
  page.on('pageerror', error => errors.push(error.message));
  await openRegistration(page);
  for (const [name, value] of Object.entries(fixture.details)) {
    const field = page.locator(`[name="${name}"]`);
    if (['nationality', 'country_of_graduation'].includes(name)) await field.selectOption(String(value));
    else await field.fill(String(value));
  }
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Phone number', { exact: true }).fill(fixture.phone);
  await page.getByLabel('Email address', { exact: true }).fill(fixture.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code sent to your phone' })).toBeVisible();
  await page.getByLabel('Verification code', { exact: true }).fill(fixture.sms_code);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code sent to your email' })).toBeVisible();
  await page.getByLabel('Verification code', { exact: true }).fill(fixture.email_code);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Professional verifications', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();

  // Create a legible fictional raster locally; no real identity files or SVG uploads.
  const image = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
    const graphics = canvas.getContext('2d')!;
    graphics.fillStyle = '#ffffff'; graphics.fillRect(0, 0, 640, 400);
    graphics.strokeStyle = '#5d5294'; graphics.lineWidth = 8; graphics.strokeRect(12, 12, 616, 376);
    graphics.fillStyle = '#252737'; graphics.font = 'bold 26px sans-serif';
    graphics.fillText('FICTIONAL ACCEPTANCE DOCUMENT', 30, 90);
    graphics.font = '20px sans-serif'; graphics.fillText('Browser Applicant - not a real credential', 30, 160);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }), 'base64');
  const upload = async (active: Page, label: string) => {
    await active.getByLabel('Upload ' + label, { exact: true }).setInputFiles({ name: 'fictional-credential.png', mimeType: 'image/png', buffer: image });
    const card = active.locator('.advisor-document-card').filter({ has: active.getByRole('heading', { name: label, exact: true }) });
    await expect(card).toHaveClass(/is-uploaded/);
    await expect(card.locator('img')).toBeVisible();
  };
  await upload(page, 'Graduation certificate');

  // Closing the page and clearing cookies requires actual draft authentication.
  await page.close();
  await context.clearCookies();
  const resumed = await context.newPage();
  await openRegistration(resumed);
  await resumed.getByRole('button', { name: /already started|resume.*application/i }).click();
  const resume = resumed.getByRole('dialog');
  await resume.getByLabel('Phone number', { exact: true }).fill(fixture.phone);
  await resume.getByLabel('Password', { exact: true }).fill(fixture.password);
  await resume.getByRole('button', { name: /Resume application/i }).click();
  await expect(resumed.getByRole('dialog', { name: 'Welcome back!' })).toBeVisible();
  await resumed.getByRole('button', { name: 'Continue application', exact: true }).click();
  await expect(resumed.getByText('1 of 4 required images saved')).toBeVisible();
  for (const label of ['National ID · front', 'National ID · back', 'Egyptian Medical Syndicate card']) await upload(resumed, label);
  await resumed.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(resumed.getByRole('heading', { name: 'Review and submit', exact: true })).toBeVisible();
  await expect(resumed.getByText(fixture.details.medical_school, { exact: true })).toBeVisible();
  const stored = await resumed.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  expect(stored).not.toContain(fixture.email);
  expect(stored).not.toContain(fixture.password);
  expect(stored).not.toContain(fixture.details.name_ar);
  await resumed.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect(resumed.getByRole('heading', { name: 'Application submitted', exact: true })).toBeVisible();
  await resumed.getByRole('button', { name: 'Back to sign in', exact: true }).last().click();
  await resumed.getByLabel('Phone number', { exact: true }).fill(fixture.phone);
  await resumed.getByLabel('Password', { exact: true }).fill(fixture.password);
  await resumed.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(resumed.getByRole('heading', { name: 'Waiting for approval', exact: true })).toBeVisible();
  await expect(resumed.getByRole('heading', { name: 'New prescription', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
