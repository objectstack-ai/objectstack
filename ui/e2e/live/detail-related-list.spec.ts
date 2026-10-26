import { test, expect } from '@playwright/test';

/**
 * Live e2e for relationship-derived DETAIL-PAGE related lists — the read-side
 * mirror of `inlineEdit`.
 *
 * `showcase_project.account` is a lookup → showcase_account, so the Account's
 * record detail page must auto-render a "Projects" related list with NO page
 * config (derived from the relationship by `deriveRelatedLists`). The list's
 * title/columns come from `relatedListTitle` / `relatedListColumns` declared on
 * the relationship. We open an Account record and assert the Projects related
 * list is present.
 */
test('Account detail page auto-renders a relationship-derived Projects related list', async ({ page }) => {
  // 1) Open the Accounts list and drill into Northwind, a seeded account that
  //    owns projects (the status assertion below needs rows to read).
  await page.goto('/apps/showcase_app/showcase_account');

  // The data grid renders the primary (name) cell as a link to the record's
  // full-page detail route, `/record/<id>`. Grab the id from that route.
  const nameLink = page.getByRole('row').getByRole('link', { name: 'Northwind', exact: true }).first();
  await nameLink.waitFor({ state: 'visible', timeout: 15_000 });
  await nameLink.click();

  await page.waitForURL(/\/showcase_account\/record\/[^/?#]+/, { timeout: 15_000 });
  const recordId = new URL(page.url()).pathname.split('/record/')[1]?.split('/')[0];
  expect(recordId).toBeTruthy();

  // 2) Open the canonical full-page detail (synthesized record page).
  await page.goto(`/apps/showcase_app/showcase_account/record/${recordId}`);
  await expect(page).toHaveURL(/\/showcase_account\/record\//, { timeout: 15_000 });

  // 3) `showcase_project.account` declares `relatedList: 'primary'`, so the
  //    synthesized page gives that list its own tab, titled by its declared
  //    `relatedListTitle` ("Projects"); non-primary lists share a "Related"
  //    tab. Either way the tab only exists because `deriveRelatedLists` found
  //    the relationship — it's the read-side mirror at work.
  //    (The tab's name gains a row-count badge once the count loads.)
  const projectsTab = page.getByRole('tab', { name: /^Projects/ });
  await projectsTab.waitFor({ state: 'visible', timeout: 15_000 });
  await projectsTab.click();

  // 4) The relationship-derived related list renders in that tab.
  const relatedPanel = page.getByRole('tabpanel', { name: /^Projects/ });
  await expect(relatedPanel.getByText('Projects', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  // The status column renders as a friendly, capitalized badge label (e.g.
  // "Planned"/"Active") — NOT the raw lowercase value ("planned"). This guards
  // the cell-renderer resolution for explicitly-supplied related-list columns.
  // (Empty override columns like Health are pruned, so we don't assert those.)
  await expect(
    relatedPanel.getByText(/^(Planned|Active|On Hold|Completed|Cancelled)$/).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(relatedPanel.getByText(/^(planned|active|on_hold|completed|cancelled)$/)).toHaveCount(0);
});
