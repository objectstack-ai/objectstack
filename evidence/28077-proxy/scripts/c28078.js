const L = require('./lib');
async function tooltips(page) { return page.evaluate(() => [...document.querySelectorAll('[role=tooltip]')].map(t => ({ text: t.textContent.trim().slice(0,30), display: getComputedStyle(t).display, vis: getComputedStyle(t).visibility }))); }
async function openOverlay(page) {
  await page.mouse.click(24, 700); await page.waitForTimeout(700);
  return L.state(page);
}
async function navItems(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-sidebar="sidebar"] [data-sidebar="menu-button"], [data-sidebar="sidebar"] a')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.height>0&&r.y>60&&r.y<800;}).map(e => ({ tag: e.tagName, text: e.textContent.trim().slice(0,30), x: Math.round(e.getBoundingClientRect().x + e.getBoundingClientRect().width/2), y: Math.round(e.getBoundingClientRect().y + e.getBoundingClientRect().height/2), sb: e.getAttribute('data-sidebar') })));
}
(async () => {
  const b = await L.chromium.launch();
  const out = {};
  const scenarios = ['pointer-nav', 'focus-nav-tab', 'focus-nav-programmatic', 'focus-keepopen-tab', 'focus-keepopen-programmatic', 'pointer-nav-then-focus-keepopen'];
  for (const sc of scenarios) {
    const { ctx, page, errors } = await L.newCtx(b, 1280);
    await page.goto(L.URL); await L.waitApp(page);
    const res = { before: await openOverlay(page) };
    const items = await navItems(page);
    res.navCount = items.length;
    const item = items.find(i => i.sb === 'menu-button' && i.text) || items[0];
    res.item = item;
    if (sc.startsWith('pointer-nav')) {
      await page.mouse.move(item.x, item.y); await page.waitForTimeout(1200);
    }
    if (sc === 'focus-nav-programmatic') {
      await page.evaluate(({x,y}) => document.elementFromPoint(x,y).closest('a,button').focus(), item);
    }
    if (sc === 'focus-nav-tab' || sc === 'focus-keepopen-tab' ) {
      // move pointer off the sidebar to content area that won't fold it? keep pointer on the overlay's header to stay neutral
      const target = sc === 'focus-nav-tab' ? 'nav' : 'keep';
      let found = false;
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab'); await page.waitForTimeout(40);
        const info = await page.evaluate(() => { const a = document.activeElement; return { inSb: !!a.closest('[data-sidebar="sidebar"]'), sb: a.getAttribute('data-sidebar'), tid: a.getAttribute('data-testid'), text: a.textContent.trim().slice(0,30), tag: a.tagName, href: a.getAttribute('href') }; });
        if (target === 'nav' && info.inSb && (info.sb === 'menu-button' || info.tag==='A') && info.href) { res.tabbedTo = info; res.tabs = i+1; found = true; break; }
        if (target === 'keep' && info.tid === 'sidebar-keep-open') { res.tabbedTo = info; res.tabs = i+1; found = true; break; }
      }
      res.found = found;
      res.stateAfterTabbing = await L.state(page);
    }
    if (sc === 'focus-keepopen-programmatic' || sc === 'pointer-nav-then-focus-keepopen') {
      await page.focus('[data-testid="sidebar-keep-open"]');
    }
    await page.waitForTimeout(800);
    res.preEsc = await L.state(page);
    res.tooltipsPreEsc = await tooltips(page);
    await page.screenshot({ path: L.SHOTS + `28078-${sc}-before-esc.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    res.afterEsc1 = await L.state(page);
    res.tooltipsAfterEsc1 = await tooltips(page);
    await page.screenshot({ path: L.SHOTS + `28078-${sc}-after-1-esc.png` });
    if (res.afterEsc1.state !== 'collapsed' || res.afterEsc1.panelW !== 48) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(700);
      res.afterEsc2 = await L.state(page);
    }
    res.errors = errors;
    out[sc] = res;
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
