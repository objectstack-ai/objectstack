const { chromium } = require('playwright');
(async () => {
  const W = +process.argv[2] || 1280;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 } });
  const page = await ctx.newPage();
  const r = await page.request.post('http://localhost:45293/api/v1/auth/sign-in/email', { data: { email: 'admin@objectos.ai', password: 'admin123' } });
  console.log('signin', r.status());
  await page.goto('http://localhost:45293/apps/crm_app/crm_contact', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('url', page.url());
  const info = await page.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const out = {};
    out.sidebarEls = [...document.querySelectorAll('[data-sidebar], [data-slot^="sidebar"], aside, nav')].slice(0, 40).map(e => ({ tag: e.tagName, ds: e.getAttribute('data-sidebar'), slot: e.getAttribute('data-slot'), state: e.getAttribute('data-state'), coll: e.getAttribute('data-collapsible'), variant: e.getAttribute('data-variant'), mobile: e.getAttribute('data-mobile'), cls: (e.className && e.className.toString ? e.className.toString() : '').slice(0, 140), box: r(e), z: getComputedStyle(e).zIndex, pos: getComputedStyle(e).position }));
    out.main = [...document.querySelectorAll('main')].map(e => ({ cls: e.className.toString().slice(0, 140), box: r(e), slot: e.getAttribute('data-slot') }));
    out.headerButtons = [...document.querySelectorAll('header button, [data-sidebar="trigger"]')].map(b => ({ txt: (b.innerText || '').trim().slice(0, 30), aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), ds: b.getAttribute('data-sidebar'), box: r(b) }));
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: `shots/explore-${W}.png` });
  await browser.close();
})();
