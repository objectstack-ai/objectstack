import { test, expect } from '@playwright/test';

/**
 * ADR-0085 detail-shape regression (#2548) — permanent form of the one-off
 * real-backend browser verification that closed objectui#2546 (PR4: legacy
 * monolith detail renderer + `renderViaSchema` kill-switch removed).
 *
 * Three shapes, all through the single SchemaRenderer /
 * `buildDefaultPageSchema` path the console now has. The default record page
 * draws no stage bar (`record:path`) and no key-field strip
 * (`record:highlights`) — objectstack#35891 — so every case asserts both
 * absent: the stage is the status tag beside the record's name, and
 * `highlightFields` leaves every field in its group.
 *   - grouped        → fieldGroup sections render, highlighted members
 *                      included; `collapse: 'collapsed'` actually collapses
 *                      (Money hides `amount` and `budget` until opened); the
 *                      header's stage tag reads `stageField: 'status'`
 *   - stageField:false → NO stage tag despite a `status` field named to bait
 *                      the heuristic
 *   - related-heavy  → related lists surface by prominence (ADR-0085), in the
 *                      one-column stack tier (objectstack#27524): a
 *                      `relatedList: 'primary'` list is a body table in the
 *                      details (objectstack#27055, Target 8) and takes no tab;
 *                      the rest are tabs of the tab row (objectstack#35595),
 *                      and one with records is a card of the 概览 tab's rail
 *                      below the details (objectstack#35596)
 *
 * Runs against the console the backend serves at /_console (baseURL from
 * playwright.config.ts; storageState carries the admin session). The
 * semantic-zoo fixtures are objects but not seeded records — each run
 * creates its own rows via the REST API.
 *
 * The grouped case also pins objectui#2577's UX contract: group
 * icon/description render, and currencyConfig money shows its symbol.
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
const HIGHLIGHT_STRIP = 'section[aria-label="Record highlights"]';
/** The header's stage tag, plain or as its menu, carries the field it reads. */
const stageTag = (field: string) => `[data-record-stage-tag="${field}"]:visible`;

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

  // objectstack#35891: no stage bar and no key-field strip. The stage
  // (stageField: 'status') is the header's tag beside the record's name.
  await expect(page.locator(PATH_STEPPER)).toHaveCount(0);
  await expect(page.locator(HIGHLIGHT_STRIP)).toHaveCount(0);
  await expect(page.locator(stageTag('status')).first()).toHaveText(/Active/);

  // Declared groups render as titled sections, every member in its own
  // group: the highlighted ones (status in Basics, amount in Money) are not
  // taken out of them.
  const details = page.locator('[data-record-column="details"]');
  await expect(details.getByText('Basics', { exact: true })).toBeVisible();
  await expect(details.getByText('Money', { exact: true })).toBeVisible();
  await expect(details.getByText('ZG-1')).toBeVisible();
  await expect(details.getByText('Status', { exact: true })).toBeVisible();

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

  // collapse: 'collapsed' — Amount and Budget stay hidden until the header is
  // opened; then both are in the Money group.
  await expect(details.getByText('Budget', { exact: true })).toHaveCount(0);
  await expect(details.getByText('4,200')).toHaveCount(0);
  await page.getByText('Money', { exact: true }).click();
  await expect(details.getByText('Budget', { exact: true })).toBeVisible();
  await expect(details.getByText('4,200')).toBeVisible();
  // objectui#2577: fieldGroups[].description renders under the expanded
  // header, and the fixed-mode currencyConfig.defaultCurrency (USD) drives a
  // real $ symbol.
  await expect(page.getByText('Financial fields — collapsed by default.')).toBeVisible();
  await expect(page.getByText('$100,000', { exact: false }).first()).toBeVisible();

  expect(errors, 'uncaught page errors on grouped detail').toEqual([]);
});

test('stageField:false: status renders as a plain field, no stage tag', async ({ page }) => {
  const errors = await openRecord(
    page,
    recordUrl('showcase_semantic_zoo_legacy', zooLegacyId),
  );

  // The whole point of `stageField: false`: the status-named select must NOT
  // become the header's stage tag. (objectui#2168 pinned strict-false
  // handling.) No stage bar or strip either, as on every default page.
  await expect(page.locator('[data-record-stage-tag]')).toHaveCount(0);
  await expect(page.locator(PATH_STEPPER)).toHaveCount(0);
  await expect(page.locator(HIGHLIGHT_STRIP)).toHaveCount(0);
  // …but the field itself still renders (as a value, not a lifecycle).
  await expect(page.getByText('Green').first()).toBeVisible();

  expect(errors, 'uncaught page errors on stageField:false detail').toEqual([]);
});

