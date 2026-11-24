import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Live e2e: the record header in two rows (objectstack-ai/objectstack#35853).
 *
 * Row 1, the navigation row (40 px): ↑ / ↓ and 「第 N 条，共 M 条 · 视图名」 when
 * the record was opened from a list, the object when it was not, and ✕ at the
 * far right on every face (with 「整页打开」 before it in the drawer). Row 2, the
 * record row (48 px): the icon, the record's name one size larger, its chips,
 * and its actions — three authored buttons by default, folding into ⋯ when the
 * row is too narrow for them. The page's first row of content (its tab row)
 * starts right under the header, with no blank band (objectstack#35745: at most
 * 12 px). On a phone the bar is the one-row phone bar.
 *
 * Drives the real Console against the real showcase backend. The task record
 * page (`showcase_task_detail`) authors three `record_header` actions; the
 * account page is synthesized, with a tab row.
 */

const APP = 'com.example.showcase';
const NAME = '[data-testid="primary-field-link"]';
const BAR = '[data-record-top-bar-rows="2"]';
const NAV = '[data-record-top-bar-nav]';
const RECORD = '[data-record-top-bar-record]';

async function openFromList(page: Page, object: string, index = 1) {
  await page.goto(`/apps/${APP}/${object}`);
  await expect(page.locator(NAME).nth(index + 1)).toBeVisible();
  const name = (await page.locator(NAME).nth(index).textContent())!.trim();
  await page.locator(NAME).nth(index).click();
  await expect(page.locator(BAR)).toBeVisible();
  return name;
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  expect(b, 'element has a box').toBeTruthy();
  return b!;
}

/** Every visible authored button sits on one line: the toolbar does not wrap. */
async function actionsOnOneLine(scope: Locator) {
  return scope.locator('[data-record-top-bar-actions]').evaluate((el) => {
    const tops = [...el.querySelectorAll('button')]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => Math.round(b.getBoundingClientRect().top));
    return tops.length > 0 && tops.every((t) => t === tops[0]);
  });
}

