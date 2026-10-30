const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, startSampler, stopSampler, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
async function fresh(browser) {
  const o = await open(browser, 1280);
  await o.page.goto(URL0, { waitUntil: 'networkidle' });
  await o.page.waitForTimeout(1500);
  return o;
}
async function act(page, label, fn, wait = 800) {
  const before = await state(page);
  await startSampler(page);
  await fn();
  await page.waitForTimeout(wait);
  const during = await stopSampler(page);
  const after = await state(page);
  return { label, before: { st: before.dataState, rail: before.rail, sbW: before.sidebar && before.sidebar.w, mainX: before.main.x, mainW: before.main.w, path: before.path }, after: { st: after.dataState, rail: after.rail, z: after.containerZ, sbW: after.sidebar && after.sidebar.w, mainX: after.main.x, mainW: after.main.w, path: after.path, footer: after.footerText }, duringFrames: during };
}
(async () => {
  const browser = await chromium.launch();
  const R = { point: 2, surface: URL0, tests: [] };
  // A: rail background click, then Esc
  {
    const { ctx, page } = await fresh(browser);
    R.tests.push(await act(page, 'A1 click rail background (24,700)', () => page.mouse.click(24, 700)));
    await page.screenshot({ path: 'shots/p2-1280-overlay-rail-bg-click.png' });
    // check what element is topmost at a point in content covered by overlay
    R.topAt = await page.evaluate(() => { const e = document.elementFromPoint(150, 500); return e && (e.closest('[data-console-rail]') ? 'sidebar overlay' : e.tagName + '.' + e.className.toString().slice(0, 60)); });
    R.tests.push(await act(page, 'A2 press Escape', () => page.keyboard.press('Escape')));
    await page.screenshot({ path: 'shots/p2-1280-after-esc.png' });
    await ctx.close();
  }
  // B: app bar trigger, then outside click on content
  {
    const { ctx, page } = await fresh(browser);
    R.tests.push(await act(page, 'B1 click app bar Toggle sidebar button', () => page.click('header [data-sidebar="trigger"], [data-sidebar="trigger"]')));
    await page.screenshot({ path: 'shots/p2-1280-overlay-appbar-button.png' });
    R.tests.push(await act(page, 'B2 click outside on empty content (700,650)', () => page.mouse.click(700, 650)));
    await page.screenshot({ path: 'shots/p2-1280-after-outside-click.png' });
    // trigger again to toggle twice
    R.tests.push(await act(page, 'B3 click app bar button again (open)', () => page.click('[data-sidebar="trigger"]')));
    R.tests.push(await act(page, 'B4 click app bar button while open (toggle close?)', () => page.click('[data-sidebar="trigger"]')));
    // outside click on the app bar (search) while open
    R.tests.push(await act(page, 'B5 open via button', () => page.click('[data-sidebar="trigger"]')));
    R.tests.push(await act(page, 'B6 click outside on app bar empty area (400,24)', () => page.mouse.click(400, 24)));
    // outside click on a content row link while open: does it collapse and/or navigate?
    R.tests.push(await act(page, 'B7 open via button', () => page.click('[data-sidebar="trigger"]')));
    R.tests.push(await act(page, 'B8 click outside on a list cell (Email column, 780,260)', () => page.mouse.click(1000, 600)));
    await ctx.close();
  }
  // C: keyboard
  {
    const { ctx, page } = await fresh(browser);
    R.tests.push(await act(page, 'C1 Control+b', () => page.keyboard.press('Control+b')));
    await page.screenshot({ path: 'shots/p2-1280-overlay-ctrl-b.png' });
    R.tests.push(await act(page, 'C2 Control+b again', () => page.keyboard.press('Control+b')));
    R.tests.push(await act(page, 'C3 Meta+b', () => page.keyboard.press('Meta+b')));
    R.tests.push(await act(page, 'C4 Meta+b again', () => page.keyboard.press('Meta+b')));
    // focus in content then ctrl+b
    await page.mouse.click(700, 650);
    R.tests.push(await act(page, 'C5 Control+b after clicking content', () => page.keyboard.press('Control+b')));
    R.tests.push(await act(page, 'C6 Escape', () => page.keyboard.press('Escape')));
    await ctx.close();
  }
  // D: navigation choice inside overlay
  {
    const { ctx, page } = await fresh(browser);
    R.tests.push(await act(page, 'D1 click rail background (24,700)', () => page.mouse.click(24, 700)));
    R.tests.push(await act(page, 'D2 click "Accounts" in overlay', () => page.click('[data-console-rail="overlay"] a[href$="/crm_account"]'), 1500));
    await page.screenshot({ path: 'shots/p2-1280-after-nav-choice.png' });
    R.tests.push(await act(page, 'D3 open via ctrl+b', () => page.keyboard.press('Control+b')));
    R.tests.push(await act(page, 'D4 click "Sales" group label (not a navigation)', () => page.click('[data-console-rail="overlay"] [data-sidebar="group-label"]:has-text("Sales")')));
    R.tests.push(await act(page, 'D5 click "Pipeline" in overlay', () => page.click('[data-console-rail="overlay"] a[href*="pipeline_dashboard"]'), 1500));
    await ctx.close();
  }
  // E: rail icon click + hover
  {
    const { ctx, page } = await fresh(browser);
    await page.mouse.move(700, 600);
    R.tests.push(await act(page, 'E1 hover rail icon (24,116) 800ms', () => page.mouse.move(24, 116), 800));
    await page.screenshot({ path: 'shots/p2-1280-hover-rail-icon.png' });
    R.tests.push(await act(page, 'E2 hover rail background (24,600) 800ms', () => page.mouse.move(24, 600), 800));
    await page.screenshot({ path: 'shots/p2-1280-hover-rail-bg.png' });
    R.tests.push(await act(page, 'E3 click rail icon for Accounts', () => page.click('[data-console-rail="rail"] a[href$="/crm_account"]'), 1500));
    await page.screenshot({ path: 'shots/p2-1280-rail-icon-click.png' });
    R.tests.push(await act(page, 'E4 click rail icon for Opportunities', () => page.click('[data-console-rail="rail"] a[href$="/crm_opportunity"]'), 1500));
    R.tests.push(await act(page, 'E5 click rail icon for Pipeline', () => page.click('[data-console-rail="rail"] a[href*="pipeline_dashboard"]'), 1500));
    await ctx.close();
  }
  fs.writeFileSync('readings-p2.json', JSON.stringify(R, null, 2));
  for (const t of R.tests) console.log(t.label.padEnd(60), JSON.stringify(t.before), '=>', JSON.stringify(t.after), 'frames', JSON.stringify(t.duringFrames));
  console.log('topAt', R.topAt);
  await browser.close();
})();
