const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
(async () => {
  const browser = await chromium.launch();
  const { ctx, page } = await open(browser, 1280);
  await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await page.mouse.click(24, 700); await page.waitForTimeout(800);
  const ck = await page.evaluate(() => document.cookie);
  await ctx.addInitScript(() => { window.__mount = []; const tick = () => { const s = document.querySelector('[data-sidebar="sidebar"]'); if (s) { const c = s.parentElement; window.__mount.push([Math.round(performance.now()), Math.round(c.getBoundingClientRect().width), c.getAttribute('data-console-rail')]); } if (window.__mount.length < 300) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  const m = await page.evaluate(() => window.__mount);
  const comp = []; for (const r of m) { const k = r.slice(1).join(); if (!comp.length || comp[comp.length - 1].k !== k) comp.push({ k, t: r[0], w: r[1], mode: r[2] }); }
  const after = await state(page);
  const res = { cookieBeforeReload: ck, mountFrames: comp.map(({ k, ...x }) => x), after: { st: after.dataState, rail: after.rail, sbW: after.sidebar.w, mainX: after.main.x, mainW: after.main.w } };
  console.log(JSON.stringify(res));
  fs.writeFileSync('readings-p1-mount3.json', JSON.stringify(res, null, 2));
  await browser.close();
})();
