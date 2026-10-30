const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, startSampler, stopSampler, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
const short = s => ({ W: null, st: s.dataState, rail: s.rail, sbW: s.sidebar && s.sidebar.w, mainX: s.main.x, mainW: s.main.w, path: s.path });
async function snap(page, label, out) {
  const s = short(await state(page)); s.W = page.viewportSize().width;
  const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => /side|console/i.test(k)).map(k => [k, localStorage.getItem(k)])));
  const ck = await page.evaluate(() => document.cookie.split('; ').filter(c => /sidebar/.test(c)).join(';'));
  out.push({ label, ...s, ls, ck });
  console.log('   ', label.padEnd(52), JSON.stringify(s), JSON.stringify(ls), ck);
}
async function resize(page, W) { await page.setViewportSize({ width: W, height: 900 }); await page.waitForTimeout(1000); }
const scenarios = {
  'S1 collapse on wide, narrow, widen': async (page, o) => {
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await snap(page, 'Ctrl+B at 1440 (collapse)', o);
    await page.screenshot({ path: 'shots/p5-S1-1440-collapsed.png' });
    await resize(page, 1280); await snap(page, 'resized to 1280', o);
    await page.screenshot({ path: 'shots/p5-S1-1280-rail.png' });
    await resize(page, 1440); await snap(page, 'resized back to 1440', o);
    await page.screenshot({ path: 'shots/p5-S1-1440-collapsed-restored.png' });
  },
  'S2 collapse on wide, narrow, use overlay (rail click + Esc, then nav), widen': async (page, o) => {
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await snap(page, 'Ctrl+B at 1440 (collapse)', o);
    await resize(page, 1280); await snap(page, 'resized to 1280', o);
    await page.mouse.click(24, 700); await page.waitForTimeout(800); await snap(page, 'rail bg click', o);
    await page.keyboard.press('Escape'); await page.waitForTimeout(800); await snap(page, 'Esc', o);
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await snap(page, 'Ctrl+B', o);
    await page.click('[data-console-rail="overlay"] a[href$="/crm_account"]'); await page.waitForTimeout(1500); await snap(page, 'nav choice', o);
    await resize(page, 1440); await snap(page, 'resized back to 1440', o);
    await page.screenshot({ path: 'shots/p5-S2-1440-after-overlay-use.png' });
  },
  'S3 expanded on wide, narrow, open overlay and leave it open, widen': async (page, o) => {
    await snap(page, 'initial 1440 expanded', o);
    await resize(page, 1280); await snap(page, 'resized to 1280', o);
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await snap(page, 'Ctrl+B overlay open', o);
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await snap(page, 'Ctrl+B overlay closed', o);
    await resize(page, 1440); await snap(page, 'resized back to 1440', o);
    await page.screenshot({ path: 'shots/p5-S3-1440-expanded-restored.png' });
  },
  'S4 collapse on wide, narrow, reload at narrow, widen': async (page, o) => {
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await snap(page, 'Ctrl+B at 1440 (collapse)', o);
    await resize(page, 1280); await snap(page, 'resized to 1280', o);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500); await snap(page, 'reload at 1280', o);
    await resize(page, 1440); await snap(page, 'resized back to 1440', o);
    await page.screenshot({ path: 'shots/p5-S4-1440-after-narrow-reload.png' });
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500); await snap(page, 'reload at 1440', o);
  },
  'S5 collapse on wide, narrow, overlay open, widen while overlay open': async (page, o) => {
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await snap(page, 'Ctrl+B at 1440 (collapse)', o);
    await resize(page, 1280); await snap(page, 'resized to 1280', o);
    await page.mouse.click(24, 700); await page.waitForTimeout(800); await snap(page, 'rail bg click (overlay open)', o);
    await resize(page, 1440); await snap(page, 'resized back to 1440 with overlay open', o);
    await page.screenshot({ path: 'shots/p5-S5-1440-widen-while-overlay-open.png' });
  },
  'S6 expanded on wide, narrow, pin on, Ctrl+B, unpin, widen': async (page, o) => {
    await snap(page, 'initial 1440 expanded', o);
    await resize(page, 1280); await snap(page, 'resized to 1280', o);
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800);
    await page.click('[data-sidebar="footer"] button'); await page.waitForTimeout(800); await snap(page, 'pin on', o);
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await snap(page, 'Ctrl+B (collapse while pinned)', o);
    await page.click('[data-sidebar="footer"] button'); await page.waitForTimeout(800); await snap(page, 'press pin icon (unpin)', o);
    await resize(page, 1440); await snap(page, 'resized back to 1440', o);
    await page.screenshot({ path: 'shots/p5-S6-1440-after-pin-sequence.png' });
  },
  'S7 collapse on wide, narrow, pin on then off, widen': async (page, o) => {
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await snap(page, 'Ctrl+B at 1440 (collapse)', o);
    await resize(page, 1280); await snap(page, 'resized to 1280', o);
    await page.mouse.click(24, 700); await page.waitForTimeout(800);
    await page.click('[data-sidebar="footer"] button'); await page.waitForTimeout(800); await snap(page, 'pin on', o);
    await page.click('[data-sidebar="footer"] button'); await page.waitForTimeout(800); await snap(page, 'pin off', o);
    await resize(page, 1440); await snap(page, 'resized back to 1440', o);
    await page.screenshot({ path: 'shots/p5-S7-1440-after-pin-on-off.png' });
  },
  'S8 collapse on wide, narrow, pin on, widen, narrow': async (page, o) => {
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await snap(page, 'Ctrl+B at 1440 (collapse)', o);
    await resize(page, 1280); await snap(page, 'resized to 1280', o);
    await page.mouse.click(24, 700); await page.waitForTimeout(800);
    await page.click('[data-sidebar="footer"] button'); await page.waitForTimeout(800); await snap(page, 'pin on', o);
    await resize(page, 1440); await snap(page, 'resized to 1440 (pinned)', o);
    await page.screenshot({ path: 'shots/p5-S8-1440-while-pinned.png' });
    await resize(page, 1280); await snap(page, 'resized to 1280 again', o);
  },
};
(async () => {
  const browser = await chromium.launch();
  const R = { point: 5, surface: URL0, scenarios: {} };
  for (const [name, fn] of Object.entries(scenarios)) {
    console.log(name);
    const { ctx, page } = await open(browser, 1440);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const o = [];
    await snap(page, 'start 1440', o);
    try { await fn(page, o); } catch (e) { o.push({ error: String(e).slice(0, 300) }); console.log('ERR', String(e).slice(0, 300)); }
    R.scenarios[name] = o;
    await ctx.close();
  }
  fs.writeFileSync('readings-p5.json', JSON.stringify(R, null, 2));
  await browser.close();
})();
