// Measures and screenshots the console sidebar fold (objectstack#27593).
// Usage: APP_URL=http://localhost:PORT OUT=dir node evidence.cjs
const { chromium } = require('playwright');

const APP_URL = process.env.APP_URL;
const OUT = process.env.OUT;
const PATH = process.env.APP_PATH || '/apps/crm_app/crm_contact';

async function signIn(page) {
  const res = await page.request.post(`${APP_URL}/api/v1/auth/sign-in/email`, {
    data: { email: 'admin@objectos.ai', password: 'admin123' },
  });
  if (!res.ok()) throw new Error(`sign-in ${res.status()} ${await res.text()}`);
}

const measure = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-side][data-variant][data-state]');
    const main = document.querySelector('main');
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    if (!root) {
      return { window: innerWidth, desktopSidebar: false, mobileSheet: !!document.querySelector('[data-mobile="true"]'), main: box(main)?.width ?? null };
    }
    const gap = root.firstElementChild;
    const panel = root.lastElementChild;
    const frame = root.parentElement;
    return {
      window: innerWidth,
      state: root.getAttribute('data-state'),
      rail: panel.getAttribute('data-console-rail'),
      gapWidth: Math.round(box(gap).width),
      panelWidth: Math.round(box(panel).width),
      panelZ: getComputedStyle(panel).zIndex,
      frameDisplay: getComputedStyle(frame).display,
      mainLeft: Math.round(box(main).left),
      mainWidth: Math.round(box(main).width),
      keepOpen: !!document.querySelector('[data-testid="sidebar-keep-open"]'),
    };
  });

async function settle(page) {
  await page.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch();
  const readings = {};

  // 1280: the rail, then the overlay.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP_URL}${PATH}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-side][data-variant][data-state]');
    await settle(page);
    readings.rail1280 = await measure(page);
    await page.screenshot({ path: `${OUT}/1280-rail.png` });

    // A click on the rail's background, below the entries.
    await page.mouse.click(24, 760);
    await settle(page);
    readings.overlay1280 = await measure(page);
    await page.screenshot({ path: `${OUT}/1280-overlay.png` });

    await page.keyboard.press('Escape');
    await settle(page);
    readings.afterEsc1280 = await measure(page);

    // The app bar trigger expands it too; a press on the page folds it.
    await page.click('[data-sidebar="trigger"]');
    await settle(page);
    readings.triggerOverlay1280 = await measure(page);
    await page.mouse.click(900, 500);
    await settle(page);
    readings.afterOutside1280 = await measure(page);
    await ctx.close();
  }

  // 1440: unchanged.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP_URL}${PATH}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-side][data-variant][data-state]');
    await settle(page);
    readings.wide1440 = await measure(page);
    await page.screenshot({ path: `${OUT}/1440-unchanged.png` });
    await ctx.close();
  }

  // 700: the phone drawer.
  {
    const ctx = await browser.newContext({ viewport: { width: 700, height: 900 } });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP_URL}${PATH}`, { waitUntil: 'networkidle' });
    await settle(page);
    await page.click('[data-sidebar="trigger"]');
    await settle(page);
    readings.phone700 = await measure(page);
    await page.screenshot({ path: `${OUT}/700-drawer.png` });
    await ctx.close();
  }

  await browser.close();
  console.log(JSON.stringify(readings, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
