import { test, expect, type Page, type Locator } from '@playwright/test';
import { selectOption } from './helpers';

/**
 * B3 live e2e: cascading / dependent `select` options + server-side enforcement
 * (#1583 / objectui#2559).
 *
 * Drives the showcase `showcase_cascade` object (framework
 * examples/app-showcase) — a `country` -> `province` cascade authored with
 * per-option `visibleWhen` + field-level `dependsOn`, plus a role-gated `tier`.
 * This is the live-backend counterpart to the no-backend docs e2e
 * `e2e/cascading-options.spec.ts`: it proves the dual-side B3 contract against a
 * REAL stack —
 *
 *   1. CLIENT (UX): opening the create form and driving the parent `country`
 *      re-filters the child `province`'s OFFERED set via the canonical
 *      @objectstack/formula engine, and clears a now-invalid child value when
 *      the parent changes (cascade-clear).
 *   2. SERVER (boundary): the objectql rule-validator re-evaluates the SUBMITTED
 *      option's `visibleWhen` and REJECTS an out-of-set value (client hiding is
 *      UX, not a security boundary) — verified by POSTing a bad value straight
 *      at the data API and asserting a `VALIDATION_FAILED` / `invalid_option`
 *      violation, and that the matching in-set value is accepted.
 *
 * Like every other spec under e2e/live/, this drives the real console (:5180) +
 * backend (:3000). The default/CI Playwright run ignores the e2e/live directory,
 * so this is opt-in via `pnpm test:e2e:live` with the stack up (auth is handled
 * by e2e/live/global-setup.ts).
 */

const API = process.env.LIVE_API_URL || 'http://localhost:3000';
const OBJECT = 'showcase_cascade';

/**
 * Open a field's Radix Select in the create dialog and return the OFFERED option
 * values (the `select-option-<value>` testid suffixes), sorted, then close it.
 * Only the open select's options are mounted in the portal, so a bare
 * `select-option-*` query is unambiguous.
 */
async function offeredValues(page: Page, dialog: Locator, fieldName: string): Promise<string[]> {
  await dialog.getByTestId(`select-trigger-${fieldName}`).first().click();
  const options = page.locator('[data-testid^="select-option-"]');
  await options.first().waitFor({ state: 'visible' });
  const testids = await options.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.testid ?? ''),
  );
  await page.keyboard.press('Escape');
  return testids.map((t) => t.replace('select-option-', '')).filter(Boolean).sort();
}

test('province options re-filter live as country changes, and the stale value clears', async ({ page }) => {
  await page.goto(`/apps/showcase_app/${OBJECT}`);
  await page.getByRole('button', { name: /^(New|新建)$/i }).first().click();

  const dialog = page.getByRole('dialog');
  // `showcase_cascade` has no child collection, so New opens the flat
  // ModalForm: its own footer, not MasterDetailForm's `md-form-submit`.
  await expect(dialog.getByTestId('modal-form-footer')).toBeVisible();
  await dialog.locator('input[name="name"]').fill(`Cascade ${Date.now()}`);

  // --- country = China -> the dependent province offers only Chinese provinces. ---
  await selectOption(dialog, 'country', 'cn');
  await expect(dialog.getByTestId('select-trigger-province')).toBeVisible();
  expect(await offeredValues(page, dialog, 'province')).toEqual(['gd', 'zj']);

  // Choose one so we can prove the cascade-clear on the next parent change.
  await selectOption(dialog, 'province', 'zj');
  await expect(dialog.getByTestId('select-trigger-province')).toContainText(/zhejiang/i);

  // --- country = United States -> the offered set flips and the stale value clears. ---
  await selectOption(dialog, 'country', 'us');
  expect(await offeredValues(page, dialog, 'province')).toEqual(['ca', 'tx']);
  // 'Zhejiang' is no longer offered under country=us, so the widget dropped it.
  await expect(dialog.getByTestId('select-trigger-province')).not.toContainText(/zhejiang/i);
});

test('the server rejects an out-of-set option value, and accepts an in-set one', async ({ request }) => {
  // Out-of-set: province 'zj' is visible only when country=='cn'. Submitting it
  // under country=='us' must be rejected by the objectql rule-validator —
  // client hiding is UX, the server is the boundary.
  const bad = await request.post(`${API}/api/v1/data/${OBJECT}`, {
    data: { name: `Bad ${Date.now()}`, country: 'us', province: 'zj' },
  });
  expect(bad.status(), await bad.text()).toBe(400);
  const badBody = await bad.json();
  expect(badBody.code).toBe('VALIDATION_FAILED');
  const fields: Array<{ field?: string; code?: string }> = badBody.fields ?? [];
  expect(
    fields.some((f) => f.field === 'province' && f.code === 'invalid_option'),
    `expected an invalid_option violation on province, got ${JSON.stringify(fields)}`,
  ).toBeTruthy();

  // In-set: the same value is accepted when the cascade predicate holds.
  const ok = await request.post(`${API}/api/v1/data/${OBJECT}`, {
    data: { name: `Good ${Date.now()}`, country: 'cn', province: 'zj' },
  });
  expect(ok.status(), await ok.text()).toBe(201);
  const created = await ok.json();
  const id = created?.id ?? created?.record?.id ?? created?.data?.id;
  expect(id, 'created record id').toBeTruthy();

  // Clean up the accepted row so reruns stay idempotent.
  if (id) await request.delete(`${API}/api/v1/data/${OBJECT}/${id}`);
});
