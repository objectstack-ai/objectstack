const { chromium } = require('playwright');
const URL = 'http://localhost:5317/apps/com.example.crm/crm_contact';
const SHOTS = __dirname + '/shots/';
const INIT = `
(() => {
  window.__frames = [];
  const t0 = performance.now();
  function tick() {
    const sb = document.querySelector('[data-sidebar="sidebar"]');
    let w = null, st = null;
    if (sb) { const p = sb.parentElement; w = Math.round(p.getBoundingClientRect().width); 
      const wrap = sb.closest('[data-state]'); st = wrap ? wrap.getAttribute('data-state') : null; }
    window.__frames.push({t: Math.round(performance.now()-t0), w, st, path: location.pathname});
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();`;
async function newCtx(browser, width, opts={}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const errors = [];
  if (opts.frames) await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type()==='error') errors.push(m.text().slice(0,300)); });
  page.on('pageerror', e => errors.push('PAGEERROR '+String(e).slice(0,300)));
  const r = await page.request.post('http://localhost:5317/api/v1/auth/sign-in/email', { data: { email:'admin@objectos.ai', password:'admin123' } });
  if (!r.ok()) throw new Error('signin '+r.status());
  return { ctx, page, errors };
}
async function state(page) {
  return page.evaluate(() => {
    const sb = document.querySelector('[data-sidebar="sidebar"]');
    if (!sb) return { none: true };
    const p = sb.parentElement; const r = p.getBoundingClientRect();
    const wrap = sb.closest('[data-state]');
    const ae = document.activeElement;
    const ko = document.querySelector('[data-testid="sidebar-keep-open"]');
    return { panelW: Math.round(r.width), panelX: Math.round(r.x), state: wrap && wrap.getAttribute('data-state'),
      collapsible: wrap && wrap.getAttribute('data-collapsible'), variant: wrap && wrap.getAttribute('data-variant'),
      keepOpen: ko ? (ko.getAttribute('aria-checked') || ko.getAttribute('aria-pressed') || ko.getAttribute('data-state') || 'present') : null,
      active: ae ? (ae.tagName + ' ' + (ae.getAttribute('data-testid')||'') + ' ' + (ae.textContent||'').trim().slice(0,30)) : null };
  });
}
async function waitApp(page) {
  await page.waitForSelector('[data-sidebar="sidebar"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
}
module.exports = { chromium, URL, SHOTS, newCtx, state, waitApp };
