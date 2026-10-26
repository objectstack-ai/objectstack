import { test, expect } from '@playwright/test';
import { expectToast } from './helpers';

/**
 * Live e2e for the screen-flow round trip (framework ADR-0019).
 *
 * A `type: 'flow'` action starts the run; when it pauses at a `screen` node
 * the console must render that screen and POST the collected values back to
 * `/automation/{flow}/runs/{runId}/resume`. Nothing covered this seam before:
 * the unit tests stub the runner out of the action runtime, and the runner's
 * own tests feed it a screen directly — so the trigger → dialog → resume →
 * refresh chain was only ever exercised by hand. framework#3528 lived in
 * exactly that gap (a paused run whose screen never made it to the user, so
 * resume was never called and every screen flow looked un-completable).
 *
 * Drives `showcase_bulk_reassign` (list row action) → `showcase_reassign_wizard`,
 * whose `screen` node collects `new_assignee` and writes it back with
 * `update_record`, so the assertion runs all the way to persisted data.
 *
 * The run starts through the ACTION door, `POST /actions/showcase_task/
 * showcase_bulk_reassign`, not the trigger route (objectui#12037): the click
 * names an action the object declares with `type: 'flow'` and this target, so
 * the server applies that action's own gates before the flow starts. A flow
 * start that names no declared action keeps `/automation/{flow}/trigger`.
 */
test('a row flow action renders its screen and resumes the run', async ({ page }) => {
  const assignee = `e2e-${Date.now()}@example.com`;

  // Capture the flow traffic on both doors: the bug class here is a MISSING
  // request, so the launch and resume POSTs are asserted directly rather than
  // inferred from the UI.
  const automation: Array<{ url: string; body: unknown }> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/v1\/(automation|actions)\//.test(r.url())) {
      let body: unknown = null;
      try { body = r.postDataJSON(); } catch { /* non-JSON body — keep null */ }
      automation.push({ url: r.url(), body });
    }
  });

  await page.goto('/apps/showcase_app/showcase_task');
  const rowMenu = page.locator('[data-testid="row-action-trigger"]').first();
  await rowMenu.waitFor();
  await rowMenu.click();
  await page.getByTestId('row-action-showcase_bulk_reassign').click();

  // The run paused at its screen node — the console renders it as a dialog.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /New Assignee/i })).toBeVisible();

  await page.locator('#ff-new_assignee').fill(assignee);
  await dialog.getByRole('button', { name: 'Submit' }).click();

  // Terminal success closes the runner and toasts the flow's completion message.
  await expectToast(page, /Done|reassign/i);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const launch = automation.find((r) => /\/actions\/showcase_task\/showcase_bulk_reassign$/.test(r.url));
  expect(launch, 'the declared flow action never started its run through the action door').toBeTruthy();
  expect(
    automation.filter((r) => /\/automation\/[^/]+\/trigger$/.test(r.url)),
    'a declared flow action must not start its flow by name on the trigger route',
  ).toHaveLength(0);

  const resume = automation.find((r) => /\/runs\/[^/]+\/resume$/.test(r.url));
  expect(resume, 'Submit did not call the resume endpoint — the run is stranded').toBeTruthy();
  expect((resume!.body as { inputs?: Record<string, unknown> })?.inputs).toMatchObject({
    new_assignee: assignee,
  });

  // The flow's downstream `update_record` node ran: the row shows the new owner
  // after the runner's completion refresh.
  await expect(page.getByText(assignee).first()).toBeVisible({ timeout: 15_000 });
});
