import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const origin = "http://localhost:5175";
const doctor = {
  id: "HAV-D000-000000000901",
  account_type: "DOCTOR",
  first_name: "Fictional",
  last_name: "Doctor",
  phone_number: "+201000000901",
  email: "doctor@example.test",
  clinic_name: "Example Clinic",
  clinic_address: "Example Cairo address",
  specialty: "General",
  professional_license_number: "TEST-901",
  name_ar: "طبيب تجريبي",
  clinic_name_ar: "عيادة تجريبية",
  clinic_address_ar: "عنوان تجريبي بالقاهرة",
  specialty_ar: "طب عام",
  medical_school: "Fictional medical school",
};
const medicines = [
  {
    id: 901,
    name_en: "Example Rx medicine",
    strength: "100 mg",
    dosage_form: "Tablets",
    pack_description: "10 tablets",
    requires_prescription: true,
    dose_unit: "tablet",
  },
  {
    id: 902,
    name_en: "Example OTC medicine",
    strength: "200 mg",
    dosage_form: "Tablets",
    pack_description: "20 tablets",
    requires_prescription: false,
    dose_unit: "tablet",
  },
];
const original = {
  id: "11111111-2222-4333-8444-555555555555",
  reference: "HAVE-RX-FICTIONAL-901",
  status: "ACTIVE",
  patient_phone_number: "+201000000902",
  patient_first_name: "Example",
  patient_last_name: "Patient",
  patient_date_of_birth: "1990-01-01",
  issued_at: "2026-11-08T12:00:00Z",
  expires_at: "2027-06-01T20:59:59Z",
  lines: [
    {
      ...medicines[0],
      product_id: 901,
      instructions: "تعليمات تجريبية فقط",
      quantity: 2,
      refills: 0,
    },
  ],
  doctor,
  letterhead: {},
};

