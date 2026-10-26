import { test, expect, type Page } from '@playwright/test';

/**
 * B3 browser e2e: cascading / dependent `select` options (#1583).
 *
 * Drives the shipped `fields-select/cascading-options` example
 * (`country` → `province`) rendered live on the docs site — the same form
 * renderer and the same `@objectstack/formula` per-option `visibleWhen`
 * filtering an app uses, with **no backend**. This is the piece JSDOM component
 * tests can't reach: opening a real dropdown and asserting the *offered set*
 * changes as the controlling field changes, plus the cascade-clear of a
 * now-invalid child value.
 *
 * The docs site (Next.js) must be served separately — e.g.
 * `pnpm --filter @object-ui/site dev` — and pointed at via `DOCS_BASE_URL`
 * (default `http://localhost:3000`). If it's unreachable the suite auto-skips,
 * mirroring `docs-smoke.spec.ts`. The equivalent live-backend e2e (a cascading
 * pair on a real showcase object, with the server rejecting an out-of-set
 * value) is tracked framework-side in #1583.
 */

const DOCS_BASE = process.env.DOCS_BASE_URL || 'http://localhost:3000';
const SELECT_PAGE = `${DOCS_BASE}/docs/fields/select`;

let docsAvailable = false;
test.beforeAll(async () => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(`${DOCS_BASE}/docs`, { signal: controller.signal });
    clearTimeout(timer);
    docsAvailable = response.ok;
  } catch {
    docsAvailable = false;
  }
});

/** The Radix Select trigger for a form field, scoped by its `field:<name>` wrapper. */
const trigger = (page: Page, field: string) =>
  page.locator(`[data-testid="field:${field}"] [role="combobox"]`);

/** Open `field`'s dropdown, return the offered option labels (sorted), then close it. */
async function offeredOptions(page: Page, field: string): Promise<string[]> {
  await trigger(page, field).click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const labels = (await page.getByRole('option').allInnerTexts()).map((s) => s.trim());
  await page.keyboard.press('Escape');
  await expect(listbox).toBeHidden();
  return labels.sort();
}

/** Open `field`'s dropdown and pick the option named `name`. */
async function pick(page: Page, field: string, name: RegExp): Promise<void> {
  await trigger(page, field).click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await page.getByRole('option', { name }).click();
  await expect(listbox).toBeHidden();
}

test('province options re-filter live as country changes, and a stale value clears', async ({ page }) => {
  test.skip(!docsAvailable, 'Docs site is not reachable (set DOCS_BASE_URL)');

  await page.goto(SELECT_PAGE, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const country = trigger(page, 'country');
  await country.scrollIntoViewIfNeeded();
  await expect(country).toBeVisible();
  // Let the client-side renderer hydrate before driving the Radix control — a
  // pre-hydration click is dropped and the dropdown never opens.
  await expect(country).toBeEnabled();
  await page.waitForTimeout(1500);

  // --- Gated: while country is unset the dependent province control is withheld. ---
  await expect(trigger(page, 'province')).toHaveCount(0);

  // --- country = China → only Chinese provinces are offered. ---
  await pick(page, 'country', /china/i);
  await expect(trigger(page, 'province')).toBeVisible();
  expect(await offeredOptions(page, 'province')).toEqual(['Guangdong', 'Zhejiang']);

  // Choose one so we can prove the cascade-clear on the next parent change.
  await pick(page, 'province', /zhejiang/i);
  await expect(trigger(page, 'province')).toContainText(/zhejiang/i);

  // --- country = United States → the offered set flips and the stale value clears. ---
  await pick(page, 'country', /united states/i);
  expect(await offeredOptions(page, 'province')).toEqual(['California', 'Texas']);
  // 'Zhejiang' is no longer offered under country=us, so the widget dropped it.
  await expect(trigger(page, 'province')).not.toContainText(/zhejiang/i);
});
