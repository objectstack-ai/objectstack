const { chromium } = require('playwright');
const { open, measure, BASE } = require('./lib');
(async () => {
  const W = +process.argv[2] || 1280;
  const browser = await chromium.launch();
  const { page } = await open(browser, W);
  await page.goto(BASE + '/apps/crm_app/crm_contact', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify(await measure(page), null, 1));
  await browser.close();
})();
