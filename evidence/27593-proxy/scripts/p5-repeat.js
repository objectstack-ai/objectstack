const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
async function resize(page, W) { await page.setViewportSize({ width: W, height: 900 }); await page.waitForTimeout(1000); }
const s = async page => { const x = await state(page); return `${page.viewportSize().width}: ${x.dataState}/${x.rail} sb=${x.sidebar && x.sidebar.w} main=${x.main.x}+${x.main.w}`; };
(async () => {
  const browser = await chromium.launch();
  const out = [];
  for (let i = 0; i < 3; i++) {
    const { ctx, page } = await open(browser, 1440);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const log = [];
    await page.click('[data-sidebar="trigger"]'); await page.waitForTimeout(800); log.push('collapse via app bar button @1440 -> ' + await s(page));
    await resize(page, 1280); log.push('narrow -> ' + await s(page));
    await page.click('[data-sidebar="trigger"]'); await page.waitForTimeout(800); log.push('open overlay via app bar button -> ' + await s(page));
    await page.click('[data-sidebar="footer"] button'); await page.waitForTimeout(800); log.push('Keep sidebar open ON -> ' + await s(page));
    await page.click('[data-sidebar="footer"] button'); await page.waitForTimeout(800); log.push('Keep sidebar open OFF -> ' + await s(page));
    if (i === 0) await page.screenshot({ path: 'shots/p5-S7-1280-after-pin-off.png' });
    await resize(page, 1440); log.push('widen -> ' + await s(page));
    if (i === 0) await page.screenshot({ path: 'shots/p5-S7-repeat-1440-expanded-instead-of-collapsed.png' });
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500); log.push('reload @1440 -> ' + await s(page));
    out.push(log); console.log(log.join('\n'), '\n');
    await ctx.close();
  }
  fs.writeFileSync('readings-p5-repeat.json', JSON.stringify(out, null, 2));
  await browser.close();
})();