async function fixture(context: BrowserContext, authenticated = true) {
  const state = {
    authenticated,
    logoImage: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXkAAAAASUVORK5CYII=", "base64"),
    loginStatus: "MFA_REQUIRED",
    enrollment: false,
    lostIssue: false,
    pdfFailure: false,
    issues: [] as Record<string, unknown>[],
    records: [structuredClone(original)],
    profile: { ...doctor },
    letterhead: {
      revision: 1,
      alignment: "center",
      contact_line: "",
      has_logo: false,
      doctor_name: "Fictional Doctor",
      doctor_name_ar: doctor.name_ar,
      clinic_name_ar: doctor.clinic_name_ar,
      header_details: {},
      clinic_name: doctor.clinic_name,
      clinic_address: doctor.clinic_address,
    },
  };
  const calls: { path: string; body: Record<string, unknown>; raw: string }[] =
    [];
  await context.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    const raw = req.postData() || "";
    const body =
      req.headers()["content-type"]?.includes("application/json") && raw
        ? req.postDataJSON()
        : {};
    calls.push({ path, body, raw });
    let status = 200,
      response: unknown = {};
    if (path.endsWith("/csrf/")) response = { csrf_token: "test-csrf" };
    else if (path.endsWith("/telemetry/events/"))
      return route.fulfill({ status: 204 });
    else if (path.endsWith("/doctors/login/"))
      response = {
        status: state.loginStatus,
        detail: "Application status",
        can_reapply: true,
        rejection_reason: "Missing evidence",
        ...(state.loginStatus === "MFA_REQUIRED"
          ? {
              mfa_token: "test-mfa",
              ...(state.enrollment
                ? {
                    secret: "FICTIONAL-SETUP-SECRET",
                    otpauth_uri: "otpauth://totp/test",
                  }
                : {}),
            }
          : {}),
      };
    else if (
      path.endsWith("/doctors/login/mfa/") ||
      path.endsWith("/doctors/refresh/")
    ) {
      if (path.endsWith("/mfa/")) state.authenticated = true;
      if (!state.authenticated) {
        status = 401;
        response = { detail: "Sign in" };
      } else
        response = {
          doctor,
          access_token: "test-advisor-access",
          expires_in: 900,
        };
    } else if (path.endsWith("/doctors/logout/")) {
      state.authenticated = false;
      return route.fulfill({ status: 204 });
    } else if (path.endsWith("/doctors/signup/"))
      response = { challenge_id: "signup-sms", next_step: "sms" };
    else if (path.endsWith("/doctors/signup/verify/"))
      response =
        body.challenge_id === "signup-sms"
          ? { challenge_id: "signup-email", next_step: "email" }
          : doctor;
    else if (path.endsWith("/password-reset/request/"))
      response = { challenge_id: "reset-sms" };
    else if (path.endsWith("/password-reset/verify/"))
      response = { reset_token: "reset-proof" };
    else if (path.endsWith("/password-reset/complete/"))
      response = { detail: "Updated" };
    else if (!state.authenticated) {
      status = 401;
      response = { detail: "Sign in" };
    } else if (path.endsWith('/doctors/profile/')) {
      if (req.method() === 'PATCH') Object.assign(state.profile, body);
      response = state.profile;
    } else if (path.endsWith('/doctors/profile/phone/request/')) {
      response = { challenge_id: 'fictional-phone-change', expires_in: 600, resend_after: 60 };
    } else if (path.endsWith('/doctors/profile/phone/verify/')) {
      state.authenticated = false;
      response = { detail: 'Phone updated. Sign in again.' };
    } else if (path.endsWith("/patient-lookup/"))
      response = {
        found: true,
        patient_phone_number: original.patient_phone_number,
        patient_first_name: original.patient_first_name,
        patient_last_name: original.patient_last_name,
        patient_date_of_birth: original.patient_date_of_birth,
      };
    else if (path.endsWith("/medicines/search/"))
      response = {
        items: medicines,
        total: medicines.length,
        page: 1,
        page_size: 8,
      };
    else if (
      path.endsWith("/prescriptions/issue/") ||
      path.endsWith("/replace/")
    ) {
      state.issues.push(body);
      {
        const record = {
          ...original,
          ...body,
          id: original.id,
          reference: original.reference,
          lines: (body.lines as Record<string, unknown>[]).map((line) => ({
            ...medicines.find((item) => item.id === line.product_id),
            ...line,
          })),
        };
        state.records = [record as typeof original];
        if (state.lostIssue && state.issues.length === 1)
          return route.abort("failed");
        response = record;
      }
    } else if (path.endsWith("/prescriptions/search/"))
      response = {
        items: state.records,
        total: state.records.length,
        page: 1,
        page_size: 15,
      };
    else if (path.endsWith("/revoke/")) {
      state.records[0]!.status = "REVOKED";
      response = { ...state.records[0], revocation_reason: body.reason };
    } else if (
      path.endsWith("/pdf/") ||
      path.endsWith("/letterhead/preview/")
    ) {
      if (state.pdfFailure) {
        status = 503;
        response = { detail: "PDF temporarily unavailable" };
      } else
        return route.fulfill({
          contentType: "application/pdf",
          body: "%PDF-1.4\nFictional browser download fixture",
        });
    } else if (path.endsWith("/letterhead/logo/") && req.method() === 'GET') {
      return route.fulfill({ contentType:'image/png', body:state.logoImage });
    } else if (path.endsWith("/letterhead/logo/")) {
      state.letterhead.revision++;
      state.letterhead.has_logo = true;
      response = state.letterhead;
    } else if (path.endsWith("/letterhead/")) {
      if (req.method() === "PATCH")
        Object.assign(state.letterhead, body, {
          revision: state.letterhead.revision + 1,
        });
      response = state.letterhead;
    } else if (/\/prescriptions\/[\da-f-]+\/$/.test(path))
      response = state.records[0];
    else {
      status = 404;
      response = { detail: "Unmocked Advisor endpoint " + path };
    }
    await route.fulfill({ status, json: response });
  });
  return { state, calls };
}

