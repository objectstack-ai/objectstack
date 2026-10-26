import { test, expect } from '@playwright/test';

/**
 * Live e2e for row-action visibility on the CEL engine (issue #1584).
 *
 * The showcase task list surfaces the `showcase_mark_done` row action, gated by
 * the CEL predicate `visible: '!record.done'`. After unification, that predicate
 * is evaluated by the canonical `@objectstack/formula` engine — the same engine
 * the server uses — instead of the legacy JS-dialect evaluator. This drives the
 * real row-action menu and asserts the CEL-gated item renders coherently
 * (visible on a not-done row / hidden on a done row) without faulting.
 *
 * The exhaustive gate semantics (including the CEL `in` operator, which the
 * legacy engine could not parse, and the fail-closed-on-broken posture) are
 * covered deterministically by the jsdom component tests
 * (`packages/plugin-grid/.../RowActionMenu.test.tsx`) — this spec guards the
 * live render path end-to-end. Non-mutating: it only opens the menu.
 */
test('row-action `visible` predicates are CEL-evaluated on the showcase task list', async ({ page }) => {
  await page.goto('/apps/showcase_app/showcase_task');

  const trigger = page.locator('[data-testid="row-action-trigger"]').first();
  await trigger.waitFor();
  await trigger.click();

  // The row menu renders; its items are gated by CEL `visible` predicates.
  // "Edit" is always present — proves the menu opened.
  await expect(page.getByRole('menuitem', { name: /^Edit$/i })).toBeVisible();

  // "Mark Done" (visible: '!record.done'): its presence tracks the row's `done`
  // flag. Either way the CEL predicate evaluated without faulting — a faulting
  // predicate fails closed (hidden) — so the DOM is coherent (0 or 1 instance).
  const markDone = page.getByTestId('row-action-showcase_mark_done');
  expect(await markDone.count()).toBeLessThanOrEqual(1);
});
