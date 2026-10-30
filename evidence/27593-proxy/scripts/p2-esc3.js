const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
const tipInfo = page => page.evaluate(() => [...document.querySelectorAll('[role="tooltip"]')].map(t => { const c = t.parentElement; const b = (c || t).getBoundingClientRect(); return { text: t.innerText.trim(), visibleBox: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }; }).concat([...document.querySelectorAll('[data-radix-popper-content-wrapper]')].map(w => { const b = w.getBoundingClientRect(); const cs = getComputedStyle(w.firstElementChild || w); return { wrapper: w.innerText.trim().slice(0, 30), box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], opacity: cs.opacity, display: cs.display, visibility: cs.visibility }; })));
const s = async page => { const x = await state(page); return `${x.dataState}/${x.rail} sb=${x.sidebar && x.sidebar.w}`; };
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const [label, how] of [['rail bg click', p => p.mouse.click(24, 700)], ['app bar button', p => p.click('[data-sidebar="trigger"]')], ['Ctrl+B', p => p.keyboard.press('Control+b')]]) {
    const { ctx, page } = await open(browser, 1280);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const log = [];
    await how(page); await page.waitForTimeout(700); log.push(label + ' -> ' + await s(page));
    await page.mouse.move(80, 154); await page.waitForTimeout(900);
    log.push('hover "Accounts" item 900ms -> ' + await s(page) + ' tooltips=' + JSON.stringify(await tipInfo(page)));
    if (label === 'rail bg click') await page.screenshot({ path: 'shots/p2-overlay-hover-item-tooltip.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(700); log.push('Esc #1 -> ' + await s(page));
    if (label === 'rail bg click') await page.screenshot({ path: 'shots/p2-overlay-hover-item-after-esc1.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(700); log.push('Esc #2 -> ' + await s(page));
    out[label] = log; console.log(log.join('\n'), '\n');
    await ctx.close();
  }
  fs.writeFileSync('readings-p2-esc3.json', JSON.stringify(out, null, 2));
  await browser.close();
})();
