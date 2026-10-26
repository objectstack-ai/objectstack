import { test, expect, type Locator } from '@playwright/test';

/**
 * objectui#13091 — the declared sharing rules list at 1440 px: the row's
 * controls are in reach. Measured before the fix on a fresh showcase, signed in
 * as admin: the first Clone button's box started at x=1515 (off-screen) and the
 * table's scroll box cut the Active switch at its right edge.
 *
 * What is measured here, in a real browser against the running stack:
 *  - the first Clone button and the first Active switch both lie wholly inside
 *    the viewport AND inside the visible box of the table's scroller, with the
 *    table not scrolled at all;
 *  - when the table is wider than its box, the box says so
 *    (`data-overflow-right`, which drives the seam shadow on the pinned cells).
 *
 * The unit pins for the same page are in
 * `ResourceListPage.declaredSharingRules-12982.test.tsx`.
 */
const LIST = '/apps/setup/metadata/sharing_rule?scope=environment';

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'the element has a layout box').not.toBeNull();
  return box!;
}

test.use({ viewport: { width: 1440, height: 1000 } });

test('at 1440 px, Clone and the Active switch are inside the viewport and the table box', async ({ page }) => {
  await page.goto(LIST);
  // The table's own scroll box, found by structure rather than by a test id,
  // so the measurement reads the same element before and after the fix.
  const scroller = page.locator('table').first().locator('xpath=..');
  await expect(scroller).toBeVisible();
  const clone = page.locator('[data-testid^="catalog-clone-"]').first();
  const active = page.locator('[data-testid^="catalog-active-"]').first();
  await expect(clone).toBeVisible();
  await expect(active).toBeVisible();
  expect(await scroller.evaluate((el) => el.scrollLeft)).toBe(0);

  const viewport = page.viewportSize()!;
  const frame = await boxOf(scroller);
  for (const [what, control] of [['Clone', clone], ['Active', active]] as const) {
    const b = await boxOf(control);
    expect(b.x, `${what} starts inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${what} ends inside the viewport`).toBeLessThanOrEqual(viewport.width);
    expect(b.x, `${what} starts inside the table box`).toBeGreaterThanOrEqual(frame.x);
    expect(b.x + b.width, `${what} ends inside the table box`).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
  }

  // The box reports its overflow, which is what draws the seam shadow.
  const widths = await scroller.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  if (widths.scroll > widths.client + 1) {
    await expect(scroller).toHaveAttribute('data-overflow-right', 'true');
  }
});
