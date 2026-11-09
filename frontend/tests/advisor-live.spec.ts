import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Run only alongside tools.advisor_browser_acceptance (separate Django test DB).
// Vite on 5177 proxies to that server, never to the normal backend on 8000.
test.skip(process.env.E2E_ADVISOR_LIVE !== 'true', 'Requires isolated Advisor test server.');

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac('sha1', key).update(counter).digest();
  const offset = hash[hash.length - 1]! & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

test('real clinic visit: MFA, patient lookup, Rx/OTC issue, PDF, history and revocation', async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = JSON.parse(readFileSync('/development/advisor-browser.local.json', 'utf8'));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5177');
  await page.getByLabel('Phone number', { exact: true }).fill(fixture.phone);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Verification code', { exact: true }).fill(totp(fixture.secret));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New prescription', exact: true })).toBeVisible();
  await page.getByLabel('Patient phone number', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: 'Find patient', exact: true }).click();
  await expect(page.getByLabel('Patient first name', { exact: true })).toHaveValue('Customer');
  await page.getByRole('checkbox', { name: /confirmed the intended patient/ }).check();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  for (const name of ['Browser Rx fixture', 'Browser OTC fixture']) {
    await page.locator('.advisor-medicine-results article').filter({ hasText: name })
      .getByRole('button', { name: 'Add', exact: true }).click();
  }
  for (const field of await page.getByLabel('Instruction format', { exact: true }).all()) await field.selectOption('custom');
  for (const name of ['Browser Rx fixture', 'Browser OTC fixture'])
    await page.locator('.advisor-prescription-line').filter({ hasText: name })
      .getByRole('textbox', { name: 'Instructions', exact: true })
      .fill('تعليمات تجريبية فقط\nFictional browser acceptance only.');
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Prescription expiry', { exact: true }).fill(future);
  await page.getByRole('button', { name: 'Review prescription', exact: true }).click();
  await page.getByRole('button', { name: 'Issue prescription', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prescription issued', exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/^HAVE-RX-.*\.pdf$/);
  await page.getByRole('button', { name: 'View prescription', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Browser Rx fixture');
  await expect(dialog).toContainText('Browser OTC fixture');
  await dialog.getByRole('button', { name: 'Revoke prescription', exact: true }).click();
  await dialog.getByLabel('Reason', { exact: true }).fill('Fictional browser acceptance completed.');
  await dialog.getByRole('button', { name: 'Revoke prescription', exact: true }).last().click();
  await expect(dialog.getByText('Revoked', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
