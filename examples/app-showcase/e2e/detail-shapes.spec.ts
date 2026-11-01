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
 *   - related-heavy  → related lists surface by prominence (ADR-0085), in the
 *                      one-column stack tier (objectstack#27524): a
 *                      `relatedList: 'primary'` list is a body table in the
 *                      details (objectstack#27055, Target 8), the rest are
 *                      panels of the right column below them and read their
 *                      rows when they come into view
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

// Ambient `process` for the env reads below — the showcase tsconfig doesn't pull
// in `@types/node`, and the package-global shim in types/node-shim.d.ts declares
// only `cwd()`. Same idiom (and same reason) as the declarations in
// objectstack.config.ts and src/system/self-url.ts: keeps `pnpm typecheck` green
// without widening the type surface. Playwright provides the real `process`.
declare const process: { env: Record<string, string | undefined> };

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
  // A collapsible section's header is a disclosure button named by its title
  // (objectui#12625); the icon sits beside the title span inside it, and the
  // chevron in a SIBLING element. So the svg is looked up under whatever
  // element directly holds the title span: a bare `button svg` would also
  // match the chevron and stay green with no icon at all.
  await expect(
    page
      .getByRole('button', { name: 'Money' })
      .locator('*:has(> span:text-is("Money")) svg')
      .first(),
    'Money header icon svg',
  ).toBeVisible();
  await expect(page.getByText('banknote', { exact: true })).toHaveCount(0);

  // collapse: 'collapsed' — Budget stays hidden until the header is opened.
  await expect(page.getByText('Budget', { exact: true })).toHaveCount(0);
  await page.getByText('Money', { exact: true }).click();
  await expect(page.getByText('Budget', { exact: true })).toBeVisible();
  // objectui#2577: fieldGroups[].description renders under the expanded
  // header, and the fixed-mode currencyConfig.defaultCurrency (USD) drives a
  // real $ symbol.
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

test('ungrouped + related-heavy: flat details and the related panels on Contoso', async ({ page }) => {
  // The synthesized record page lays itself out by the width of the view it
  // occupies, by one rule (objectstack#26678, objectstack#27524): details |
  // the right column from `RECORD_PAGE_TWO_COLUMN_MIN_WIDTH` (760 px,
  // `@object-ui/plugin-detail`), and ONE column below it — the details, then
  // the right column's panels in their order. No tier draws a tab strip. The
  // case stays in that stack tier on purpose: the column tiers are what every
  // other page of this smoke draws at the Desktop Chrome viewport, and the
  // stack is also what the split pane (720 px) and a phone draw.
  //
  // The window is derived, not picked. Measured on this harness (a fresh
  // browser context, so no stored sidebar cookie): from a 768 px window
  // (`MOBILE_BREAKPOINT`, the desktop shell) to 1000 px the console sidebar
  // came up as its 48 px icon rail, and the record view was the window minus
  // that rail — two columns at 808 px (760 of view), one at 800 px (752).
  // So the desktop stack tier is a window of 768 to 807 px, and an expanded
  // sidebar (256 px) only narrows the view further. 780 sits inside it with
  // headroom on both sides: 732 px of view against the 760 floor, 12 px above
  // the mobile breakpoint. ⛔ Not 1200 px: since objectstack#27473 moved the
  // floor to a 760 px view, 1200 draws two columns. ⛔ Not below 768 px: that
  // is the mobile shell, where the off-canvas sidebar gives the view the
  // whole window (760 px measured as two columns).
  await page.setViewportSize({ width: 780, height: 800 });
  const errors = await openRecord(page, recordUrl('showcase_account', contosoId));

  // Heuristic stepper (account.status is a select named "status").
  // record:path renders a desktop + a mobile variant — assert the visible one.
  await expect(page.locator(PATH_STEPPER).first()).toBeVisible();

  // One column and no tab strip: the details, then the right column.
  await expect(page.locator('[data-record-page-tier]')).toHaveAttribute('data-record-page-tier', 'stack');
  await expect(page.locator('[data-record-columns]')).toHaveAttribute('data-record-columns-shown', 'details');
  await expect(page.getByRole('tab', { name: /Details|Related|Invoices|Projects/i })).toHaveCount(0);

  // Related lists surface by prominence (ADR-0085), as record page v3 draws
  // them (objectstack#27055, Target 8): Invoices and Projects are
  // `relatedList: 'primary'` (CORE relationships), so each is a body table in
  // the details, with its rows read at open; the rest of Contoso's lists
  // (Contacts and the Field Zoo lookups) are panels of the right column,
  // after its first panel, 动态 (objectstack#27524, Target 5).
  const details = page.locator('[data-record-column="details"]');
  const invoicesTable = details
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Invoice Number' }) });
  const projectsTable = details
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Project Name' }) });
  await expect(invoicesTable.getByRole('cell', { name: 'INV-1002', exact: true })).toBeVisible();
  await expect(projectsTable.getByRole('cell', { name: 'Data Platform', exact: true })).toBeVisible();
  const rightColumn = page.locator('[data-record-column="right"]');
  await expect(rightColumn.locator(':scope > *').first()).toHaveAttribute('data-record-timeline-panel', '');
  await expect(rightColumn.getByRole('region', { name: /^(Invoices|Projects)$/ })).toHaveCount(0);

  // Ungrouped shape: the details body is flat — no fieldGroup section cards.
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

  // A panel reads its rows once it is in view: below the details here, so
  // the Contacts panel reads Contoso's seeded contacts when scrolled to.
  const contactsPanel = rightColumn.getByRole('region', { name: 'Contacts', exact: true });
  await contactsPanel.scrollIntoViewIfNeeded();
  await expect(contactsPanel.locator('[data-related-card-row]').filter({ hasText: 'Carl Fox' })).toBeVisible();

  expect(errors, 'uncaught page errors on related-heavy detail').toEqual([]);
});
