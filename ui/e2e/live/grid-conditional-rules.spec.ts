import { test, expect } from '@playwright/test';

/**
 * B2 in grids (A1): an inline line-item cell honors its column's `requiredWhen`
 * CEL rule, evaluated PER ROW against that row's record. The showcase Invoice
 * line declares `description.requiredWhen = "record.quantity >= 100"` — a bulk
 * line must carry a description — so a row whose quantity crosses the threshold
 * flags its (empty) Description cell required inline, and clears once filled.
 *
 * (This is the row-scoped generalization of B2 to grid cells. The header-driven
 * lock — "paid invoice → lock lines", referencing `parent` — is covered by
 * grid-parent-rules.spec.ts; see ADR-0036 and #1581.)
 */
test('a line cell flags required per row from a row-scoped requiredWhen', async ({ page }) => {
  await page.goto('/apps/showcase_app/showcase_invoice');
  await page.getByRole('button', { name: /^(New|新建)$/i }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('md-form-submit')).toBeVisible();

  const grid = dialog.getByTestId('line-items');
  const qty = grid.locator('input[aria-label="Qty"]').first();
  await expect(qty).toBeVisible();

  // Below threshold: a small qty leaves Description optional (no invalid flag).
  await qty.fill('2');
  await expect(grid.getByTestId('line-items-invalid-0-description')).toHaveCount(0);

  // Cross the threshold: quantity >= 100 ⇒ Description (still empty) flags
  // required inline on that row.
  await qty.fill('100');
  await expect(grid.getByTestId('line-items-invalid-0-description')).toBeVisible();

  // Filling Description clears the flag.
  await grid.locator('input[aria-label="Description"]').first().fill('Bulk order');
  await expect(grid.getByTestId('line-items-invalid-0-description')).toHaveCount(0);
});
