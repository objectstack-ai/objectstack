import { test, expect, type Page } from '@playwright/test';

/**
 * Live e2e: at phone width, Back with the nav drawer open closes the drawer
 * and stays on the page (objectstack-ai/objectstack#29131). Before, Back left
 * the list for the page behind it.
 *
 * The drawer owns one history entry while it is open
 * (`usePhoneNavDrawerHistory` in `@object-ui/app-shell`); the unit pins of
 * every path are beside the hook, in a memory router. This file drives the
 * real Console in Chromium with touch, against the real history: Back is the
 * browser's own, the close is an outside tap, and the reload is a real one,
 * which keeps `history.state`.
 *
 * On a phone inside an app the drawer opens by a swipe in from the left edge:
 * the bottom bar's 「More」 cell is gone (objectstack#35882, the app's menu is
 * the app's home page, objectstack#35881), and the app bar's left slot holds
 * 「‹」 back to that home, not the sidebar trigger, which only the desktop
 * control below still taps. Both open the same drawer through
 * `setOpenMobile(true)`, so the history hook sees the same `openMobile`
 * whichever opened it.
 *
 * In `test:e2e:live:nightly`, not the required `:ci` allowlist.
 */

const APP = 'com.example.showcase';
const LIST = `/apps/${APP}/showcase_task`;
const DRAWER = '[data-sidebar="sidebar"][data-mobile="true"]';
const TRIGGER = 'button[data-sidebar="trigger"]';
/** On a phone list the app bar's 「‹」, there once the page is drawn. */
const PHONE_BACK = '[data-testid="app-bar-phone-home"]';
const FLAG = '__navDrawerOpen';

async function openList(page: Page, opener: string) {
  // A page behind the list, so Back has somewhere to go.
  await page.goto('/home');
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.goto(LIST);
  await expect(page.locator(opener).first()).toBeVisible();
}

/** A swipe in from the left edge, the phone's drawer gesture (`UnifiedSidebar`). */
async function swipeFromEdge(page: Page) {
  await page.evaluate(() => {
    const touch = (x: number) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 420 });
    document.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(10)], changedTouches: [touch(10)] }));
    document.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(120)] }));
  });
}

async function openDrawer(page: Page) {
  await swipeFromEdge(page);
  await expect(page.locator(DRAWER)).toBeVisible();
  await expect.poll(() => drawerFlag(page)).toBe(true);
}

function drawerFlag(page: Page): Promise<boolean> {
  return page.evaluate((flag) => {
    const usr = (window.history.state as { usr?: Record<string, unknown> } | null)?.usr;
    return !!usr && usr[flag] === true;
  }, FLAG);
}

function historyLength(page: Page): Promise<number> {
  return page.evaluate(() => window.history.length);
}

for (const width of [375, 390]) {
  test.describe(`phone nav drawer and Back at ${width} px`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });

    test('Back with the drawer open closes it and stays on the list', async ({ page }) => {
      await openList(page, PHONE_BACK);
      const url = page.url();
      await openDrawer(page);

      await page.goBack();

      await expect(page.locator(DRAWER)).toBeHidden();
      expect(page.url()).toBe(url);
      expect(await drawerFlag(page)).toBe(false);
    });

    test('an outside tap closes the drawer and pops its entry: Back goes to the previous page', async ({ page }) => {
      await openList(page, PHONE_BACK);
      const before = await historyLength(page);
      await openDrawer(page);

      // Right of the 288 px drawer, on the overlay.
      await page.touchscreen.tap(width - 20, 420);
      await expect(page.locator(DRAWER)).toBeHidden();
      await expect.poll(() => drawerFlag(page)).toBe(false);
      expect(page.url()).toContain(LIST);

      await page.goBack();
      await expect(page).toHaveURL(/\/home(?:[?#]|$)/);
      // The popped entry is forward history now, not an extra stop behind the list.
      expect(await historyLength(page)).toBe(before + 1);
    });

    test('choosing a nav entry replaces the drawer entry: Back returns to the list', async ({ page }) => {
      await openList(page, PHONE_BACK);
      const listUrl = page.url();
      await openDrawer(page);

      const target = await page.evaluate(({ drawer, list }) => {
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(`${drawer} a[href]`));
        const other = anchors.find((a) => {
          const path = new URL(a.href).pathname;
          return path.includes('/apps/') && !path.endsWith(list);
        });
        return other?.getAttribute('href') ?? null;
      }, { drawer: DRAWER, list: LIST });
      expect(target, 'the drawer offers another entry').toBeTruthy();

      await page.locator(`${DRAWER} a[href="${target}"]`).first().tap();
      await expect(page.locator(DRAWER)).toBeHidden();
      await expect.poll(() => new URL(page.url()).pathname).toBe(target);

      await page.goBack();
      await expect.poll(() => page.url()).toBe(listUrl);
      await expect(page.locator(DRAWER)).toBeHidden();
      expect(await drawerFlag(page)).toBe(false);
    });

    test('a reload with the drawer open leaves it closed, with no flagged entry left', async ({ page }) => {
      await openList(page, PHONE_BACK);
      await openDrawer(page);
      const length = await historyLength(page);

      await page.reload();
      await expect(page.locator(PHONE_BACK).first()).toBeVisible();

      await expect.poll(() => drawerFlag(page)).toBe(false);
      await expect(page.locator(DRAWER)).toBeHidden();
      expect(page.url()).toContain(LIST);
      expect(await historyLength(page)).toBe(length);
    });
  });
}

test.describe('desktop sidebar', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('CONTROL — opening and closing the sidebar writes no history entry', async ({ page }) => {
    await openList(page, TRIGGER);
    const url = page.url();
    const length = await historyLength(page);

    await page.locator(TRIGGER).first().click();
    await page.locator(TRIGGER).first().click();

    expect(await historyLength(page)).toBe(length);
    expect(page.url()).toBe(url);
  });
});
