const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
const s = async page => { const x = await state(page); return `${x.dataState}/${x.rail} sb=${x.sidebar && x.sidebar.w} main=${x.main.x}+${x.main.w} path=${x.path}`; };
(async () => {
  const browser = await chromium.launch();
  const log = [];
  {
    const { ctx, page } = await open(browser, 1280);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    await page.mouse.click(24, 700); await page.waitForTimeout(800); log.push('overlay open -> ' + await s(page));
    await page.hover('[data-console-rail="overlay"] a[href$="/crm_lead"]'); await page.waitForTimeout(300);
    await page.click('[data-console-rail="overlay"] button[aria-label="More actions for Leads"], [data-console-rail="overlay"] [data-sidebar="menu-action"] >> nth=0'); await page.waitForTimeout(800);
    const menu = await page.evaluate(() => [...document.querySelectorAll('[role="menu"]')].map(m => m.innerText.trim().replace(/\n+/g, ' | ')));
    log.push('clicked ⋯ for Leads -> ' + await s(page) + ' menu=' + JSON.stringify(menu));
    await page.screenshot({ path: 'shots/p2-extra-overlay-more-actions-menu.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(600); log.push('Esc (closes menu?) -> ' + await s(page));
    await page.keyboard.press('Escape'); await page.waitForTimeout(600); log.push('Esc again -> ' + await s(page));
    // Recent group
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800);
    const recent = await page.$('[data-console-rail="overlay"] >> text=Recent');
    if (recent) { await recent.click(); await page.waitForTimeout(600); log.push('clicked Recent toggle -> ' + await s(page)); const items = await page.evaluate(() => [...document.querySelectorAll('[data-console-rail="overlay"] a')].map(a => a.getAttribute('href')).filter(h => h && !/crm_(lead|account|contact|opportunity|activity)$|pipeline_dashboard$/.test(h))); log.push('recent links: ' + JSON.stringify(items)); }
    await ctx.close();
  }
  {
    // record page: open a record, then overlay, then Esc
    const { ctx, page } = await open(browser, 1280);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    await page.click('text=Grace'); await page.waitForTimeout(2000);
    const dialogs = async () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map(d => (d.getAttribute('aria-label') || d.innerText.slice(0, 30)).replace(/\n/g, ' ')));
    log.push('opened record Grace -> ' + await s(page) + ' url=' + page.url() + ' dialogs=' + JSON.stringify(await dialogs()));
    await page.screenshot({ path: 'shots/p2-extra-record-open.png' });
    await page.keyboard.press('Control+b'); await page.waitForTimeout(800); log.push('Ctrl+B with record open -> ' + await s(page) + ' dialogs=' + JSON.stringify(await dialogs()));
    await page.screenshot({ path: 'shots/p2-extra-record-open-overlay.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(800); log.push('Esc -> ' + await s(page) + ' url=' + page.url() + ' dialogs=' + JSON.stringify(await dialogs()));
    await page.screenshot({ path: 'shots/p2-extra-record-open-after-esc.png' });
    await ctx.close();
  }
  console.log(log.join('\n'));
  fs.writeFileSync('readings-p2-extra.json', JSON.stringify(log, null, 2));
  await browser.close();
})();
