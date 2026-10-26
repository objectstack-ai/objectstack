import { test, expect } from '@playwright/test';
import { selectOption } from './helpers';

/**
 * B2 follow-up (#1581): parent-scoped conditional rules in inline grids —
 * "paid invoice → lock lines". An invoice line column declares
 * `readonlyWhen: "parent.status == 'paid'"` on quantity / unit price / product;
 * the cell evaluates that CEL per row against the live header as `parent`, so
 * flipping the header status to "paid" locks the lines, and flipping it back
 * unlocks them.
 *
 * This is the header-driven generalization of B2 to grid cells (the row-scoped
 * variant — `record.*` — is covered by grid-conditional-rules.spec.ts). The
 * live header record is scraped from the form host and bound as `parent` by
 * <MasterDetailForm>/<MasterDetailLines>, isolated so the lock never re-renders
 * (and thus never resets) the header form.
 */
test('a line locks when the header status becomes "paid" and unlocks when it changes back', async ({ page }) => {
  await page.goto('/apps/showcase_app/showcase_invoice');
  await page.getByRole('button', { name: /^(New|新建)$/i }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('md-form-submit')).toBeVisible();

  const grid = dialog.getByTestId('line-items');
  const qty = grid.locator('input[aria-label="Qty"]').first();
  const unitPrice = grid.locator('input[aria-label="Unit Price"]').first();
  await expect(qty).toBeVisible();

  // Give the line some data so the lock is observable on a real row.
  await qty.fill('3');

  // Default (non-paid) status leaves the line editable.
  await selectOption(dialog, 'status', 'draft');
  await expect(qty).toBeEnabled();
  await expect(unitPrice).toBeEnabled();

  // Header → paid: quantity and unit price lock (parent.status == 'paid').
  await selectOption(dialog, 'status', 'paid');
  await expect(qty).toBeDisabled();
  await expect(unitPrice).toBeDisabled();
  // The locking re-render must not have wiped the typed quantity.
  await expect(qty).toHaveValue('3');

  // Header back to draft: the line is editable again.
  await selectOption(dialog, 'status', 'draft');
  await expect(qty).toBeEnabled();
  await expect(unitPrice).toBeEnabled();
});
