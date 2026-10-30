const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
const s = async page => { const x = await state(page); const f = await page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return 'body'; const inOv = !!a.closest('[data-console-rail]'); return `${a.tagName}${a.getAttribute('data-sidebar') ? '[' + a.getAttribute('data-sidebar') + ']' : ''} "${(a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 25)}" inSidebar=${inOv}`; }); const menus = await page.evaluate(() => document.querySelectorAll('[role="menu"]').length); return `${x.dataState}/${x.rail} sb=${x.sidebar && x.sidebar.w} focus=${f} menus=${menus}`; };
const cases = {
  'E1 app bar button then Esc': async (page, log) => { await page.click('[data-sidebar="trigger"]'); await page.waitForTimeout(700); log.push('open via button -> ' + await s(page)); },
  'E2 rail bg click then Tab then Esc': async (page, log) => { await page.mouse.click(24, 700); await page.waitForTimeout(700); log.push('open -> ' + await s(page)); await page.keyboard.press('Tab'); await page.waitForTimeout(200); log.push('Tab -> ' + await s(page)); },
  'E3 rail bg click, click Sales group label, Esc': async (page, log) => { await page.mouse.click(24, 700); await page.waitForTimeout(700); await page.click('[data-console-rail="overlay"] [data-sidebar="group-label"] >> nth=0'); await page.waitForTimeout(400); log.push('clicked group label -> ' + await s(page)); },
  'E4 Ctrl+B, focus nav link programmatically, Esc': async (page, log) => { await page.keyboard.press('Control+b'); await page.waitForTimeout(700); await page.focus('[data-console-rail="overlay"] a[href$="/crm_account"]'); await page.waitForTimeout(200); log.push('focused Accounts link -> ' + await s(page)); },
  'E5 ⋯ menu, Esc closes menu, Esc again': async (page, log) => { await page.mouse.click(24, 700); await page.waitForTimeout(700); await page.hover('[data-console-rail="overlay"] a[href$="/crm_lead"]'); await page.click('[data-console-rail="overlay"] [data-sidebar="menu-action"] >> nth=0'); await page.waitForTimeout(600); log.push('menu open -> ' + await s(page)); await page.keyboard.press('Escape'); await page.waitForTimeout(600); log.push('Esc #1 -> ' + await s(page)); },
  'E6 Ctrl+B then hover overlay and Esc': async (page, log) => { await page.keyboard.press('Control+b'); await page.waitForTimeout(700); await page.mouse.move(120, 500); await page.waitForTimeout(300); log.push('hover overlay -> ' + await s(page)); },
};
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const [name, fn] of Object.entries(cases)) {
    const { ctx, page } = await open(browser, 1280);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const log = [];
    await fn(page, log);
    await page.keyboard.press('Escape'); await page.waitForTimeout(700); log.push('Esc -> ' + await s(page));
    if (name.startsWith('E5') || name.startsWith('E3') || name.startsWith('E2') || name.startsWith('E4')) await page.screenshot({ path: `shots/p2-esc-${name.slice(0, 2)}.png` });
    out[name] = log; console.log(name + '\n  ' + log.join('\n  '));
    await ctx.close();
  }
  fs.writeFileSync('readings-p2-esc.json', JSON.stringify(out, null, 2));
  await browser.close();
})();