test.describe('record header at 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a page opened from a list: navigation row over record row, ✕ at the far right', async ({ page }) => {
    const name = await openFromList(page, 'showcase_account');
    const bar = page.locator(BAR);
    const nav = bar.locator(NAV);
    const record = bar.locator(RECORD);

    // Two rows, 40 then 48, the navigation row on top.
    const navBox = await box(nav);
    const recordBox = await box(record);
    expect(Math.round(navBox.height)).toBe(40);
    expect(Math.round(recordBox.height)).toBe(48);
    expect(recordBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);

    // Row 1 holds the way through the list, not the record.
    await expect(nav.locator('[data-record-top-bar-step="previous"]')).toBeVisible();
    await expect(nav.locator('[data-record-top-bar-step="next"]')).toBeVisible();
    await expect(nav.locator('[data-record-top-bar-position]')).toHaveText(/^2 of \d+$/);
    await expect(nav.locator('[data-record-top-bar-scope]')).toHaveText('All Records');
    await expect(nav).not.toContainText(name);

    // ✕ is the last thing on row 1, at its right edge.
    const close = nav.getByTestId('record-page-close');
    await expect(close).toBeVisible();
    const closeBox = await box(close);
    expect(navBox.x + navBox.width - (closeBox.x + closeBox.width)).toBeLessThanOrEqual(12);

    // Row 2 holds the record: its name, one size larger (16 px), and its actions.
    const title = record.locator('[data-record-top-bar-title]');
    await expect(title).toContainText(name);
    const fontSize = await title.locator('h1, [data-record-page-title]').first().evaluate((e) => getComputedStyle(e).fontSize);
    expect(fontSize).toBe('16px');
    await expect(record.getByRole('button', { name: 'Edit' })).toBeVisible();

    // objectstack#35745 — no blank band between the header and the tab row.
    const tabs = page.locator('[data-record-tab-row]').first();
    await expect(tabs).toBeVisible();
    const barBox = await box(bar);
    const tabsBox = await box(tabs);
    expect(tabsBox.y - (barBox.y + barBox.height)).toBeLessThanOrEqual(12);
  });

  test('a page opened with no list: the object on row 1, ✕ to its list, no stepper', async ({ page }) => {
    await page.goto(`/apps/${APP}/showcase_account`);
    const href = await page.locator(NAME).nth(1).getAttribute('href');
    await page.goto(href!);
    const nav = page.locator(BAR).locator(NAV);

    await expect(nav.getByTestId('record-page-crumb')).toBeVisible();
    await expect(nav.locator('[data-record-top-bar-stepper]')).toHaveCount(0);
    await expect(nav.getByTestId('record-page-close')).toBeVisible();

    await nav.getByTestId('record-page-close').click();
    await expect(page).toHaveURL(new RegExp(`/apps/${APP.replace(/\./g, '\\.')}/showcase_account(/view/[^/?#]+)?([?#].*)?$`));
  });

  test('the header shows three authored actions by default, on one line', async ({ page }) => {
    // The task page authors Mark Done, Log Time and Archive as record_header
    // actions (Mark Done hides on a finished task), plus the host's Edit.
    await openFromList(page, 'showcase_task', 2);
    const record = page.locator(BAR).locator(RECORD);
    const actions = record.locator('[data-record-top-bar-actions]');

    await expect(actions.getByRole('button', { name: 'Log Time' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Archive' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Edit' })).toBeVisible();
    // The authored actions beyond three, and record_more, are under ⋯.
    await expect(actions.getByRole('button', { name: /more/i })).toBeVisible();
    expect(await actionsOnOneLine(record)).toBe(true);
  });

  test('in the drawer: the same two rows, 「整页打开」 and ✕ at the far right, the tabs right under', async ({ page }) => {
    await page.goto(`/apps/${APP}/showcase_account`);
    const row = page.locator(NAME).nth(1);
    const name = (await row.textContent())!.trim();
    await row.hover();
    await page.locator('[data-testid="record-open-in-panel"]').nth(1).click();

    const card = page.locator('[data-record-drawer-card]');
    const bar = card.locator(BAR);
    await expect(bar).toBeVisible();
    const nav = bar.locator(NAV);
    await expect(nav.locator('[data-record-top-bar-position]')).toHaveText(/^2 of \d+$/);
    await expect(nav.locator('[data-record-top-bar-scope]')).toHaveText('All Records');
    await expect(bar.locator(RECORD).locator('[data-record-top-bar-title]')).toContainText(name);

    const frame = nav.locator('[data-record-top-bar-frame] button');
    await expect(frame).toHaveCount(2);
    await expect(frame.nth(0)).toHaveAttribute('data-testid', 'record-pane-open-page');
    const navBox = await box(nav);
    const closeBox = await box(frame.nth(1));
    expect(navBox.x + navBox.width - (closeBox.x + closeBox.width)).toBeLessThanOrEqual(12);

    const tabs = card.locator('[data-record-tab-row]').first();
    await expect(tabs).toBeVisible();
    const barBox = await box(bar);
    expect((await box(tabs)).y - (barBox.y + barBox.height)).toBeLessThanOrEqual(12);
    expect(await actionsOnOneLine(bar.locator(RECORD))).toBe(true);

    // ↓ steps to the next record of the list inside the drawer.
    await nav.locator('[data-record-top-bar-step="next"]').click();
    await expect(nav.locator('[data-record-top-bar-position]')).toHaveText(/^3 of \d+$/);
  });

  test('a narrow drawer folds actions that do not fit into ⋯ instead of wrapping', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto(`/apps/${APP}/showcase_task`);
    const row = page.locator(NAME).nth(2);
    await row.hover();
    await page.locator('[data-testid="record-open-in-panel"]').nth(2).click();
    const record = page.locator('[data-record-drawer-card]').locator(BAR).locator(RECORD);
    await expect(record.locator('[data-record-top-bar-actions]')).toBeVisible();
    await expect.poll(() => actionsOnOneLine(record)).toBe(true);
    // The title keeps its room: it is not squeezed off the row.
    expect((await box(record.locator('[data-record-top-bar-title]'))).width).toBeGreaterThanOrEqual(120);
  });
});

test.describe('record header at 390 px (touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the phone bar is one row and does not overflow the screen', async ({ page }) => {
    await page.goto(`/apps/${APP}/showcase_account`);
    const card = page.getByTestId('grid-mobile-card').nth(1);
    await expect(card).toBeVisible();
    await card.getByTestId('grid-card-title').tap();

    const bar = page.locator('[data-record-top-bar]').first();
    await expect(bar).toBeVisible();
    await expect(page.locator(BAR)).toHaveCount(0);
    await expect(bar.locator('[data-record-top-bar-position]')).toHaveText(/^2 \/ \d+$/);
    const b = await box(bar);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
