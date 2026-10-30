const { chromium } = require('playwright');
const fs = require('fs');
const { BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
const sampler = () => {
  window.__mount = [];
  const tick = () => {
    const s = document.querySelector('[data-sidebar="sidebar"]');
    if (s) { const c = s.parentElement; const m = document.querySelector('main'); window.__mount.push([Math.round(performance.now()), Math.round(c.getBoundingClientRect().width), c.getAttribute('data-console-rail'), m ? Math.round(m.getBoundingClientRect().x) : null]); }
    if (window.__mount.length < 300) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const compress = m => { const o = []; for (const r of m) { const k = r.slice(1).join(','); if (!o.length || o[o.length - 1].k !== k) o.push({ k, t: r[0], w: r[1], mode: r[2], mainX: r[3] }); } return o.map(({ k, ...x }) => x); };
(async () => {
  const browser = await chromium.launch();
  const out = {};
  const cases = {
    'fresh context, no prior state': async ctx => {},
    'prior wide-window session with sidebar expanded (cookie true)': async ctx => {
      const p = await ctx.newPage(); await p.setViewportSize({ width: 1440, height: 900 });
      await p.goto(URL0, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
      await p.keyboard.press('Control+b'); await p.waitForTimeout(500); await p.keyboard.press('Control+b'); await p.waitForTimeout(800);
      out.cookieBefore = await p.evaluate(() => document.cookie); await p.close();
    },
    'prior narrow session (already visited at 1280)': async ctx => {
      const p = await ctx.newPage(); await p.setViewportSize({ width: 1280, height: 900 });
      await p.goto(URL0, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500); await p.close();
    },
  };
  for (const [name, prep] of Object.entries(cases)) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p0 = await ctx.newPage();
    await p0.request.post(BASE + '/api/v1/auth/sign-in/email', { data: { email: 'admin@objectos.ai', password: 'admin123' } });
    await p0.close();
    await prep(ctx);
    await ctx.addInitScript(sampler);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const m = compress(await page.evaluate(() => window.__mount));
    out[name] = m;
    console.log(name, JSON.stringify(m));
    await ctx.close();
  }
  fs.writeFileSync('readings-p1-mount2.json', JSON.stringify(out, null, 2));
  await browser.close();
})();
