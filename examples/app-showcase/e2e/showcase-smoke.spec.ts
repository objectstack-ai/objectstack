import { test, expect } from '@playwright/test';

/**
 * Showcase workspace smoke — sweeps every nav surface and asserts the health
 * invariants manual QA otherwise eyeballs (render crash / leaked dev placeholder
 * / collapsed chart). Runs against the console the backend serves at /_console
 * (baseURL set in playwright.config.ts). Non-blocking nightly + manual.
 */

// Ambient `process` for the env read below — the showcase tsconfig doesn't pull
// in `@types/node`, and the package-global shim in types/node-shim.d.ts declares
// only `cwd()`. Same idiom (and same reason) as the declarations in
// objectstack.config.ts and src/system/self-url.ts: keeps `pnpm typecheck` green
// without widening the type surface. Playwright provides the real `process`.
declare const process: { env: Record<string, string | undefined> };

const APP = process.env.SHOWCASE_APP || 'com.example.showcase';
const base = (seg: string) => `/_console/apps/${APP}/${seg}`;
/**
 * An `ObjectNavItem.filters` slice, spelled the way objectui's nav renderer
 * builds its href: the bare data surface (`/:objectName/data`) with one
 * `filter[<field>]=<value>` search param per entry, URLSearchParams-encoded.
 */
const slice = (objectName: string, filters: Record<string, string>) => {
  const usp = new URLSearchParams();
  for (const [field, value] of Object.entries(filters)) usp.set(`filter[${field}]`, value);
  return base(`${objectName}/data?${usp.toString()}`);
};

const SURFACES: { name: string; path: string; chart?: boolean }[] = [
  { name: 'Capability Map', path: base('page/showcase_capability_map') },
  { name: 'My Work', path: base('page/showcase_my_work') },
  { name: 'Approvals', path: base('page/showcase_review_queue') },
  { name: 'New Project Wizard', path: base('page/showcase_new_project_wizard') },
  { name: 'Settings', path: base('showcase_preference') },
  { name: 'Projects', path: base('showcase_project') },
  { name: 'Tasks', path: base('showcase_task') },
  { name: 'Accounts', path: base('showcase_account') },
  { name: 'Invoices', path: base('showcase_invoice') },
  { name: 'Products', path: base('showcase_product') },
  { name: 'Teams', path: base('showcase_team') },
  { name: 'Categories', path: base('showcase_category') },
  { name: 'Field Zoo', path: base('showcase_field_zoo') },
  { name: 'Delivery Operations', path: base('dashboard/showcase_ops_dashboard'), chart: true },
  { name: 'Chart Gallery', path: base('dashboard/showcase_chart_gallery'), chart: true },
  { name: 'Command Center', path: base('page/showcase_command_center'), chart: true },
  { name: 'Hours by Status', path: base('report/showcase_hours_by_status') },
  { name: 'Status × Priority', path: base('report/showcase_status_priority_matrix') },
  { name: 'Task Overview', path: base('report/showcase_task_overview') },
  { name: 'Component Gallery', path: base('page/showcase_component_gallery') },
  { name: 'Project Workspace', path: base('page/showcase_project_workspace') },
  { name: 'Task Workbench', path: base('page/showcase_task_workbench') },
  { name: 'Task Triage', path: base('page/showcase_task_triage') },
  { name: 'Active Projects', path: base('page/showcase_active_projects') },
  { name: 'All Views', path: base('page/showcase_task_all_views') },
  { name: 'Task Board', path: base('page/showcase_task_board') },
  { name: 'Task Calendar', path: base('page/showcase_task_calendar') },
  { name: 'Task Gallery', path: base('page/showcase_task_gallery') },
  { name: 'Team Schedule', path: base('page/showcase_task_schedule') },
  { name: 'Activity Timeline', path: base('page/showcase_task_timeline') },
  { name: 'Work Map', path: base('page/showcase_task_map') },
  // [#21060] The 18 served destinations the list above did not reach. Measured
  // against `showcase_app`'s navigation (src/ui/apps/index.ts): 49 leaf items,
  // 31 of them listed above, and these 18 hand-walked clean by QA run #21056.
  // Names are the nav labels, except where a label repeats one above.
  { name: 'Page Authoring', path: base('page/showcase_start_here') },
  { name: 'Contacts', path: base('showcase_contact') },
  { name: 'Expense Reports', path: base('showcase_expense_report') },
  { name: 'Business Units', path: base('showcase_business_unit') },
  { name: 'Cascading Select', path: base('showcase_cascade') },
  { name: 'In-Progress Tasks', path: slice('showcase_task', { status: 'in_progress' }) },
  { name: 'Urgent Tasks', path: slice('showcase_task', { priority: 'urgent' }) },
  { name: 'In-Review Tasks', path: slice('showcase_task', { status: 'in_review' }) },
  { name: 'Revenue Pulse', path: base('dashboard/showcase_revenue_pulse'), chart: true },
  { name: 'Task List', path: base('showcase_task/view/tabular') },
  { name: 'Hours by Status (Chart)', path: base('report/showcase_hours_by_status_chart'), chart: true },
  { name: 'Styling Gallery', path: base('page/showcase_styling_gallery') },
  { name: 'Page Variables', path: base('page/showcase_page_variables') },
  { name: 'Contact Form', path: base('page/showcase_contact_form') },
  { name: 'Command Center (JSX)', path: base('page/showcase_command_center_jsx') },
  { name: 'CRM Workbench', path: base('page/showcase_crm_workbench') },
  { name: 'Task Desk', path: base('page/showcase_task_desk') },
  { name: 'Renewals Pipeline', path: base('page/showcase_renewals_pipeline') },
];