async function open(page: Page) {
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "New prescription", exact: true }),
  ).toBeVisible();
}
async function prescription(page: Page) {
  await page
    .getByLabel("Patient phone number", { exact: true })
    .fill("01000000902");
  await page.getByRole("button", { name: "Find patient", exact: true }).click();
  await expect(
    page.getByLabel("Patient first name", { exact: true }),
  ).toHaveValue("Example");
  await page
    .getByRole("checkbox", { name: /confirmed the intended patient/ })
    .check();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .locator(".advisor-medicine-results article")
    .first()
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await page.getByLabel("Instruction format", { exact: true }).selectOption("custom");
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("  تعليمات الطبيب كما هي\nFictional instructions only.  ");
  await page.getByLabel("Authorized packs", { exact: true }).fill("2");
  await page
    .getByLabel("Prescription expiry", { exact: true })
    .fill("2027-06-01");
  await page
    .getByRole("button", { name: "Review prescription", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Review prescription", exact: true }),
  ).toBeVisible();
}

test("pending/rejected applications and authenticator enrollment reach fresh MFA sign-in", async ({
  context,
  page,
}) => {
  const { state } = await fixture(context, false);
  await page.goto(origin);
  for (const [status, label] of [
    ["WAITING_FOR_APPROVAL", "Waiting for approval"],
    ["REJECTED", "Application rejected"],
  ]) {
    state.loginStatus = status!;
    await page.getByLabel("Phone number", { exact: true }).fill("01000000901");
    await page
      .getByLabel("Password", { exact: true })
      .fill("Fictional password 901!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: label!, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
  }
  state.loginStatus = "MFA_REQUIRED";
  state.enrollment = true;
  await page.getByLabel("Phone number", { exact: true }).fill("01000000901");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Fictional password 901!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("FICTIONAL-SETUP-SECRET")).toBeVisible();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New prescription", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
    ),
  ).not.toContain("test-advisor-access");
});

test("password recovery finishes at sign-in", async ({
  context,
  page,
}) => {
  await fixture(context, false);
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Recover password", exact: true })
    .click();
  await page.getByLabel("Phone number", { exact: true }).fill("01000000901");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("333333");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await page
    .getByLabel("New password", { exact: true })
    .fill("Fictional replacement 901!");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("Fictional replacement 901!");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(
    page.getByText("Password updated. Sign in again.", { exact: true }),
  ).toBeVisible();
});

test("issue preserves instructions, uses Cairo expiry and survives a PDF failure", async ({
  context,
  page,
}) => {
  const { state } = await fixture(context);
  await open(page);
  await prescription(page);
  await page
    .getByRole("button", { name: "Issue prescription", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Prescription issued", exact: true }),
  ).toBeVisible();
  expect(state.issues[0]!.expires_at).toBe("2027-06-01T20:59:59.999Z");
  expect(
    (state.issues[0]!.lines as Record<string, unknown>[])[0]!.instructions,
  ).toBe("  تعليمات الطبيب كما هي\nFictional instructions only.  ");
  state.pdfFailure = true;
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "PDF temporarily unavailable",
  );
  state.pdfFailure = false;
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(
    original.reference + ".pdf",
  );
  expect(state.issues).toHaveLength(1);
  await page
    .getByRole("button", { name: "Start another", exact: true })
    .click();
  await expect(
    page.getByLabel("Patient phone number", { exact: true }),
  ).toHaveValue("");
});

