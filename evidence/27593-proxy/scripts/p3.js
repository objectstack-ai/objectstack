const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, startSampler, stopSampler, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
async function storage(page) {
  return page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/side|rail|pin|nav|console/i.test(k)) o[k] = localStorage.getItem(k).slice(0, 120); } return { ls: o, cookie: document.cookie.split('; ').filter(c => /side|rail|pin/i.test(c)) }; });
}
async function footInfo(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-sidebar="footer"] button, [data-sidebar="footer"] a')].map(b => ({ text: b.innerText.trim(), aria: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), title: b.getAttribute('title'), box: (() => { const r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() })));
}
const short = s => ({ st: s.dataState, rail: s.rail, z: s.containerZ, sbW: s.sidebar && s.sidebar.w, mainX: s.main.x, mainW: s.main.w, path: s.path, footer: s.footerText });
(async () => {
  const browser = await chromium.launch();
  const R = { point: 3, surface: URL0, steps: [] };
  const { ctx, page } = await open(browser, 1280);
  await page.goto(URL0, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const step = async (label, extra = {}) => { const s = short(await state(page)); const f = await footInfo(page); const st = await storage(page); R.steps.push({ label, ...s, foot: f, storage: st, ...extra }); console.log(label.padEnd(55), JSON.stringify(s), JSON.stringify(f.map(x => x.text + (x.pressed ? '[pressed=' + x.pressed + ']' : ''))), JSON.stringify(st)); };
  await step('0 initial at 1280');
  await page.mouse.click(24, 700); await page.waitForTimeout(800);
  await step('1 expanded via rail background');
  await page.screenshot({ path: 'shots/p3-1280-expanded-foot-item.png' });
  // press Keep sidebar open
  await startSampler(page);
  await page.click('[data-sidebar="footer"] button');
  await page.waitForTimeout(800);
  const fr = await stopSampler(page);
  await step('2 after pressing foot item (keep open)', { frames: fr });
  await page.screenshot({ path: 'shots/p3-1280-kept-open.png' });
  // does Esc / outside click / nav fold it while kept open?
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await step('3 Esc while kept open');
  await page.mouse.click(900, 650); await page.waitForTimeout(600);
  await step('4 outside click while kept open');
  await page.click('[data-sidebar="sidebar"] a[href$="/crm_account"]'); await page.waitForTimeout(1500);
  await step('5 nav choice while kept open');
  // reload
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await step('6 after reload');
  await page.screenshot({ path: 'shots/p3-keep-open-after-reload.png' });
  // new tab in same context
  const p2 = await ctx.newPage(); await p2.goto(URL0, { waitUntil: 'networkidle' }); await p2.waitForTimeout(1500);
  R.newTabSameContext = short(await state(p2)); console.log('new tab same ctx', JSON.stringify(R.newTabSameContext)); await p2.close();
  // ctrl+b while kept open
  await page.keyboard.press('Control+b'); await page.waitForTimeout(800);
  await step('7 Control+b while kept open');
  await page.screenshot({ path: 'shots/p3-ctrl-b-while-kept-open.png' });
  await page.keyboard.press('Control+b'); await page.waitForTimeout(800);
  await step('8 Control+b again');
  // ensure expanded before pressing again
  const cur = await state(page);
  if (cur.dataState !== 'expanded') { await page.click('[data-sidebar="trigger"]'); await page.waitForTimeout(800); await step('8b reopen via app bar button'); }
  await page.screenshot({ path: 'shots/p3-before-unpin.png' });
  await startSampler(page);
  await page.click('[data-sidebar="footer"] button');
  await page.waitForTimeout(800);
  const fr2 = await stopSampler(page);
  await step('9 after pressing foot item again', { frames: fr2 });
  await page.screenshot({ path: 'shots/p3-after-unpin.png' });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await step('10 after reload (unpinned)');
  await page.screenshot({ path: 'shots/p3-after-unpin-reload.png' });
  fs.writeFileSync('readings-p3.json', JSON.stringify(R, null, 2));
  await browser.close();
})();