/**
 * The console's boot splash — objectui app-shell's `LoadingScreen`, which the
 * shell also renders as a `Suspense` fallback INSIDE its `<main>` — reads
 * "Initializing application…" under the default locale. Its text is not empty,
 * so a check of "main has text" passed on a surface that had not rendered at
 * all: QA run #21056 read the splash as the FIRST `<main>` text on 22 of 49
 * surfaces. The wait below treats the splash as not-yet-rendered, and the
 * assertions refuse a surface that is still on it at the deadline.
 */
const BOOT_SPLASH = /Initializing application/i;

/**
 * The budget every wait in this file spends, measured from the start of the
 * surface that calls it — and the SOURCE of each wait's deadline, rather than
 * one more number chosen in advance. It sits inside the config's 45s per-test
 * `timeout`, which stays the only wall-clock budget left to expire after it.
 *
 * ⛔ Never put a fixed wall-clock wait back in front of an assertion here. The
 * shape this replaced was `await page.waitForTimeout(1500)` followed by a
 * SINGLE `boundingBox()` read, and #7569 measured what that costs: across 3
 * fresh loads each drawing 5 real charts, polling every 400 ms returned null
 * ONLY at t = 1.5 s — precisely the instant this suite measured at, and
 * precisely the recharts `ResponsiveContainer` initial-layout window — and
 * non-null on all 19 later samples; the same surfaces re-run in isolation were
 * 4/4 green. So the assertion reported a failing surface whenever the fixed
 * wait landed inside the layout window: a coin-flip red on a correct product,
 * costing a triage cycle every run. A bigger fixed number is not the fix — the
 * budget is a constant while the thing it times is not. Wait on a predicate
 * the page can actually satisfy, bounded by a deadline.
 */
const SURFACE_BUDGET_MS = 25_000;
const POLL_MS = 100;

const surfaceDeadline = (): number => Date.now() + SURFACE_BUDGET_MS;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `probe` until it returns a truthy value, or until `deadline`. Returns
 * whatever the last sample was either way, so the CALLER still asserts on it —
 * a timeout then fails as the assertion it belongs to, naming the surface,
 * instead of as a bare timeout that says nothing about what was missing.
 */
async function pollUntil<T>(probe: () => Promise<T>, deadline: number): Promise<T> {
  let sample = await probe();
  while (!sample && Date.now() < deadline) {
    await sleep(POLL_MS);
    sample = await probe();
  }
  return sample;
}

for (const surface of SURFACES) {
  test(`surface renders cleanly: ${surface.name}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    const deadline = surfaceDeadline();
    await page.goto(surface.path, { waitUntil: 'domcontentloaded' });
    const main = page.locator('main').first();
    await main.waitFor({ state: 'visible', timeout: SURFACE_BUDGET_MS });

    // Replaces the fixed 1500 ms settle with a wait on the thing the assertion
    // below actually needs — rendered main content — on the same deadline.
    // [#21060] Rendered means past the boot splash, not merely non-empty: the
    // splash is text too. The last sample is kept whatever it was, so a surface
    // stuck on the splash fails as exactly that rather than as "no content".
    let mainText = '';
    await pollUntil(async () => {
      mainText = ((await main.innerText().catch(() => '')) || '').trim();
      return mainText.length > 0 && !BOOT_SPLASH.test(mainText);
    }, deadline);

    let chartBox: { width: number; height: number } | null = null;
    if (surface.chart) {
      const svg = page.locator('.recharts-wrapper svg, .recharts-surface').first();
      await svg.waitFor({ state: 'visible', timeout: SURFACE_BUDGET_MS });
      // `visible` commits before ResponsiveContainer has sized its child, which
      // is why reading the box once lands inside the layout window. Poll it
      // instead, and keep the last non-null sample: a chart that IS laid out but
      // collapsed must still fail on its width (#2616 D below) rather than be
      // reported as "no chart SVG", which is a different defect.
      let lastSeen: { width: number; height: number } | null = null;
      const laidOut = await pollUntil(async () => {
        const box = await svg.boundingBox();
        if (box) lastSeen = box;
        return box && box.width > 200 && box.height > 0 ? box : null;
      }, deadline);
      chartBox = laidOut ?? lastSeen;
    }

    // Asserted after the waits above, so the error-collection window is as long
    // as the render actually took rather than a fixed slice of it.
    expect(pageErrors, `uncaught errors on ${surface.name}`).toEqual([]);
    await expect(
      page.getByText(/no actions configured/i),
      `leaked placeholder on ${surface.name}`,
    ).toHaveCount(0);
    expect(mainText.length, `${surface.name} rendered no main content`).toBeGreaterThan(0);
    expect(mainText, `${surface.name} never got past the boot splash`).not.toMatch(BOOT_SPLASH);

    if (surface.chart) {
      expect(
        chartBox,
        `${surface.name}: no chart SVG laid out within ${SURFACE_BUDGET_MS}ms`,
      ).not.toBeNull();
      // >0 alone previously passed even on a collapsed ~130px-wide chart panel
      // (#2616 D) — require a width a real chart panel would actually have.
      expect(chartBox!.width, `${surface.name}: chart width`).toBeGreaterThan(200);
      expect(chartBox!.height, `${surface.name}: chart height`).toBeGreaterThan(0);
    }
  });
}
