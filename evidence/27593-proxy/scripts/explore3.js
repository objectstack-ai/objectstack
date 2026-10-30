const { chromium } = require('playwright');
const { open, measure, BASE } = require('./lib');
(async () => {
  const browser = await chromium.launch();
  const { page, consoleErrors } = await open(browser, 1280);
  await page.goto(BASE + '/apps/crm_app/crm_contact', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // click rail background
  await page.mouse.click(24, 700);
  await page.waitForTimeout(700);
  const m = await measure(page);
  console.log(JSON.stringify({ inner: m.inner, chain: m.chain.slice(0, 3), main: m.main, footer: m.footer, dialogs: m.dialogs, overlays: m.overlays, ls: m.ls, cookie: m.cookieSidebar, menu: m.menuTextVisible }, null, 1));
  const extra = await page.evaluate(() => {
    const inner = document.querySelector('[data-sidebar="sidebar"]');
    const items = [...inner.querySelectorAll('a, button')].map(b => ({ tag: b.tagName, t: (b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\n+/g, ' | ').slice(0, 50), ds: b.getAttribute('data-sidebar'), href: b.getAttribute('href'), y: Math.round(b.getBoundingClientRect().y), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) }));
    return items;
  });
  console.log(JSON.stringify(extra));
  await page.screenshot({ path: 'shots/explore-1280-expanded.png' });
  console.log('errors', consoleErrors);
  await browser.close();
})();
