import { test, expect } from '@playwright/test';
import { selectOption, fillLookup } from './helpers';

/**
 * B2 (A2): a `requiredWhen` field is enforced at SUBMIT — the form renderer
 * registers react-hook-form's `required` rule from the resolved (CEL) required
 * state, so attempting to save while the predicate is TRUE and the value is
 * empty blocks submission and attaches the error to that field.
 *
 * Showcase Invoice: issued_on.requiredWhen = "record.status in ['sent','paid']".
 * Status=sent + empty Issued On ⇒ submit blocked, "Issued On is required".
 * Status=draft (predicate FALSE) ⇒ no such error.
 */
test('requiredWhen blocks submit with a field error, and relaxes when FALSE', async ({ page }) => {
  const batches: any[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/v1/batch')) batches.push(r.url());
  });

  await page.goto('/apps/showcase_app/showcase_invoice');
  await page.getByRole('button', { name: /^(New|新建)$/i }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('md-form-submit')).toBeVisible();

  // Fill the statically-required header fields, leave Issued On empty.
  await dialog.locator('input[name="name"]').fill(`INV-${Date.now()}`);
  await fillLookup(page, 'account', 'North');

  // Status=sent makes issued_on required (CEL). Submit should be blocked with
  // the error attached to Issued On.
  await selectOption(dialog, 'status', 'sent');
  await dialog.getByTestId('md-form-submit').click();
  await expect(dialog.getByText(/Issued On is required/i)).toBeVisible();
  expect(batches.length).toBe(0); // submission blocked

  // Flip to Draft → predicate FALSE → the conditional requirement clears.
  await selectOption(dialog, 'status', 'draft');
  await expect(dialog.getByText(/Issued On is required/i)).toHaveCount(0);
});
