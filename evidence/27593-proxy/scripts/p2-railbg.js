const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
(async () => {
  const browser = await chromium.launch();
  const { ctx, page } = await open(browser, 1280);
  await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  const out = [];
  for (const [x, y] of [[24, 880], [4, 300], [44, 500], [24, 98], [24, 246]]) {
    const what = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}[${e.getAttribute('data-sidebar') || ''}] ${(e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 20)}` : null; }, [x, y]);
    await page.mouse.click(x, y); await page.waitForTimeout(700);
    const s = await state(page);
    out.push({ x, y, target: what, st: s.dataState, rail: s.rail, sbW: s.sidebar.w, mainX: s.main.x, mainW: s.main.w, path: s.path });
    console.log(JSON.stringify(out[out.length - 1]));
    if (s.dataState === 'expanded') { await page.keyboard.press('Escape'); await page.waitForTimeout(700); }
    if (s.path !== '/apps/com.example.crm/crm_contact') { await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200); }
  }
  fs.writeFileSync('readings-p2-railbg.json', JSON.stringify(out, null, 2));
  await browser.close();
})();
