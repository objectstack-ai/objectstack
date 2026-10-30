const { chromium } = require('playwright');
const BASE = 'http://localhost:45293';
async function open(browser, W, H = 900, ctxIn) {
  const ctx = ctxIn || await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  await page.request.post(BASE + '/api/v1/auth/sign-in/email', { data: { email: 'admin@objectos.ai', password: 'admin123' } });
  return { ctx, page, consoleErrors };
}
async function measure(page) {
  return page.evaluate(() => {
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
    const inner = document.querySelector('[data-sidebar="sidebar"]');
    let chain = [];
    let e = inner;
    while (e && e !== document.body && chain.length < 6) {
      const cs = getComputedStyle(e);
      chain.push({ tag: e.tagName, attrs: Object.fromEntries([...e.attributes].filter(a => a.name.startsWith('data-') || a.name === 'role' || a.name === 'aria-hidden').map(a => [a.name, a.value])), box: r(e), pos: cs.position, z: cs.zIndex, w: cs.width, shadow: cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 60) : 'none' });
      e = e.parentElement;
    }
    const main = document.querySelector('main');
    const wrapper = document.querySelector('[data-collapsible], .group.peer, [data-slot="sidebar"]');
    const sheet = document.querySelector('[data-mobile="true"], [role="dialog"][data-sidebar="sidebar"]');
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].map(d => ({ attrs: Object.fromEntries([...d.attributes].filter(a => a.name.startsWith('data-') || a.name === 'role').map(a => [a.name, a.value])), box: r(d), z: getComputedStyle(d).zIndex }));
    const overlays = [...document.querySelectorAll('[data-state="open"].fixed, .fixed.inset-0')].map(d => ({ cls: d.className.toString().slice(0, 100), box: r(d), z: getComputedStyle(d).zIndex }));
    const ls = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/side|rail|pin|nav/i.test(k)) ls[k] = localStorage.getItem(k).slice(0, 200); } } catch (e) { }
    return {
      url: location.pathname + location.search,
      vw: innerWidth,
      inner: r(inner),
      innerVisible: inner ? (getComputedStyle(inner).visibility + '/' + getComputedStyle(inner).display) : null,
      chain,
      wrapperAttrs: wrapper ? Object.fromEntries([...wrapper.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value])) : null,
      main: r(main),
      mainCount: document.querySelectorAll('main').length,
      dialogs, overlays,
      cookieSidebar: document.cookie.split('; ').filter(c => /side|rail|pin/i.test(c)),
      ls,
      footer: [...document.querySelectorAll('[data-sidebar="footer"]')].map(f => ({ box: r(f), text: f.innerText.trim().replace(/\n+/g, ' | ').slice(0, 200) })),
      menuTextVisible: [...document.querySelectorAll('[data-sidebar="menu-button"] span')].slice(0, 3).map(s => ({ t: s.innerText, box: r(s), op: getComputedStyle(s).opacity })),
    };
  });
}
module.exports = { open, measure, BASE };
// start recording main + sidebar rects every animation frame
async function startSampler(page) {
  await page.evaluate(() => {
    window.__samples = [];
    window.__sampling = true;
    const tick = () => {
      if (!window.__sampling) return;
      const m = document.querySelector('main').getBoundingClientRect();
      const s = document.querySelector('[data-sidebar="sidebar"]');
      const sb = s ? s.getBoundingClientRect() : { x: -1, width: -1 };
      window.__samples.push([Math.round(m.x * 10) / 10, Math.round(m.width * 10) / 10, Math.round(sb.width * 10) / 10]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function stopSampler(page) {
  return page.evaluate(() => {
    window.__sampling = false;
    const s = window.__samples || [];
    const xs = s.map(a => a[0]), ws = s.map(a => a[1]), sw = s.map(a => a[2]);
    return { frames: s.length, mainX: [Math.min(...xs), Math.max(...xs)], mainW: [Math.min(...ws), Math.max(...ws)], sidebarW: [Math.min(...sw), Math.max(...sw)] };
  });
}
async function state(page) {
  return page.evaluate(() => {
    const w = document.querySelector('[data-collapsible]') || document.querySelector('[data-state][data-side]');
    const inner = document.querySelector('[data-sidebar="sidebar"]');
    const cont = inner && inner.parentElement;
    const main = document.querySelector('main');
    const rb = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, w: Math.round(b.width * 10) / 10, y: Math.round(b.y), h: Math.round(b.height) }; };
    return {
      path: location.pathname,
      dataState: w && w.getAttribute('data-state'),
      rail: cont && cont.getAttribute('data-console-rail'),
      containerZ: cont && getComputedStyle(cont).zIndex,
      containerPos: cont && getComputedStyle(cont).position,
      sidebar: rb(cont),
      main: rb(main),
      footerText: [...document.querySelectorAll('[data-sidebar="footer"]')].map(f => f.innerText.trim().replace(/\n+/g, ' | ')).join(' || '),
      mobileSheet: !!document.querySelector('[data-mobile="true"]'),
    };
  });
}
module.exports.startSampler = startSampler;
module.exports.stopSampler = stopSampler;
module.exports.state = state;
