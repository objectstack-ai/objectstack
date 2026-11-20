import { test, expect } from '@playwright/test';

/**
 * Selection-bar capability gate over INLINE bulk defs (#6257; ADR-0066 D4).
 *
 * `showcase_project.default` declares two capability-gated inline defs next to
 * four ungated ones (src/ui/views/project.view.ts):
 *
 *   • `relabel_ops`      — requiredPermissions: ['showcase.export_data'],
 *                          granted to the Ops position only;
 *   • `purge_restricted` — requiredPermissions: ['showcase.restricted_ops'],
 *                          granted to NOBODY (src/security/capabilities.ts).
 *
 * The signed-in caller is the seeded platform admin (e2e/global-setup.ts), who
 * holds NEITHER showcase capability: `admin_full_access` carries only the
 * platform capability set, and the gate reads GRANTS — the admin bit is not an
 * exemption. So with rows selected, the bar must show every ungated def and
 * neither gated one. Only the "absent" half is pinned here because it is the
 * half CI can assert without mutating grants; the positive Ops-held cell and
 * the declaration flip (`['showcase.restricted_ops']` → `[]` → back) are the
 * issue's real-machine protocol (#6257).
 *
 * Before spec #6257 the gated pair was not even declarable: `.strict()`
 * `BulkActionDefSchema` had no `requiredPermissions`, while the bar already
 * filtered on it (objectui#3492) — this spec is what notices either side
 * regressing.
 */

// Ambient `process` for the env read below — the showcase tsconfig doesn't pull
// in `@types/node`, and the package-global shim in types/node-shim.d.ts declares
// only `cwd()`. Same idiom (and same reason) as the declarations in
// objectstack.config.ts and src/system/self-url.ts: keeps `pnpm typecheck` green
// without widening the type surface. Playwright provides the real `process`.
declare const process: { env: Record<string, string | undefined> };

const APP = process.env.SHOWCASE_APP || 'com.example.showcase';

test('selection bar hides capability-gated inline defs from a caller without the grants', async ({ page }) => {
  await page.goto(`/_console/apps/${APP}/showcase_project`, { waitUntil: 'domcontentloaded' });
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 25_000 });

  // Tick the header select-all checkbox — the grid's first checkbox.
  const selectAll = page.getByRole('checkbox').first();
  await selectAll.waitFor({ state: 'visible', timeout: 25_000 });
  await selectAll.click();

  // The bar offers the ungated defs: it draws the first two as buttons and
  // the rest behind its "⋮" (`SELECTION_EXPOSED_ACTIONS`, ui plugin-grid
  // `SelectionPageBar.tsx`, citing #35554 「露出一到两个，其余进⋮」), where a
  // def is a `row-context-bulk-NAME` menu item instead of a
  // `bulk-action-NAME` button. All four ungated defs are read, so none of
  // them can drop out of the bar unnoticed.
  await expect(page.getByTestId('bulk-action-set_labels')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bulk-action-assign_team')).toBeVisible();
  await page.getByTestId('selection-actions-more').click();
  await expect(page.getByTestId('row-context-bulk-reassign_account')).toBeVisible();
  await expect(page.getByTestId('row-context-bulk-reschedule')).toBeVisible();

  // …and neither gated def, as a button or as an item of the open "⋮" — the
  // ungated assertions above are what make these absences evidence of the
  // GATE, not of a bar or a menu that failed to render.
  for (const gated of ['relabel_ops', 'purge_restricted']) {
    await expect(page.getByTestId(`bulk-action-${gated}`)).toHaveCount(0);
    await expect(page.getByTestId(`row-context-bulk-${gated}`)).toHaveCount(0);
  }
});
