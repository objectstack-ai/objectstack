import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Reusable drivers for ObjectUI's interaction-critical widgets.
 *
 * These exist because synthetic DOM events (the kind ad-hoc `eval`-based
 * automation dispatches) do NOT make Radix Select / react-hook-form bind — only
 * real browser input does. Playwright dispatches real input, so these helpers
 * are the durable, deterministic way to drive forms. They target the stable
 * `data-testid`s added to SelectField / LookupField / GridField / MasterDetailForm.
 */

/** Pick an option in an ObjectUI <SelectField> (Radix Select) by field name + option value. */
export async function selectOption(scope: Page | Locator, fieldName: string, optionValue: string) {
  const page = 'page' in scope ? (scope as any).page() : (scope as Page);
  await (scope as any).getByTestId(`select-trigger-${fieldName}`).first().click();
  // Options render in a portal at the document root, so query from the page.
  const option = page.getByTestId(`select-option-${optionValue}`);
  await option.first().waitFor({ state: 'visible' });
  await option.first().click();
}

/**
 * Fill an ObjectUI <LookupField>: open the picker and choose the matching
 * record. The inline picker renders results as `role="option"` in a portal;
 * Playwright's accessible-name match is a substring, so `query` can be a prefix
 * (e.g. "North" → "Northwind").
 */
export async function fillLookup(page: Page, fieldName: string, query: string) {
  await page.getByTestId(`lookup-trigger-${fieldName}`).first().click();
  const option = page.getByRole('option', { name: new RegExp(query, 'i') }).first();
  await option.waitFor({ state: 'visible' });
  await option.click();
  // Popover closes on select; give the trigger a tick to reflect the value.
  await page.getByTestId(`lookup-trigger-${fieldName}`).first().waitFor({ state: 'visible' });
}

/** Add a line-items row and return the new (last data) row's <tr> locator. */
export async function addLineItem(page: Page): Promise<Locator> {
  const dataRows = page.getByTestId('line-items').locator('tbody tr').filter({ has: page.locator('input, [role="combobox"], button') });
  const before = await dataRows.count();
  await page.getByTestId('line-items-add').click();
  await expect(dataRows).toHaveCount(before + 1);
  return dataRows.nth(before);
}

/** Wait for (and return the text of) the next sonner toast. */
export async function expectToast(page: Page, matcher: RegExp) {
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: matcher }).first();
  await expect(toast).toBeVisible({ timeout: 10_000 });
  return (await toast.textContent())?.trim() ?? '';
}
