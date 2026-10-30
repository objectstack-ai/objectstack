const { chromium } = require('playwright');
const fs = require('fs');
const SHOTS = '/tmp/claude-0/-home-claude-objectstack/7935dc52-4879-5e5d-a8db-0047aee0acbe/scratchpad/issue-27626/preview/shots/';
const BASE = 'http://localhost:38618';
const OBJ = process.argv[2] || 'crm_contact';
const PREFIX = process.argv[3] || '01';           // first shot number
const RUN = process.argv[4] || 'run1';
let n = parseInt(PREFIX, 10);
const nn = () => String(n++).padStart(2, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the issue's recipe, verbatim except the link index and returning the table instead of console.table
const recipe = async (idx) => {
  performance.setResourceTimingBufferSize(20000); performance.clearResourceTimings();
  const t0 = performance.now(); document.querySelectorAll('a[data-testid="primary-field-link"]')[idx].click();
  await new Promise(r => setTimeout(r, 7000));
  const g = {}; for (const r of performance.getEntriesByType('resource').filter(r => r.initiatorType !== 'script')) {
    const k = r.name.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') + (r.name.includes('top=50') ? ' [LIST]' : '');
    (g[k] = g[k] || { n: 0, first: 1e9 }).n++; g[k].first = Math.min(g[k].first, Math.round(r.startTime - t0)); }
  return Object.entries(g).map(([u, v]) => ({ u, ...v }));
};
const recipeClose = async () => {
  performance.setResourceTimingBufferSize(20000); performance.clearResourceTimings();
  const t0 = performance.now();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // not used; Playwright presses Escape
  return t0;
};
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const T0 = Date.now();
  let phase = 'signin';
  const log = { object: OBJ, run: RUN, viewport: '1440x900', startedAt: new Date(T0).toISOString(), phases: [], requests: [], responses: [], websockets: [], console: [], pageErrors: [], recipe: {}, drawer: {} };
  page.on('request', q => log.requests.push({ t: Date.now() - T0, phase, method: q.method(), type: q.resourceType(), url: q.url(), postData: q.postData() || undefined }));
  page.on('response', r => { const q = r.request(); if (!['script', 'stylesheet', 'image', 'font'].includes(q.resourceType())) log.responses.push({ t: Date.now() - T0, phase, status: r.status(), method: q.method(), url: q.url() }); });
  page.on('websocket', ws => { log.websockets.push({ t: Date.now() - T0, phase, url: ws.url() }); ws.on('close', () => log.websockets.push({ t: Date.now() - T0, phase, closed: ws.url() })); });
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.console.push({ t: Date.now() - T0, phase, type: m.type(), text: m.text().slice(0, 400) }); });
  page.on('pageerror', e => log.pageErrors.push({ t: Date.now() - T0, phase, text: String(e).slice(0, 400) }));
  const r = await page.request.post(BASE + '/api/v1/auth/sign-in/email', { data: { email: 'admin@objectos.ai', password: 'admin123' } });
  console.log('signin', r.status());
  const mark = (name) => { phase = name; log.phases.push({ name, start: Date.now() - T0 }); };
  const drawerInfo = async () => page.evaluate(() => {
    const els = [...document.querySelectorAll('[role="dialog"], [data-state="open"][class*="fixed"], [data-vaul-drawer], [class*="overlay"], [data-radix-dialog-overlay]')];
    return { url: location.href, title: document.title, dialogs: els.map(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { tag: e.tagName, role: e.getAttribute('role'), cls: (e.className && e.className.baseVal === undefined ? e.className : '').slice(0, 140), x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height), bg: cs.backgroundColor }; }), primaryLinks: document.querySelectorAll('a[data-testid="primary-field-link"]').length };
  });
  mark('list-load');
  await page.goto(BASE + `/apps/com.example.crm/${OBJ}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('a[data-testid="primary-field-link"]', { timeout: 180000 });
  await sleep(12000);
  log.links = await page.$$eval('a[data-testid="primary-field-link"]', as => as.map(a => a.textContent.trim() + ' | ' + a.getAttribute('href')));
  console.log('links', log.links);
  await page.screenshot({ path: SHOTS + `${nn()}-${OBJ}-list-before.png` });
  log.drawer.listBefore = await drawerInfo();

  const openPhase = async (name, idx, shotSlug) => {
    mark(name);
    const table = await page.evaluate(recipe, idx);
    log.recipe[name] = table;
    log.drawer[name] = await drawerInfo();
    await page.screenshot({ path: SHOTS + `${nn()}-${OBJ}-${shotSlug}.png` });
    await sleep(5000); // tail, still in same phase, to catch late requests
    log.phases[log.phases.length - 1].end = Date.now() - T0;
  };
  const closePhase = async (name, shotSlug) => {
    mark(name);
    await page.evaluate(() => { performance.setResourceTimingBufferSize(20000); performance.clearResourceTimings(); window.__tc = performance.now(); });
    await page.keyboard.press('Escape');
    await sleep(7000);
    log.recipe[name] = await page.evaluate(() => { const g = {}; for (const r of performance.getEntriesByType('resource').filter(r => r.initiatorType !== 'script')) { const k = r.name.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') + (r.name.includes('top=50') ? ' [LIST]' : ''); (g[k] = g[k] || { n: 0, first: 1e9 }).n++; g[k].first = Math.min(g[k].first, Math.round(r.startTime - window.__tc)); } return Object.entries(g).map(([u, v]) => ({ u, ...v })); });
    log.drawer[name] = await drawerInfo();
    if (shotSlug) await page.screenshot({ path: SHOTS + `${nn()}-${OBJ}-${shotSlug}.png` });
    await sleep(3000);
    log.phases[log.phases.length - 1].end = Date.now() - T0;
  };
  await openPhase('open1-cold', 0, 'drawer-cold');
  await closePhase('close1', 'list-after-close');
  await openPhase('open2-warm-other', 1, 'drawer-warm');
  await closePhase('close2', null);
  await openPhase('open3-warm-same', 0, 'drawer-warm-reopen');
  await closePhase('close3', null);
  mark('done');
  const shotsUsed = n;
  fs.writeFileSync(SHOTS + `${nn()}-${OBJ}-requests.json`, JSON.stringify(log, null, 2));
  console.log('nextShot', n);
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
