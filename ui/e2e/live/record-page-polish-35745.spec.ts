import { test, expect, type Page } from '@playwright/test';

/**
 * Live e2e for the record page polish of objectstack#35745 and
 * objectstack#35816, on the showcase Expense Report against the REAL stack:
 *
 *   1. the tab row follows the header with no blank band: the tabs start at
 *      most 12 px below the top of the page scroller (it used to be 48 px,
 *      the scroller's and the column layout's 24 px paddings stacked);
 *   2. a business `date` with no declared `format` reads as the date, with
 *      its year, and keeps the relative phrase as its tooltip;
 *   3. in the edit state Save is the one filled button, after Cancel;
 *   4. a line added to the Expense Lines table starts on the child object's
 *      defaults (Category "Other", Status "Submitted") with no cell flagged
 *      red, and a line added and left as it came is not stored by the save,
 *      which says so.
 *
 * ⚠️ Layout is the reason this is a Playwright spec: jsdom lays nothing out,
 * so the 12 px is read here off real boxes. The vitest pins
 * (`RecordPageColumns.test.tsx`, `RecordDetailView.topInset-35745`,
 * `DetailSection.dateYear-27520`, `page-header-primary-12617`, `GridField`,
 * `RecordBodyTableEditor.recordEditBatch-35599`) hold each rule's classes and
 * state transitions.
 *
 * The report is created through the API (draft, so no approval locks it) and
 * deleted at the end; `request` carries the session cookie of the storageState.
 */
const API = process.env.LIVE_API_URL || 'http://localhost:3000';
const OBJECT = 'showcase_expense_report';
const LINE = 'showcase_expense_line';

/** `YYYY-MM-DD` of the browser's local day `offset` days from today. */
function localDay(offset: number): { iso: string; date: Date } {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { iso, date: d };
}

async function openRecord(page: Page, id: string, name: string) {
  await page.goto(`/apps/showcase_app/${OBJECT}/record/${encodeURIComponent(id)}`);
  await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('tablist').first()).toBeVisible();
}

test.use({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });

test('record page polish (#35745, #35816) — showcase Expense Report', async ({ page, request }) => {
  test.setTimeout(180_000);

  const name = `Polish e2e ${Date.now()}`;
  const day = localDay(-3);
  const createRes = await request.post(`${API}/api/v1/data/${OBJECT}`, {
    data: { name, status: 'draft', submitted_on: day.iso },
  });
  expect(createRes.ok(), await createRes.text()).toBeTruthy();
  const created = await createRes.json();
  const id: string = created.id ?? created.record?.id ?? created.data?.id;
  expect(id, 'created report id').toBeTruthy();

  try {
    await openRecord(page, id, name);

    // ── 1. No band above the tabs. ──
    const gap = await page.getByRole('tablist').first().evaluate((tabs) => {
      let scroller: HTMLElement | null = tabs.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      const h1 = document.querySelector('h1')!.getBoundingClientRect();
      return {
        tabsTop: tabs.getBoundingClientRect().top,
        scrollerTop: scroller ? scroller.getBoundingClientRect().top : NaN,
        titleBottom: h1.bottom,
      };
    });
    expect(gap.tabsTop, 'the tabs sit below the record title').toBeGreaterThan(gap.titleBottom);
    expect(gap.tabsTop - gap.scrollerTop, 'tabs → top of the page scroller').toBeLessThanOrEqual(12);

    // ── 2. The business date reads as the date; the phrase is its tooltip. ──
    const written = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(day.date);
    const dateCell = page.getByText(written, { exact: true }).first();
    await expect(dateCell).toBeVisible();
    await expect(dateCell).toHaveAttribute('title', '3 days ago');
    await expect(page.getByText('3 days ago', { exact: true })).toHaveCount(0);

    // ── 3. Edit state: Cancel, then Save, Save the one filled button. ──
    const toolbar = page.getByRole('toolbar', { name: 'Page header actions' });
    await toolbar.getByRole('button', { name: 'Edit', exact: true }).click();
    const save = toolbar.getByRole('button', { name: 'Save', exact: true });
    const cancel = toolbar.getByRole('button', { name: 'Cancel', exact: true });
    await expect(save).toBeVisible();
    const order = await toolbar.getByRole('button').evaluateAll((els) =>
      els.map((b) => ({ text: (b.textContent || '').trim(), filled: b.className.includes('bg-primary') })),
    );
    const cancelAt = order.findIndex((b) => b.text === 'Cancel');
    const saveAt = order.findIndex((b) => b.text === 'Save');
    expect(cancelAt, JSON.stringify(order)).toBeGreaterThanOrEqual(0);
    expect(saveAt, JSON.stringify(order)).toBeGreaterThan(cancelAt);
    expect(order.filter((b) => b.filled).map((b) => b.text)).toEqual(['Save']);
    await expect(cancel).not.toHaveClass(/bg-primary/);

    // ── 4. A new line starts on its defaults, unflagged; left as it came, it is not stored. ──
    const editor = page.locator('[data-body-table-editor]').first();
    await editor.scrollIntoViewIfNeeded();
    const lines = editor.locator('tbody tr');
    const before = await lines.count();
    await editor.getByTestId('line-items-add').click();
    await expect(lines).toHaveCount(before + 1);
    // The grid keeps a trailing entry line, so the added line is the one before it.
    const added = lines.nth(before - 1);
    await expect(added).toContainText('Other');
    await expect(added).toContainText('Submitted');
    await expect(editor.locator('[data-testid^="line-items-invalid"]')).toHaveCount(0);

    await save.click();
    await expect(toolbar.getByRole('button', { name: 'Edit', exact: true })).toBeVisible({ timeout: 15_000 });
    // objectstack#35940 (ruling 7056413638): the save says the line was left out.
    await expect(page.getByText('1 blank line was not saved')).toBeVisible();
    // Asked of the server for this report's lines only: a filter the route
    // ignored would answer other reports' lines, and fail the count.
    const ofThisReport = encodeURIComponent(JSON.stringify([['expense_report', 'equals', id]]));
    const stored = await request.get(`${API}/api/v1/data/${LINE}?$filter=${ofThisReport}`);
    expect(stored.ok(), await stored.text()).toBeTruthy();
    const body = await stored.json();
    const rows: any[] = body.records ?? body.data ?? [];
    expect(rows, 'an added line left on its defaults is not stored').toHaveLength(0);
  } finally {
    await request.delete(`${API}/api/v1/data/${OBJECT}/${encodeURIComponent(id)}`);
  }
});
