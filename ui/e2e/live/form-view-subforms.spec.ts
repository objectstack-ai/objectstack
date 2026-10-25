import { test, expect } from '@playwright/test';
import { selectOption, fillLookup } from './helpers';

/**
 * Tier 0 live e2e: an object's standard New/Edit modal renders inline child
 * collections derived from the DATA MODEL (no view config, no bespoke page).
 * `showcase_invoice_line.invoice` declares `inlineEdit: 'grid'`, so every
 * standard Invoice form auto-renders a spreadsheet-style "Line Items" grid;
 * "New Invoice" opens a master-detail modal that submits the header + its
 * lines in one atomic /api/v1/batch.
 *
 * This exercises the full modern grid:
 *   • the trailing "ghost" row — type straight into it, no "Add line" click;
 *   • a Product catalog typeahead whose selection auto-fills the line's
 *     description + unit_price (matching field names);
 *   • the computed read-only `amount = quantity × unit_price`, recomputed live
 *     and persisted in the batch (so the parent total rolls it up server-side).
 */
test('New <object> modal renders relationship-derived subforms and submits an atomic batch', async ({ page }) => {
  const batches: any[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/v1/batch')) {
      try { batches.push(r.postDataJSON()); } catch { /* ignore */ }
    }
  });

  await page.goto('/apps/showcase_app/showcase_invoice');
  await page.getByRole('button', { name: /^New$/i }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('md-form-submit')).toBeVisible();
  // The section's heading, by role: a bare text match also hits the dialog's
  // sr-only description ("…its line items, then save.") and fails strict mode.
  await expect(dialog.getByRole('heading', { name: 'Line Items' })).toBeVisible();

  const name = `INV-${Date.now()}`;
  await dialog.locator('input[name="name"]').fill(name);
  await fillLookup(page, 'account', 'North');
  await selectOption(page, 'status', 'draft');
  await expect(dialog.getByText('Northwind', { exact: false }).first()).toBeVisible();

  // Pick a catalog product in the ghost row — its description + unit_price
  // auto-fill, and the row materialises (no "Add line" click).
  const li = dialog.getByTestId('line-items');
  await li.getByTestId('lookup-trigger').first().click();
  const option = page.getByRole('option', { name: /Widget A/i }).first();
  await option.waitFor({ state: 'visible' });
  await option.click();

  // Auto-filled from the product record.
  await expect(li.locator('input[aria-label="Unit Price"]').first()).toHaveValue('29.99');
  await expect(li.locator('input[aria-label="Description"]').first()).toHaveValue('Standard widget');

  await li.locator('input[aria-label="Qty"]').first().fill('2');
  // Computed Amount = 2 × 29.99 (read-only).
  await expect(li.locator('[data-computed="amount"]').first()).toContainText('59.98');

  // Document totals stack: set the header tax rate → Subtotal / Tax / Total.
  await dialog.locator('input[name="tax_rate"]').fill('10');
  await expect(dialog.getByTestId('md-subtotal')).toContainText('59.98');
  await expect(dialog.getByTestId('md-tax')).toContainText('6.00');        // 10% of 59.98 → 5.998 ≈ 6.00
  await expect(dialog.getByTestId('md-grand-total')).toContainText('65.98'); // 59.98 + 5.998

  await Promise.all([
    page.waitForRequest((r) => r.url().includes('/api/v1/batch'), { timeout: 15_000 }).catch(() => null),
    dialog.getByTestId('md-form-submit').click(),
  ]);
  await page.waitForTimeout(500);

  expect(batches.length).toBeGreaterThan(0);
  const ops = batches[0].operations;
  expect(ops[0]).toMatchObject({ object: 'showcase_invoice', action: 'create' });
  expect(ops[0].data.name).toBe(name);
  expect(ops[0].data.status).toBe('draft');
  const child = ops.find((o: any) => o.object === 'showcase_invoice_line');
  expect(child?.data?.invoice).toEqual({ $ref: 0 });
  expect(child?.data?.product).toBeTruthy();                 // the chosen product id
  expect(child?.data?.description).toBe('Standard widget');  // auto-filled
  expect(Number(child?.data?.unit_price)).toBe(29.99);       // auto-filled
  expect(Number(child?.data?.amount)).toBe(59.98);           // computed (2 × 29.99)
  expect(Number(child?.data?.position)).toBe(0);             // sort position stamped from row order
  // The empty ghost line must NOT have been persisted as a blank child.
  expect(ops.filter((o: any) => o.object === 'showcase_invoice_line')).toHaveLength(1);
});
