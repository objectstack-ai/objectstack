const L = require('./lib');
function summarize(frames) {
  const withSb = frames.filter(f => f.w !== null);
  const widths = {}; withSb.forEach(f => widths[f.w] = (widths[f.w]||0)+1);
  const states = {}; withSb.forEach(f => states[f.st] = (states[f.st]||0)+1);
  return { totalFrames: frames.length, framesBeforeSidebar: frames.length - withSb.length,
    firstSidebarFrame: withSb[0], widthCounts: widths, stateCounts: states, nonRail: withSb.filter(f=>f.w!==48).slice(0,10) };
}
async function frames(page) { return page.evaluate(() => window.__frames); }
async function mainX(page) { return page.evaluate(() => { const m = document.querySelector('main'); return m ? Math.round(m.getBoundingClientRect().x) : null; }); }
(async () => {
  const b = await L.chromium.launch();
  const out = {};
  // Case 1: first visit at 1280
  { const { ctx, page, errors } = await L.newCtx(b, 1280, { frames: true });
    await page.goto(L.URL); await L.waitApp(page);
    out.case1 = { summary: summarize(await frames(page)), after: await L.state(page), mainX: await mainX(page), errors };
    await page.screenshot({ path: L.SHOTS + '28077-case1-first-visit-1280.png' });
    await ctx.close(); }
  // Case 2: expanded at 1440, then load at 1280
  { const { ctx, page, errors } = await L.newCtx(b, 1440, { frames: true });
    await page.goto(L.URL); await L.waitApp(page);
    let s = await L.state(page);
    if (s.state !== 'expanded') { await page.click('[data-sidebar="trigger"]'); await page.waitForTimeout(600); }
    // explicitly toggle collapse + expand to make an "expanded choice"
    await page.click('[data-sidebar="trigger"]'); await page.waitForTimeout(600);
    await page.click('[data-sidebar="trigger"]'); await page.waitForTimeout(600);
    const at1440 = await L.state(page);
    await page.screenshot({ path: L.SHOTS + '28077-case2-expanded-1440-before.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload(); await L.waitApp(page);
    out.case2 = { at1440, summary: summarize(await frames(page)), after: await L.state(page), errors };
    await page.screenshot({ path: L.SHOTS + '28077-case2-narrow-load-1280.png' });
    // also a fresh page (new tab) at 1280 in same profile
    const p2 = await ctx.newPage(); await p2.setViewportSize({ width: 1280, height: 900 });
    await p2.goto(L.URL); await L.waitApp(p2);
    out.case2newTab = { summary: summarize(await frames(p2)), after: await L.state(p2) };
    await ctx.close(); }
  // Case 3: reload while overlay shown at 1280
  { const { ctx, page, errors } = await L.newCtx(b, 1280, { frames: true });
    await page.goto(L.URL); await L.waitApp(page);
    await page.mouse.click(24, 700); await page.waitForTimeout(600);
    const overlay = await L.state(page);
    await page.screenshot({ path: L.SHOTS + '28077-case3-overlay-before-reload-1280.png' });
    await page.reload(); await L.waitApp(page);
    out.case3 = { overlay, summary: summarize(await frames(page)), after: await L.state(page), errors };
    await page.screenshot({ path: L.SHOTS + '28077-case3-after-reload-1280.png' });
    // Variation: keep-open on, then reload
    await page.mouse.click(24, 700); await page.waitForTimeout(600);
    const ko = await page.$('[data-testid="sidebar-keep-open"]');
    if (ko) { await ko.click(); await page.waitForTimeout(600);
      const kept = await L.state(page);
      await page.reload(); await L.waitApp(page);
      out.case3keepOpenReload = { kept, summary: summarize(await frames(page)), after: await L.state(page) };
      await page.screenshot({ path: L.SHOTS + '28077-extra-keepopen-reload-1280.png' }); }
    await ctx.close(); }
  // 1440 checks: first visit
  { const { ctx, page, errors } = await L.newCtx(b, 1440, { frames: true });
    await page.goto(L.URL); await L.waitApp(page);
    out.wide1440 = { summary: summarize(await frames(page)), after: await L.state(page), mainX: await mainX(page), errors };
    await page.screenshot({ path: L.SHOTS + '28077-wide-1440-first-visit.png' });
    await page.reload(); await L.waitApp(page);
    out.wide1440reload = { summary: summarize(await frames(page)), after: await L.state(page), mainX: await mainX(page) };
    await ctx.close(); }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
