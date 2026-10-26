import { test, expect } from '@playwright/test';

/**
 * ADR-0047 — end-user filter surfaces, locked end-to-end.
 *
 * Covers the behaviors hand-verified during the ADR-0047 rounds so they
 * cannot silently regress:
 *
 *  1. Interface mode, tabs element (Task Triage page): preset filter TABS
 *     render and dropdowns do not (tabs XOR dropdowns); picking a tab filters
 *     the grid and persists as `uf__tab` in the URL; reload restores it.
 *     ADR-0053 made tabs an interface-page element: on the object's default
 *     list ("views" mode) the same presets are named views in the switcher.
 *  2. Data mode visualization switcher (showcase_task "All Tasks"): a compact
 *     dropdown in the toolbar's Display popover, offering only the whitelist.
 *  3. Interface mode (Task Workbench page): author-enabled dropdown filters
 *     only — no view tabs, no visualization switcher (single-entry
 *     whitelist = locked); selecting a value filters rows, persists as
 *     `uf_<field>`, survives reload; per-option counts do NOT zero out
 *     while the selection is active (counts snapshot).
 */

test.describe('ADR-0053 interface mode — Task Triage tabs element', () => {
  test('filter tabs render exclusively, persist to URL, and restore on reload', async ({ page }) => {
    await page.goto('/apps/showcase_app/page/showcase_task_triage');

    // The page's `userFilters.element: 'tabs'` renders preset tabs…
    const urgentTab = page.getByTestId('filter-tab-urgent');
    await expect(urgentTab).toBeVisible();
    // …and no dropdown filter badges (tabs XOR dropdowns).
    await expect(page.locator('[data-testid^="filter-badge-"]')).toHaveCount(0);

    // Picking a tab filters the grid and mirrors into the URL.
    await urgentTab.click();
    await expect(page).toHaveURL(/uf__tab=urgent/);
    await expect(page.getByTestId('record-count-bar')).toContainText(/^2 /, { timeout: 15000 });

    // Reload: the tab selection and its filter survive.
    await page.reload();
    await expect(page).toHaveURL(/uf__tab=urgent/);
    await expect(page.getByTestId('record-count-bar')).toContainText(/^2 /, { timeout: 15000 });
  });
});

test.describe('ADR-0047 data mode — viz dropdown', () => {
  test('visualization switcher is a single dropdown offering the whitelist', async ({ page }) => {
    await page.goto('/apps/showcase_app/showcase_task');

    // The switcher lives in the toolbar's Display popover.
    await page.getByTestId('toolbar-display-trigger').click();
    const trigger = page.getByTestId('view-switcher-dropdown');
    await expect(trigger).toBeVisible();
    await trigger.click();
    // The open switcher's own list, found through the trigger's aria-controls.
    const menu = page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);

    // Whitelist: the default task list's `appearance.allowedVisualizations`
    // (grid, kanban, gallery, calendar, timeline, gantt) — and nothing else.
    // Map and chart are declared on this object as their own named views and
    // stay out of the switcher.
    await expect(menu.getByRole('button')).toHaveText(['Grid', 'Kanban', 'Gallery', 'Calendar', 'Timeline', 'Gantt']);

    // Switching actually swaps the renderer; the trigger names the new one.
    await menu.getByRole('button', { name: 'Kanban' }).click();
    await page.getByTestId('toolbar-display-trigger').click();
    await expect(trigger).toContainText('Kanban');
  });
});

test.describe('ADR-0047 interface mode — Task Workbench', () => {
  test('locked surface: dropdowns only, no view tabs, no switcher', async ({ page }) => {
    await page.goto('/apps/showcase_app/page/showcase_task_workbench');

    await expect(page.getByTestId('interface-list-page')).toBeVisible();
    await expect(page.getByTestId('filter-badge-status')).toBeVisible();
    await expect(page.getByTestId('filter-badge-priority')).toBeVisible();
    // Single-entry visualization whitelist renders no switcher.
    await expect(page.getByTestId('view-switcher-dropdown')).toHaveCount(0);
  });

  test('grid renders data columns even when the source view is hollow', async ({ page }) => {
    // Regression: some backends serve the referenced default view without
    // columns (they live only in named views). The interface page must fall
    // back to object-derived columns instead of rendering a bare # column.
    await page.goto('/apps/showcase_app/page/showcase_task_workbench');

    await expect(page.getByTestId('interface-list-page')).toBeVisible();
    const headers = page.locator('table thead th');
    // More than just the row-number column.
    await expect(async () => {
      expect(await headers.count()).toBeGreaterThan(2);
    }).toPass({ timeout: 15000 });
    // The title/assignee business fields are present (not only "#"). The table
    // is `role="grid"`, so its cells are gridcells.
    await expect(page.getByRole('gridcell', { name: /example\.com/ }).first()).toBeVisible();
  });

  test('dropdown selection filters, keeps counts, persists, and restores', async ({ page }) => {
    await page.goto('/apps/showcase_app/page/showcase_task_workbench');

    // Open the priority dropdown (showCount: true) and capture pre-selection state.
    await page.getByTestId('filter-badge-priority').click();
    const options = page.getByTestId('filter-options-priority');
    await expect(options).toBeVisible();
    await expect(options.getByText('Urgent')).toBeVisible();

    // Select Urgent: the grid narrows and the URL picks up the selection.
    await options.getByText('Urgent').click();
    await expect(page).toHaveURL(/uf_priority=urgent/);
    await expect(page.getByTestId('record-count-bar')).toContainText(/^2 /, { timeout: 15000 });

    // Counts snapshot: with Urgent active the OTHER options keep their
    // pre-selection counts instead of collapsing to 0 (the server already
    // filtered the rows; the popover replays the snapshot).
    const optionRows = options.locator('label');
    const texts = await optionRows.allTextContents();
    const nonUrgent = texts.filter(t => !/Urgent/.test(t));
    expect(nonUrgent.length).toBeGreaterThan(0);
    // Every non-selected option still shows a non-zero count.
    for (const t of nonUrgent) {
      expect(t).not.toMatch(/\b0\b/);
    }

    // Reload: badge selection state and the filtered result set survive.
    await page.reload();
    await expect(page).toHaveURL(/uf_priority=urgent/);
    await expect(page.getByTestId('filter-badge-priority')).toContainText('1');
    await expect(page.getByTestId('record-count-bar')).toContainText(/^2 /, { timeout: 15000 });
  });
});
