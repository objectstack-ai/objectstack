const { chromium } = require('playwright');
const fs = require('fs');
const { BASE } = require('./lib');
(async () => {
  const browser = await chromium.launch();
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: i === 0 ? { dir: 'video', size: { width: 1280, height: 900 } } : undefined });
    await ctx.addInitScript(() => {
      window.__mount = [];
      const tick = () => {
        const s = document.querySelector('[data-sidebar="sidebar"]');
        if (s) {
          const c = s.parentElement, w = document.querySelector('[data-collapsible]');
          const lab = s.querySelector('[data-sidebar="menu-button"] span');
          const cs = getComputedStyle(c);
          window.__mount.push({ t: Math.round(performance.now()), cw: Math.round(c.getBoundingClientRect().width), mode: c.getAttribute('data-console-rail'), st: w && w.getAttribute('data-state'), labelW: lab ? Math.round(lab.getBoundingClientRect().width) : null, trans: cs.transitionProperty + ' ' + cs.transitionDuration, z: cs.zIndex, mainX: (() => { const m = document.querySelector('main'); return m ? Math.round(m.getBoundingClientRect().x) : null; })() });
        }
        if (window.__mount.length < 400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const page = await ctx.newPage();
    await page.request.post(BASE + '/api/v1/auth/sign-in/email', { data: { email: 'admin@objectos.ai', password: 'admin123' } });
    await page.goto(BASE + '/apps/com.example.crm/crm_contact', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => window.__mount);
    // collapse consecutive identical rows
    const comp = [];
    for (const r of m) { const k = JSON.stringify({ ...r, t: 0 }); if (!comp.length || comp[comp.length - 1].k !== k) comp.push({ k, ...r }); }
    runs.push(comp.map(({ k, ...r }) => r).slice(0, 20));
    // also: reload in same context (sidebar_state cookie now exists)
    await page.evaluate(() => { window.__mount = []; });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const m2 = await page.evaluate(() => window.__mount);
    const comp2 = [];
    for (const r of m2) { const k = JSON.stringify({ ...r, t: 0 }); if (!comp2.length || comp2[comp2.length - 1].k !== k) comp2.push({ k, ...r }); }
    runs.push({ reload: comp2.map(({ k, ...r }) => r).slice(0, 20) });
    await ctx.close();
  }
  fs.writeFileSync('readings-p1-mount.json', JSON.stringify(runs, null, 2));
  console.log(JSON.stringify(runs, null, 0).replace(/\},\{/g, '},\n{'));
  await browser.close();
})();