test("issuing requires no extra authenticator prompt", async ({ context, page }) => {
  const { calls } = await fixture(context);
  await open(page);
  await prescription(page);
  await page.getByRole('button', { name: 'Issue prescription', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prescription issued', exact: true })).toBeVisible();
  expect(calls.some(call => call.path.endsWith('/reauth/'))).toBe(false);
});

test("uncertain signing retries the original action rather than sending a new prescription", async ({
  context,
  page,
}) => {
  const { state } = await fixture(context);
  state.lostIssue = true;
  await open(page);
  await prescription(page);
  await page
    .getByRole("button", { name: "Issue prescription", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Unable to reach",
  );
  await page
    .getByRole("button", { name: "Issue prescription", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Prescription issued", exact: true }),
  ).toBeVisible();
  expect(state.issues[1]).toEqual(state.issues[0]);
});

test("history date boundaries, corrected replacement and revocation use existing records", async ({
  context,
  page,
}) => {
  const { calls, state } = await fixture(context);
  await open(page);
  await page
    .getByRole("button", { name: "My prescriptions", exact: true })
    .click();
  await page.getByLabel("From date", { exact: true }).fill("2027-06-01");
  await page.getByLabel("To date", { exact: true }).fill("2027-06-01");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect
    .poll(
      () =>
        calls
          .filter((call) => call.path.endsWith("/prescriptions/search/"))
          .at(-1)?.body.end,
    )
    .toBe("2027-06-01T20:59:59.999Z");
  await page.locator(".advisor-history-row").first().click();
  await page
    .getByRole("button", { name: "Issue corrected replacement", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: /confirmed the intended patient/ })
    .check();
  await page
    .getByLabel("Reason for correction", { exact: true })
    .fill("Correct written instructions");
  await page
    .getByRole("button", { name: "Review prescription", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Issue prescription", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Prescription issued", exact: true }),
  ).toBeVisible();
  expect(
    calls.some(
      (call) =>
        call.path.endsWith("/replace/") &&
        call.body.reason === "Correct written instructions",
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Start another", exact: true })
    .click();
  await expect(
    page.getByLabel("Reason for correction", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "My prescriptions", exact: true })
    .click();
  await page.locator(".advisor-history-row").first().click();
  await page
    .getByRole("button", { name: "Revoke prescription", exact: true })
    .click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Patient-facing test reason");
  await page
    .locator(".advisor-revoke-form")
    .getByRole("button", { name: "Revoke prescription", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Revoked");
  expect(state.records[0]!.status).toBe("REVOKED");
});

test("letterhead changes use returned revisions for logo and provide a PDF preview", async ({
  context,
  page,
}) => {
  const { calls, state } = await fixture(context);
  await open(page);
  state.logoImage = Buffer.from(await page.evaluate(() => {
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=80;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#5d5294';ctx.fillRect(0,0,160,80);
    ctx.fillStyle='white';ctx.font='bold 22px sans-serif';ctx.fillText('CLINIC +',18,48);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }), 'base64');
  await page
    .getByRole("button", { name: "Clinic letterhead", exact: true })
    .click();
  await expect(page.getByLabel('Doctor name in English (without Dr.)', { exact:true })).toHaveCount(0);
  await expect(page.getByLabel('Doctor name in Arabic (without د.)', { exact:true })).toHaveCount(0);
  await page
    .getByLabel("Optional clinic contact line", { exact: true })
    .fill("Example contact line");
  await page
    .getByRole("button", { name: "Save letterhead", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Letterhead saved");
  await page
    .getByLabel(/PNG or JPEG · up to 2 MiB/)
    .setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await page.getByRole("button", { name: "Upload logo", exact: true }).click();
  await expect(
    page.getByText("Clinic logo saved", { exact: true }),
  ).toBeVisible();
  expect(
    calls.find((call) => call.path.endsWith("/letterhead/logo/"))!.raw,
  ).toContain("2");
  await expect(page.locator('.advisor-clinic-logo')).toBeVisible();
  expect(await page.locator('.advisor-clinic-logo').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.reload();
  await page.getByRole('button', { name:'Clinic letterhead', exact:true }).click();
  await expect(page.locator('.advisor-clinic-logo')).toBeVisible();
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path:'test-results/advisor-letterhead-logo.png',fullPage:true });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Preview PDF", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(
    "clinic-letterhead-preview.pdf",
  );
});

test("logout discards a late patient lookup and private data does not return after signing in", async ({
  context,
  page,
}) => {
  await fixture(context);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route("**/api/v1/advisor/patient-lookup/", async (route) => {
    await waiting;
    await route.fulfill({ json: { found: true, ...original } });
  });
  await open(page);
  await page
    .getByLabel("Patient phone number", { exact: true })
    .fill("01000000902");
  await page.getByRole("button", { name: "Find patient", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  release();
  await expect(page.getByText("Example Patient", { exact: true })).toHaveCount(
    0,
  );
});

test('doctor profile edits only permitted clinic fields and verifies a new phone before signing out', async ({ context, page }) => {
  const { calls, state } = await fixture(context);
  await open(page);
  await page.getByRole('button', { name: 'Clinic letterhead', exact: true }).click();
  const profile = page.locator('.advisor-profile');
  await profile.locator('summary').click();
  await expect(profile.getByText('Fictional Doctor', { exact: true })).toBeVisible();
  await expect(profile.locator('input[name="first_name"]')).toHaveCount(0);
  await profile.getByLabel('Clinic name in English', { exact: true }).fill('Updated fictional clinic');
  await profile.getByLabel('Clinic name in Arabic', { exact: true }).fill('عيادة تجريبية محدثة');
  await profile.getByRole('button', { name: 'Save letterhead', exact: true }).click();
  await expect(profile.getByRole('status')).toHaveText('Letterhead saved');
  expect(state.profile.clinic_name).toBe('Updated fictional clinic');
  const update = calls.find(call => call.path.endsWith('/doctors/profile/') && call.body.clinic_name);
  expect(update?.body).not.toHaveProperty('first_name');
  expect(update?.body).not.toHaveProperty('medical_school');
  await profile.getByLabel('New phone number', { exact: true }).fill('01000000999');
  await profile.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCount(0);
  await profile.getByLabel('Verification code', { exact: true }).fill('123456');
  await profile.getByRole('button', { name: 'Verify and change number', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(calls.find(call => call.path.endsWith('/profile/phone/verify/'))?.body.challenge_id).toBe('fictional-phone-change');
});

test("desktop and phone RTL workspace keep forms and dialogs within the viewport", async ({
  context,
  page,
}) => {
  await fixture(context);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await prescription(page);
  await expect(page.getByRole("dialog")).toBeVisible();
  const dialogBox = await page.getByRole("dialog").boundingBox();
  expect(dialogBox!.x).toBeGreaterThan(300);
  expect(dialogBox!.y).toBeGreaterThan(0);
  if (process.env.E2E_VISUAL === "true")
    await page.screenshot({ path: "test-results/advisor-desktop-review.png" });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 850 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
  if (process.env.E2E_VISUAL === "true")
    await page.screenshot({
      path: "test-results/advisor-phone-arabic.png",
      fullPage: true,
    });
});


test('structured instructions use catalogue units, schedules and explicit omission', async ({ context, page }) => {
  const { state } = await fixture(context);
  await open(page);
  await prescription(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByLabel('Instruction format', { exact: true }).selectOption('structured');
  await page.getByLabel('Amount per dose', { exact: true }).fill('1');
  await page.getByRole('button', { name:'Increase dose', exact:true }).click();
  await expect(page.getByLabel('Amount per dose', { exact:true })).toHaveValue('2');
  await page.getByRole('button', { name:'Decrease dose', exact:true }).click();
  await expect(page.getByLabel('Amount per dose', { exact:true })).toHaveValue('1');
  await page.getByLabel('Schedule', { exact: true }).selectOption('times');
  await page.getByLabel('Dose time 1', { exact: true }).fill('12:00');
  await page.getByRole('button', { name: 'Add time', exact: true }).click();
  await page.getByLabel('Dose time 2', { exact: true }).fill('21:30');
  await page.getByLabel('Food instructions', { exact: true }).selectOption('after');
  await page.getByLabel('Treatment duration', { exact: true }).selectOption('days');
  await page.getByLabel('Treatment length', { exact: true }).fill('3');
  await expect(page.locator('.advisor-dose-unit')).toContainText('tablet(s)');
  await expect(page.locator('.advisor-instruction-preview')).toContainText('21:30');
  if (process.env.E2E_VISUAL === 'true') {
    await page.screenshot({ path: 'test-results/advisor-dosage-desktop.png', fullPage: true });
    await page.setViewportSize({ width:375, height:850 });
    await page.getByRole('button', { name:'العربية', exact:true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+2)).toBe(true);
    await page.screenshot({ path:'test-results/advisor-dosage-phone.png',fullPage:true });
    await page.getByRole('button', { name:'English', exact:true }).click();
  }
  await page.getByRole('button', { name:'Review prescription',exact:true }).click();
  await page.getByRole('button', { name:'Issue prescription',exact:true }).click();
  await expect(page.getByRole('heading', { name:'Prescription issued',exact:true })).toBeVisible();
  expect(state.issues[0]!.lines).toEqual([expect.objectContaining({ dosage:expect.objectContaining({ mode:'structured',amount:'1',schedule:'times',times:['12:00','21:30'],duration_count:3 }) })]);
  await page.getByRole('button', { name:'Start another',exact:true }).click();
  await prescription(page);
  await page.getByRole('button', { name:'Back',exact:true }).click();
  await page.getByLabel('Instruction format', { exact:true }).selectOption('none');
  await expect(page.getByLabel('Instructions', { exact:true })).toHaveCount(0);
  await expect(page.locator('.advisor-instruction-preview')).toContainText('No instructions recorded');
});


test('liquid dose controls step by 0.1 mL while allowing manual fractional entry', async ({ context, page }) => {
  await fixture(context);
  await context.route('**/api/v1/advisor/medicines/search/', route => route.fulfill({ json:{ items:[{...medicines[0],dosage_form:'Oral suspension',dose_unit:'mL'}],total:1,page:1,page_size:8 } }));
  await open(page);
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('button',{name:'Add',exact:true}).click();
  const amount=page.getByLabel('Amount per dose',{exact:true});
  await amount.fill('1');
  await page.getByRole('button',{name:'Increase dose',exact:true}).click();
  await expect(amount).toHaveValue('1.1');
  await amount.fill('0.25');
  await amount.press('ArrowUp');
  await expect(amount).toHaveValue('0.35');
  expect(await amount.evaluate((input:HTMLInputElement)=>input.validity.valid)).toBe(true);
});
