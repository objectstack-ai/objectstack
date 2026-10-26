import { test, expect } from '@playwright/test';

/**
 * Live e2e for action modals — a row action opens its modal envelope (Dialog),
 * renders the target form, and closes cleanly. Guards the action-modal
 * transport (drawer/modal/fullscreen) wiring end-to-end.
 */
test('a row Edit action opens a modal form and closes', async ({ page }) => {
  await page.goto('/apps/showcase_app/showcase_task');
  await page.locator('[data-testid="row-action-trigger"]').first().waitFor();
  await page.locator('[data-testid="row-action-trigger"]').first().click();
  await page.getByRole('menuitem', { name: /^Edit$/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /Edit Task/i })).toBeVisible();
  await expect(page.getByTestId('modal-form-footer')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
