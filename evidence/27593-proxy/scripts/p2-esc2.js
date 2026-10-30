const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
const s = async page => { const x = await state(page); const f = await page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return 'body'; return `${a.tagName}[${a.getAttribute('data-sidebar') || ''}] "${(a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\n.*/s, '').slice(0, 25)}" inSidebar=${!!a.closest('[data-console-rail]')}`; }); const tips = await page.evaluate(() => [...document.querySelectorAll('[role="tooltip"], [data-radix-popper-content-wrapper]')].map(t => t.innerText.trim().slice(0, 30))); return `${x.dataState}/${x.rail} sb=${x.sidebar && x.sidebar.w} main=${x.main.x}+${x.main.w} focus=${f} tooltips=${JSON.stringify(tips)}`; };
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const tabs of [1, 2, 3, 4]) {
    const { ctx, page } = await open(browser, 1280);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const log = [];
    await page.mouse.click(24, 700); await page.waitForTimeout(700); log.push('rail bg click -> ' + await s(page));
    for (let i = 0; i < tabs; i++) { await page.keyboard.press('Tab'); await page.waitForTimeout(150); }
    log.push(`Tab x${tabs} -> ` + await s(page));
    await page.keyboard.press('Escape'); await page.waitForTimeout(700); log.push('Esc -> ' + await s(page));
    if (tabs === 2) await page.screenshot({ path: 'shots/p2-esc-focus-on-nav-link-not-folded.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(700); log.push('Esc again -> ' + await s(page));
    out['tabs' + tabs] = log; console.log(log.join('\n'), '\n');
    await ctx.close();
  }
  // keyboard-only path: Ctrl+B then Tab into overlay
  {
    const { ctx, page } = await open(browser, 1280);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const log = [];
    await page.keyboard.press('Control+b'); await page.waitForTimeout(700); log.push('Ctrl+B -> ' + await s(page));
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); await page.waitForTimeout(120); log.push(`Tab ${i + 1} -> ` + await s(page)); }
    out.keyboardOnly = log; console.log(log.join('\n'));
    await ctx.close();
  }
  // focus Keep sidebar open button then Esc
  {
    const { ctx, page } = await open(browser, 1280);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const log = [];
    await page.mouse.click(24, 700); await page.waitForTimeout(700);
    await page.focus('[data-sidebar="footer"] button'); log.push('focus Keep open -> ' + await s(page));
    await page.keyboard.press('Escape'); await page.waitForTimeout(700); log.push('Esc -> ' + await s(page));
    out.keepOpenFocus = log; console.log(log.join('\n'));
    await ctx.close();
  }
  fs.writeFileSync('readings-p2-esc2.json', JSON.stringify(out, null, 2));
  await browser.close();
})();