test('related-heavy: body tables, the tab row and the rail on Contoso', async ({ page }) => {
  // The synthesized record page lays itself out by the width of the view it
  // occupies, by one rule (objectstack#26678, objectstack#27524): details |
  // the right column from `RECORD_PAGE_TWO_COLUMN_MIN_WIDTH` (760 px,
  // `@object-ui/plugin-detail`), and ONE column below it — the details, then
  // the 概览 tab's rail. The tab row (objectstack#35595) is drawn in every
  // tier. The case stays in that stack tier on purpose: the column tiers are
  // what every other page of this smoke draws at the Desktop Chrome viewport,
  // and the stack is also what the split pane (720 px) and a phone draw.
  //
  // The window and the sidebar are derived, not picked. A collapsed console
  // sidebar draws no icon rail from 768 px up — ruling 6973617688 on
  // objectstack#35062: "Both collapsed states hide the sidebar completely" —
  // and a browser with no choice kept starts it collapsed below 1280 px and
  // expanded from 1280 px (ruling 7069868269 on objectstack#36112,
  // `consoleSidebarRail.ts` CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH). So in a fresh
  // browser context no window below 1280 px stacks: the sidebar is hidden and
  // the record view is the whole window (two columns at 768). The case
  // therefore docks the sidebar the way a reader does — the page header's
  // expand button puts the 256 px sidebar beside the page, and this browser
  // keeps that choice — and the view is the window minus it: one column at
  // 1015 px (759 of view), two at 1016 px (760). So the docked stack tier is
  // a window of 768 to 1015 px. 900 sits inside it with headroom on both
  // sides: 644 px of view against the 760 floor, 132 px above the mobile
  // breakpoint. ⛔ Not 780 px with the sidebar left as it comes up: that
  // window draws two columns (780 px of view). ⛔ Not below 768 px: that is
  // the mobile shell, where the off-canvas sidebar gives the view the whole
  // window (stack below 760), but where the details draw no Invoices body
  // table (measured at 720 and 740 px).
  await page.setViewportSize({ width: 900, height: 800 });
  const errors = await openRecord(page, recordUrl('showcase_account', contosoId));
  await page.getByTestId('shell-sidebar-expand').click();
  await expect(page.getByTestId('sidebar-collapse')).toBeVisible();
  await expect(page.getByTestId('shell-sidebar-expand')).toHaveCount(0);

  // objectstack#35891: no stage bar, no key-field strip; the heuristic stage
  // (account.status is a select named "status") is the header's tag.
  await expect(page.locator(PATH_STEPPER)).toHaveCount(0);
  await expect(page.locator(HIGHLIGHT_STRIP)).toHaveCount(0);
  await expect(page.locator(stageTag('status')).first()).toBeVisible();

  // One column: the details, then the rail. The tab row opens on 概览.
  await expect(page.locator('[data-record-page-tier]')).toHaveAttribute('data-record-page-tier', 'stack');
  await expect(page.locator('[data-record-columns]')).toHaveAttribute('data-record-columns-shown', 'details');
  await expect(page.locator('[data-record-tab="overview"]')).toHaveAttribute('aria-selected', 'true');

  // Related lists surface by prominence (ADR-0085), as record page v3 draws
  // them (objectstack#27055, Target 8): Invoices and Projects are
  // `relatedList: 'primary'` (CORE relationships), so each is a body table in
  // the details, with its rows read at open, and takes no tab of its own; the
  // rest of Contoso's lists (Contacts and the Field Zoo lookups) are tabs, and
  // one with records is a card of the rail (objectstack#35596).
  // CONTROL for the absence below: an ordinary list's tab is drawn under the
  // same `OBJECT.FIELD` id, so a renamed id scheme reds here, not silently.
  await expect(page.locator('[data-record-tab="showcase_contact.account"]')).toHaveCount(1);
  await expect(page.locator('[data-record-tab^="showcase_invoice."], [data-record-tab^="showcase_project."]')).toHaveCount(0);
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
  await expect(rightColumn.getByRole('region', { name: /^(Invoices|Projects)$/ })).toHaveCount(0);

  // Contoso's own groups render in the details (ADR-0085 §5), its highlighted
  // fields among their members.
  await expect(details.getByText('Profile', { exact: true })).toBeVisible();

  // objectui#2577 + currencyConfig: annual revenue (a highlighted field, left
  // in its Profile group) renders with its symbol in the details, and the
  // meta footer doesn't dangle "Created by" on the actor-less seeded row.
  await expect(details.getByText('$25,000,000', { exact: false }).first()).toBeVisible();
  const footer = page.locator('[data-testid="record-meta-footer"]');
  await expect(footer).toBeVisible();
  const footerText = (await footer.innerText()).replace(/\s+/g, ' ');
  expect(footerText, 'footer dangles "Created by" without an actor').not.toMatch(/Created by/);
  expect(footerText).toMatch(/Created/);

  // The rail's Contacts card summarizes the Contacts tab: its first rows,
  // Contoso's seeded contacts among them.
  const contactsCard = rightColumn.getByRole('region', { name: 'Contacts', exact: true });
  await contactsCard.scrollIntoViewIfNeeded();
  await expect(contactsCard.locator('[data-record-summary-row]').filter({ hasText: 'Carl Fox' })).toBeVisible();

  expect(errors, 'uncaught page errors on related-heavy detail').toEqual([]);
});
