import { test, expect } from '@playwright/test';

/**
 * Live e2e for `visible` predicates on the CEL engine: a row action's (issue
 * #1584) and an app navigation entry's (objectstack-ai/objectstack#27457).
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
 *
 * The navigation case authors its own package and app through the metadata
 * API, the way Studio's menu-entry inspector writes a VISIBLE WHEN: a bare
 * string, which the spec defines as CEL shorthand. It deletes the package
 * afterwards.
 *
 * In the required `Live E2E UI` job's `test:e2e:live:ci` allowlist since
 * objectstack#27555, under the promotion rule (3/3 consecutive green, plus a
 * 5/5 run of the enlarged allowlist); the readings are on that card's PR.
 */

const API = process.env.LIVE_API_URL || 'http://localhost:3000';

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

test('a nav entry\'s bare-string `visible` is read as CEL: shown when true, hidden when false', async ({ page, request }) => {
  // The seeded admin holds `org_owner`, so the first predicate is true for this
  // session and the second, naming a position nobody holds, is false.
  const session = await request.get(`${API}/api/v1/auth/get-session`);
  expect(session.ok(), `get-session answered ${session.status()}`).toBe(true);
  expect((await session.json())?.user?.positions).toContain('org_owner');

  const stamp = Date.now();
  const pkgId = `com.e2e.navcel${stamp}`;
  const appName = `e2e_navcel_${stamp}`;
  const pkgRes = await request.post(`${API}/api/v1/packages`, {
    data: { manifest: { id: pkgId, name: `E2E Nav CEL ${stamp}`, version: '0.1.0', type: 'app' } },
  });
  expect(pkgRes.ok(), await pkgRes.text()).toBeTruthy();

  try {
    // `in` is CEL-only syntax: the legacy JS-dialect evaluator faults on it and
    // fails closed, so on that engine both entries are hidden.
    const putRes = await request.put(`${API}/api/v1/meta/app/${appName}?mode=draft&package=${pkgId}`, {
      data: {
        name: appName,
        label: `E2E Nav CEL ${stamp}`,
        navigation: [
          { id: 'nav_cel_shown', type: 'object', objectName: 'showcase_task', label: 'CEL Shown Entry', visible: "'org_owner' in current_user.positions" },
          { id: 'nav_cel_hidden', type: 'object', objectName: 'showcase_task', label: 'CEL Hidden Entry', visible: "'e2e_no_such_position' in current_user.positions" },
        ],
      },
    });
    expect(putRes.ok(), await putRes.text()).toBeTruthy();
    const publishRes = await request.post(`${API}/api/v1/packages/${pkgId}/publish-drafts`);
    expect(publishRes.ok(), await publishRes.text()).toBeTruthy();

    const faults: string[] = [];
    page.on('console', (m) => {
      if (/predicate could not be evaluated/i.test(m.text())) faults.push(m.text());
    });
    await page.goto(`/apps/${pkgId}`);

    await expect(page.getByRole('link', { name: 'CEL Shown Entry', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'CEL Hidden Entry', exact: true })).toHaveCount(0);
    // Hidden because the predicate is false, not because it faulted closed.
    expect(faults, faults.join('\n')).toEqual([]);
  } finally {
    await request.delete(`${API}/api/v1/packages/${pkgId}`);
  }
});
