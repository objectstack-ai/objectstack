const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, BASE } = require('./lib');
(async () => {
  const browser = await chromium.launch();
  const out = { point: 1 };
  const { ctx, page, consoleErrors } = await open(browser, 1280);
  // record every frame from document start: sidebar width + main box
  await ctx.addInitScript(() => {
    window.__mount = [];
    const t0 = performance.now();
    const tick = () => {
      const s = document.querySelector('[data-sidebar="sidebar"]');
      const m = document.querySelector('main');
      if (s || m) {
        const sb = s ? s.parentElement.getBoundingClientRect() : null;
        const mb = m ? m.getBoundingClientRect() : null;
        window.__mount.push([Math.round(performance.now() - t0), sb ? Math.round(sb.width) : null, s ? s.parentElement.getAttribute('data-console-rail') : null, mb ? Math.round(mb.x) : null, mb ? Math.round(mb.width) : null]);
      }
      if (window.__mount.length < 2000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(BASE + '/apps/crm_app/crm_contact', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  out.surface = page.url();
  out.state = await state(page);
  const mount = await page.evaluate(() => window.__mount);
  const sidebarWidths = [...new Set(mount.map(r => r[1]))];
  const mainLefts = [...new Set(mount.filter(r => r[3] !== null).map(r => r[3]))];
  const mainWidths = [...new Set(mount.filter(r => r[4] !== null).map(r => r[4]))];
  out.mountFrames = { frames: mount.length, distinctSidebarWidths: sidebarWidths, distinctMainLefts: mainLefts, distinctMainWidths: mainWidths, first: mount.slice(0, 3), modes: [...new Set(mount.map(r => r[2]))] };
  out.expectMainWidth = 1280 - 48;
  out.pass = out.state.sidebar.w === 48 && out.state.main.x === 48 && out.state.main.w === 1232 && out.state.rail === 'rail';
  await page.screenshot({ path: 'shots/p1-1280-rail.png' });
  // other surfaces at 1280
  out.otherSurfaces = [];
  for (const p of ['/apps/com.example.crm/crm_account', '/apps/com.example.crm/dashboard/pipeline_dashboard', '/apps/com.example.crm/crm_lead']) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    out.otherSurfaces.push(await state(page));
  }
  await page.screenshot({ path: 'shots/p1-1280-rail-leads.png' });
  out.consoleErrors = consoleErrors;
  // fresh context, also 1366 and 1415/1416/1417 to probe threshold
  out.thresholdProbe = [];
  for (const W of [1024, 1366, 1415, 1416, 1417, 1440]) {
    const o = await open(browser, W);
    await o.page.goto(BASE + '/apps/com.example.crm/crm_contact', { waitUntil: 'networkidle' });
    await o.page.waitForTimeout(1200);
    const s = await state(o.page);
    out.thresholdProbe.push({ W, rail: s.rail, dataState: s.dataState, sidebarW: s.sidebar && s.sidebar.w, mainX: s.main.x, mainW: s.main.w });
    await o.ctx.close();
  }
  fs.writeFileSync('readings-p1.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
