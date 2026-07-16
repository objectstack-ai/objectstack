import { test, expect } from '@playwright/test';

/**
 * ADR-0085 detail-shape regression (#2548) — permanent form of the one-off
 * real-backend browser verification that closed objectui#2546 (PR4: legacy
 * monolith detail renderer + `renderViaSchema` kill-switch removed).
 *
 * Four shapes, one invariant each, all through the single SchemaRenderer /
 * `buildDefaultPageSchema` path the console now has:
 *   - grouped        → fieldGroup sections render; `collapse: 'collapsed'`
 *                      actually collapses (Money hides `budget` until opened)
 *   - ungrouped      → flat details body, no section cards
 *   - stageField:false → NO `record:path` stepper despite a `status` field
 *                      named to bait the heuristic
 *   - related-heavy  → related lists surface as tabs (prominence rule)
 *
 * Runs against the console the backend serves at /_console (baseURL from
 * playwright.config.ts; storageState carries the admin session). The
 * semantic-zoo fixtures are objects but not seeded records — each run
 * creates its own rows via the REST API.
 *
 * Assertions are scoped to what the *pinned* console build supports
 * (.objectui-sha). The fb35e48 bump brought in objectui#2577, so the grouped
 * case also pins the follow-up UX contract: highlight strip drops the record
 * title, group icon/description render, and currencyConfig money shows its
 * symbol.
 */

const APP = process.env.SHOWCASE_APP || 'com.example.showcase';
const API = process.env.SMOKE_API_URL || 'http://localhost:3000';
const recordUrl = (object: string, id: string) =>
  `/_console/apps/${APP}/${object}/record/${encodeURIComponent(id)}`;

const PATH_STEPPER = '[aria-label="Record path"]';

let zooId = '';
let zooLegacyId = '';
let contosoId = '';

