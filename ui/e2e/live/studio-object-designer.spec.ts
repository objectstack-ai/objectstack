import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Live e2e for the Studio OBJECT designer — a "dogfood" gate that drives the
 * metadata-admin object editor as a business user would and pins the UX
 * regressions found in objectstack-ai/objectui#1926. Runs against the real
 * stack (console at LIVE_APP_URL, backend at :3000).
 *
 * Why these specifically: each is a class that static gates (build, unit,
 * spec-liveness) cannot catch because the break only appears when a real user
 * drives the real controlled inputs against the real spec validator:
 *   F2 — per-keystroke identifier sanitisation (must TYPE, not fill)
 *   F1 — cross-component reactivity (create package → switcher refresh)
 *   F3 — label→api-name derivation on blur
 *   F4 — empty picklist row must not trip spec validation, and is not stored
 *
 * In the required `Live E2E UI` job's `test:e2e:live:ci` allowlist since
 * objectstack#27554, under the promotion rule (3/3 consecutive green, plus a
 * 5/5 run of the enlarged allowlist); the readings are on that card's PR.
 */

// The object designer is reached through the showcase's own app: a stock
// showcase boot does not serve the Studio app (`com.objectstack.studio`; the
// served apps are what `GET /api/v1/meta/app` lists), and the metadata routes
// resolve under any served app.
const PKG = 'com.example.showcase';
const NEW_OBJ = `/apps/showcase_app/metadata/object/new?package=${PKG}`;
const API = process.env.LIVE_API_URL || 'http://localhost:3000';

/**
 * A package the environment authors, for a test that SAVES: the showcase is
 * provided by code, so a save into it is refused (`WRITABLE_PACKAGE_REQUIRED`).
 */
async function authorWritablePackage(request: APIRequestContext, stamp: number): Promise<string> {
  const id = `com.e2e.designer${stamp}`;
  const res = await request.post(`${API}/api/v1/packages`, {
    data: { manifest: { id, name: `E2E Designer ${stamp}`, version: '0.1.0', type: 'app' } },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return id;
}

/** Add a field of the given palette type into the open object designer. */
async function addField(page: Page, typeName: string) {
  await page.getByRole('button', { name: /Add field/i }).first().click();
  await page.getByPlaceholder(/Search field type/i).fill(typeName);
  // Target the palette *button* by exact accessible name — not getByText,
  // which also matches the category header ("Text") and the type badge.
  await page.getByRole('button', { name: typeName, exact: true }).first().click();
}

test('F2: object Name accepts a typed underscore (no per-keystroke trim)', async ({ page }) => {
  await page.goto(NEW_OBJ);
  const name = page.getByTestId('object-name-input');
  await expect(name).toBeVisible();
  await name.click();
  // MUST type char-by-char: .fill() would set the value in one shot and hide
  // the per-keystroke bug. Pre-fix this yields "repairticket".
  await name.pressSequentially('repair_ticket');
  await expect(name).toHaveValue('repair_ticket');
});

test('F3: a field API name derives from its label on blur', async ({ page }) => {
  await page.goto(NEW_OBJ);
  await page.getByTestId('object-name-input').fill('asset');
  await addField(page, 'Text');
  const label = page.getByTestId('field-label-input');
  await label.fill('Asset Code');
  await label.blur();
  await expect(page.getByTestId('field-apiname-input')).toHaveValue('asset_code');
});

test('F4: adding a picklist + an empty option row does not trip spec validation, and is not stored', async ({ page, request }) => {
  const stamp = Date.now();
  const pkgId = await authorWritablePackage(request, stamp);
  const objName = `e2e_asset${stamp}`;
  try {
    await page.goto(`/apps/showcase_app/metadata/object/new?package=${pkgId}`);
    await page.getByTestId('object-name-input').fill(objName);
    await addField(page, 'Picklist');
    // Give the picklist its option source first: a select with no options is a
    // real spec error (it needs `options` or `picklist`), and its banner is not
    // the one this test is about.
    await page.getByPlaceholder('Label', { exact: true }).first().fill('Open');
    await page.getByPlaceholder('value', { exact: true }).first().fill('open');
    await page.getByRole('button', { name: /Add value/i }).click();
    // Live spec validation is debounced, so settle before a NEGATIVE assertion:
    // the empty option row must NOT surface the developer-oriented
    // "System identifier must be at least 2 characters" spec error. (With the
    // bug the row persists to def.options and this banner appears.)
    await page.waitForTimeout(1200);
    await expect(page.getByTestId('metadata-validation-banner')).toHaveCount(0);
    await expect(page.getByText(/System identifier must be/i)).toHaveCount(0);

    // The save round trip, not only the UI state: Save stores a draft, and the
    // draft read back through /meta carries the one authored option and not
    // the empty row.
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes(`/api/v1/meta/object/${objName}`),
    );
    await page.getByRole('button', { name: /^Save/ }).click();
    const save = await saved;
    expect(save.ok(), await save.text()).toBeTruthy();
    const stored = await request.get(`${API}/api/v1/meta/object/${objName}?state=draft`);
    expect(stored.ok(), await stored.text()).toBeTruthy();
    const fields = Object.values((await stored.json()).item.fields as Record<string, { type?: string; options?: unknown }>);
    const picklists = fields.filter((f) => f.type === 'select');
    expect(picklists).toHaveLength(1);
    expect(picklists[0].options).toEqual([{ value: 'open', label: 'Open' }]);
  } finally {
    await request.delete(`${API}/api/v1/packages/${pkgId}`);
  }
});

test('F1: a newly created package appears in the switcher without a reload', async ({ page }) => {
  const stamp = Date.now();
  const pkgId = `com.e2e.dogfood${stamp}`;
  const pkgName = `E2E Dogfood ${stamp}`;
  const pkgIdPattern = pkgId.replace(/\./g, '\\.');
  // The console's Studio surface (`/studio/:packageId/:tab`) carries the
  // package switcher on a stock boot. The sidebar switcher (`package-switcher`)
  // renders only for an app that declares `contextSelectors`, and no app a
  // stock showcase boot serves declares one.
  await page.goto(`/studio/${PKG}/data`);
  const chip = page.getByTestId('studio-pkg-chip');
  await chip.click();
  await page.getByRole('button', { name: /New package/i }).click();
  await page.getByRole('dialog').getByLabel(/^Display name/).first().fill(pkgName);
  await page.getByTestId('package-form-id-input').fill(pkgId);
  await page.getByTestId('package-form-submit').click();

  // No reload: the surface moves into the new package, and the switcher's chip
  // names it from the refreshed list (a stale list falls back to the raw id)…
  await expect(page).toHaveURL(new RegExp(`/studio/${pkgIdPattern}/`));
  await expect(chip).toContainText(pkgName);
  // …and the open switcher lists it by its name, which only the refreshed list
  // carries (each entry's accessible name is its name, then its id).
  await chip.click();
  await expect(page.getByRole('button', { name: new RegExp(`${pkgName}\\s*${pkgIdPattern}`) })).toBeVisible();

  // Cleanup so we don't pollute the shared dev stack.
  await page.evaluate(async (id) => {
    const tok = localStorage.getItem('auth-session-token');
    await fetch(`/api/v1/packages/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok}` },
    }).catch(() => {});
  }, pkgId);
});
