const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, startSampler, stopSampler, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
const short = s => ({ st: s.dataState, rail: s.rail, z: s.containerZ, sbX: s.sidebar && s.sidebar.x, sbW: s.sidebar && s.sidebar.w, mainX: s.main.x, mainW: s.main.w, path: s.path, footer: s.footerText, mobileSheet: s.mobileSheet });
async function sheetInfo(page) {
  return page.evaluate(() => {
    const rb = e => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const d = [...document.querySelectorAll('[role="dialog"]')].map(e => ({ attrs: Object.fromEntries([...e.attributes].filter(a => a.name.startsWith('data-') || a.name === 'role').map(a => [a.name, a.value])), box: rb(e), z: getComputedStyle(e).zIndex, footer: [...e.querySelectorAll('[data-sidebar="footer"]')].map(f => f.innerText.trim().replace(/\n+/g, ' | ')), text: e.innerText.trim().replace(/\n+/g, ' | ').slice(0, 300) }));
    const ov = [...document.querySelectorAll('.fixed.inset-0, [data-radix-dialog-overlay], [class*="bg-black"]')].filter(e => e.getBoundingClientRect().width > 0).map(e => ({ box: rb(e), z: getComputedStyle(e).zIndex, bg: getComputedStyle(e).backgroundColor }));
    return { dialogs: d, overlays: ov, main: rb(document.querySelector('main')), sidebarInDom: !!document.querySelector('[data-collapsible]') };
  });
}
(async () => {
  const browser = await chromium.launch();
  const R = { point: 4, surface: URL0, w1440: [], w700: [], boundaries: [] };
  // 1440
  {
    const { ctx, page } = await open(browser, 1440);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const st = async l => { const s = short(await state(page)); const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => /side|console/i.test(k)).map(k => [k, localStorage.getItem(k)]))); R.w1440.push({ label: l, ...s, ls }); console.log('1440', l.padEnd(48), JSON.stringify(s), JSON.stringify(ls)); };
    await st('initial');
    await page.screenshot({ path: 'shots/p4-1440.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(600); await st('Esc');
    await page.mouse.click(900, 650); await page.waitForTimeout(600); await st('outside click');
    await page.mouse.move(100, 600); await page.waitForTimeout(800); await st('hover sidebar');
    await page.click('[data-sidebar="sidebar"] a[href$="/crm_account"]'); await page.waitForTimeout(1500); await st('nav choice Accounts');
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await st('Ctrl+B');
    await page.screenshot({ path: 'shots/p4-1440-collapsed-ctrl-b.png' });
    await page.mouse.move(24, 600); await page.waitForTimeout(800); await st('hover collapsed rail bg');
    await page.mouse.click(24, 700); await page.waitForTimeout(800); await st('click collapsed rail background');
    await page.screenshot({ path: 'shots/p4-1440-collapsed-rail-bg-click.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(600); await st('Esc');
    await page.click('[data-sidebar="sidebar"] a[href$="/crm_contact"]'); await page.waitForTimeout(1500); await st('collapsed icon click Contacts');
    await page.click('[data-sidebar="trigger"]'); await page.waitForTimeout(800); await st('app bar button');
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500); await st('reload');
    await ctx.close();
  }
  // 700
  {
    const { ctx, page } = await open(browser, 700);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const st = async l => { const s = short(await state(page)); const sh = await sheetInfo(page); R.w700.push({ label: l, ...s, sheet: sh }); console.log('700', l.padEnd(40), JSON.stringify(s), JSON.stringify(sh)); };
    await st('initial');
    await page.screenshot({ path: 'shots/p4-700-initial.png' });
    await page.click('[data-sidebar="trigger"]'); await page.waitForTimeout(800); await st('app bar button');
    await page.screenshot({ path: 'shots/p4-700-drawer.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(800); await st('Esc');
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); await st('Ctrl+B');
    await page.screenshot({ path: 'shots/p4-700-drawer-ctrl-b.png' });
    // click a nav item inside the sheet
    const link = await page.$('[role="dialog"] a[href$="/crm_account"]');
    if (link) { await link.click(); await page.waitForTimeout(1500); await st('nav choice in drawer'); await page.screenshot({ path: 'shots/p4-700-after-nav.png' }); }
    let s = await state(page);
    if (!(await page.$('[role="dialog"]'))) { await page.click('[data-sidebar="trigger"]'); await page.waitForTimeout(800); await st('reopen'); }
    await page.mouse.click(650, 600); await page.waitForTimeout(800); await st('click outside (backdrop)');
    await ctx.close();
  }
  // boundaries around phone breakpoint
  for (const W of [767, 768, 800]) {
    const { ctx, page } = await open(browser, W);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const s = short(await state(page));
    R.boundaries.push({ W, ...s });
    console.log('W', W, JSON.stringify(s));
    await ctx.close();
  }
  fs.writeFileSync('readings-p4.json', JSON.stringify(R, null, 2));
  await browser.close();
})();