test.beforeAll(async ({ request }) => {
  const createRecord = async (object: string, data: Record<string, unknown>) => {
    const res = await request.post(`${API}/api/v1/data/${object}`, { data });
    expect(res.ok(), `create ${object} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const body = (await res.json()) as any;
    const id = body.id ?? body.record?.id ?? body.data?.id;
    expect(id, `no id returned creating ${object}`).toBeTruthy();
    return String(id);
  };

  zooId = await createRecord('showcase_semantic_zoo', {
    name: 'E2E Zoo Grouped',
    status: 'active',
    code: 'ZG-1',
    amount: 4200,
    budget: 100000,
    notes: 'detail-shapes e2e fixture',
  });
  zooLegacyId = await createRecord('showcase_semantic_zoo_legacy', {
    name: 'E2E Zoo Legacy',
    status: 'green',
    amount: 99,
  });

  // Contoso is seeded with 2 contacts / 2 invoices / 2 projects — the
  // related-heavy shape. Resolve its id instead of assuming one.
  const res = await request.get(`${API}/api/v1/data/showcase_account?%24top=50`);
  expect(res.ok(), `account list failed: ${res.status()}`).toBeTruthy();
  const rows: any[] = ((await res.json()) as any).records ?? [];
  const contoso = rows.find((r) => r?.name === 'Contoso');
  expect(contoso, 'seeded account "Contoso" not found').toBeTruthy();
  contosoId = String(contoso.id);
});

async function openRecord(page: import('@playwright/test').Page, url: string) {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 25_000 });
  await page.waitForTimeout(1500);
  return pageErrors;
}

test('grouped: fieldGroup sections render and Money starts collapsed', async ({ page }) => {
  const errors = await openRecord(page, recordUrl('showcase_semantic_zoo', zooId));

  // Stepper from stageField: 'status'.
  // record:path renders a desktop + a mobile variant — assert the visible one.
  await expect(page.locator(PATH_STEPPER).first()).toBeVisible();

  // objectui#2577: the record title is the page H1 — it must NOT repeat as a
  // (truncated) chip in the highlight strip; status/amount still do.
  const strip = page.locator('section[aria-label="Record highlights"]');
  await expect(strip).toBeVisible();
  const stripText = (await strip.innerText()).replace(/\s+/g, ' ');
  expect(stripText, 'strip repeats the record title').not.toContain('E2E Zoo');
  expect(stripText).toContain('4,200');

  // Declared groups render as titled sections. Their highlighted members
  // (status/amount) are hoisted to the strip; the non-highlighted members
  // (code/budget) keep the groups visible in the body.
  await expect(page.getByText('Basics', { exact: true })).toBeVisible();
  await expect(page.getByText('Money', { exact: true })).toBeVisible();
  await expect(page.getByText('ZG-1')).toBeVisible();

  // objectui#2577: fieldGroups[].icon renders as a real (Lucide svg) icon in
  // the section header — not as literal icon-name text.
  await expect(
    page.locator('div:has(> span:text-is("Money")) svg').first(),
    'Money header icon svg',
  ).toBeVisible();
  await expect(page.getByText('banknote', { exact: true })).toHaveCount(0);

  // collapse: 'collapsed' — Budget stays hidden until the header is opened.
  await expect(page.getByText('Budget', { exact: true })).toHaveCount(0);
  await page.getByText('Money', { exact: true }).click();
  await expect(page.getByText('Budget', { exact: true })).toBeVisible();
  // objectui#2577: fieldGroups[].description renders under the expanded
  // header, and currencyConfig.defaultCurrency drives a real $ symbol.
  await expect(page.getByText('Financial fields — collapsed by default.')).toBeVisible();
  await expect(page.getByText('$100,000', { exact: false }).first()).toBeVisible();

  expect(errors, 'uncaught page errors on grouped detail').toEqual([]);
});

test('stageField:false: status renders as a plain field, no stepper', async ({ page }) => {
  const errors = await openRecord(
    page,
    recordUrl('showcase_semantic_zoo_legacy', zooLegacyId),
  );

  // The whole point of `stageField: false`: the status-named select must NOT
  // become a chevron path. (objectui#2168 pinned strict-false handling.)
  await expect(page.locator(PATH_STEPPER)).toHaveCount(0);
  // …but the field itself still renders (as a value, not a lifecycle).
  await expect(page.getByText('Green').first()).toBeVisible();

  expect(errors, 'uncaught page errors on stageField:false detail').toEqual([]);
});

test('ungrouped + related-heavy: flat details and related-list tabs on Contoso', async ({ page }) => {
  const errors = await openRecord(page, recordUrl('showcase_account', contosoId));

  // Heuristic stepper (account.status is a select named "status").
  // record:path renders a desktop + a mobile variant — assert the visible one.
  await expect(page.locator(PATH_STEPPER).first()).toBeVisible();

  // Related lists surface as tabs (ADR-0085 prominence rule).
  const detailsTab = page.getByRole('tab', { name: /Details/i });
  await expect(detailsTab).toBeVisible();
  const invoicesTab = page.getByRole('tab', { name: /Invoices/i });
  const projectsTab = page.getByRole('tab', { name: /Projects/i });
  await expect(invoicesTab).toBeVisible();
  await expect(projectsTab).toBeVisible();

  // Ungrouped shape: the Details body is flat — no fieldGroup section cards.
  // (Contoso declares no fieldGroups; spot-check a body field label.)
  await expect(page.getByText('Basics', { exact: true })).toHaveCount(0);

  // objectui#2577 + currencyConfig: annual revenue renders with its symbol
  // in the strip, and the meta footer doesn't dangle "Created by" on the
  // actor-less seeded row.
  await expect(page.getByText('$25,000,000', { exact: false }).first()).toBeVisible();
  const footer = page.locator('[data-testid="record-meta-footer"]');
  await expect(footer).toBeVisible();
  const footerText = (await footer.innerText()).replace(/\s+/g, ' ');
  expect(footerText, 'footer dangles "Created by" without an actor').not.toMatch(/Created by/);
  expect(footerText).toMatch(/Created/);

  // Related lists self-fetch lazily when their tab is shown.
  await invoicesTab.click();
  const panel = page.getByRole('tabpanel');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(1500);
  const panelText = (await panel.innerText().catch(() => '')) || '';
  expect(panelText.trim().length, 'invoices tab rendered no content').toBeGreaterThan(0);

  expect(errors, 'uncaught page errors on related-heavy detail').toEqual([]);
});
