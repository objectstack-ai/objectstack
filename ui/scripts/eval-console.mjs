import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = '/Users/zhuangjianguo/.copilot/session-state/16a41482-74c9-4a0e-96a7-c598011f1f0b/files';
const URL = 'http://localhost:5173/console/apps/crm_enterprise/account';

const sizes = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop',  width: 1280, height: 800 },
  { name: 'tablet',  width: 1024, height: 768 },
  { name: 'mobile',  width: 390,  height: 844 },
];

const consoleMsgs = [];
const failedReqs = [];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('console', m => consoleMsgs.push({ type: m.type(), text: m.text() }));
page.on('pageerror', e => consoleMsgs.push({ type: 'pageerror', text: e.message }));
page.on('requestfailed', r => failedReqs.push({ url: r.url(), reason: r.failure()?.errorText }));
page.on('response', r => {
  if (r.status() >= 400) failedReqs.push({ url: r.url(), status: r.status() });
});

const t0 = Date.now();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
const loadMs = Date.now() - t0;

await page.waitForTimeout(3000);
const earlyTitle = await page.title();
const earlyUrl = page.url();
console.error('after goto:', earlyUrl, '|', earlyTitle);
await page.screenshot({ path: path.join(OUT, 'after-goto.png') });

const metrics = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paints = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, p.startTime]));
  return {
    domContentLoaded: nav.domContentLoadedEventEnd,
    loadEvent: nav.loadEventEnd,
    transferSize: nav.transferSize,
    fcp: paints['first-contentful-paint'],
    fp: paints['first-paint'],
    resources: performance.getEntriesByType('resource').length,
  };
});

// Layout audit
const audit = await page.evaluate(() => {
  const out = { issues: [] };
  const w = window.innerWidth, h = window.innerHeight;
  out.viewport = { w, h };
  // Header height
  const header = document.querySelector('header, [role="banner"]');
  if (header) out.headerHeight = header.getBoundingClientRect().height;
  // Sidebar
  const sidebar = document.querySelector('[data-sidebar], aside, nav[aria-label]');
  if (sidebar) out.sidebarWidth = sidebar.getBoundingClientRect().width;
  // Table
  const table = document.querySelector('table');
  if (table) {
    const r = table.getBoundingClientRect();
    out.tableWidth = r.width;
    out.tableHeight = r.height;
    out.tableOverflowsRight = r.right > w + 2;
    const ths = [...table.querySelectorAll('thead th, thead td')].map(th => ({
      text: th.innerText.slice(0, 40),
      width: th.getBoundingClientRect().width,
    }));
    out.columns = ths;
  }
  // Buttons in toolbar — touch target sizes
  const toolbarBtns = [...document.querySelectorAll('main button')];
  out.toolbarButtonCount = toolbarBtns.length;
  out.smallButtons = toolbarBtns
    .filter(b => {
      const r = b.getBoundingClientRect();
      return r.height < 28 && r.height > 0;
    })
    .map(b => ({ text: b.innerText.slice(0, 30), h: b.getBoundingClientRect().height }));
  // Empty cells
  const dashCount = [...document.querySelectorAll('table td')].filter(td => td.innerText.trim() === '—' || td.innerText.trim() === 'No value').length;
  out.emptyCellCount = dashCount;
  // Page padding
  const main = document.querySelector('main');
  if (main) {
    const cs = getComputedStyle(main);
    out.mainPadding = { top: cs.paddingTop, left: cs.paddingLeft, right: cs.paddingRight };
  }
  // Heading
  const h1 = document.querySelector('h1');
  if (h1) {
    const cs = getComputedStyle(h1);
    out.h1 = { fontSize: cs.fontSize, fontWeight: cs.fontWeight, text: h1.innerText };
  }
  // Horizontal scroll
  out.docScrollWidth = document.documentElement.scrollWidth;
  out.bodyOverflowX = document.body.scrollWidth > w;
  return out;
});

// Screenshots at all sizes
const shots = {};
for (const s of sizes) {
  await page.setViewportSize({ width: s.width, height: s.height });
  await page.waitForTimeout(500);
  const fp = path.join(OUT, `account-${s.name}.png`);
  await page.screenshot({ path: fp, fullPage: false });
  shots[s.name] = fp;
}

// Try interactions: open new dialog, filters
const interactions = {};
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const filterBtn = page.getByRole('button', { name: '筛选', exact: true });
  if (await filterBtn.count()) {
    await filterBtn.first().click();
    await page.waitForTimeout(600);
    const fp = path.join(OUT, 'account-filter-open.png');
    await page.screenshot({ path: fp });
    interactions.filter = fp;
    await page.keyboard.press('Escape');
  }
} catch (e) { interactions.filterErr = String(e); }

try {
  const newBtn = page.getByRole('button', { name: '新建', exact: true });
  if (await newBtn.count()) {
    await newBtn.first().click();
    await page.waitForTimeout(800);
    const fp = path.join(OUT, 'account-new-open.png');
    await page.screenshot({ path: fp });
    interactions.newDialog = fp;
    await page.keyboard.press('Escape');
  }
} catch (e) { interactions.newErr = String(e); }

const report = {
  url: URL,
  loadMs,
  metrics,
  audit,
  shots,
  interactions,
  consoleMsgs: consoleMsgs.slice(0, 50),
  consoleErrorCount: consoleMsgs.filter(m => m.type === 'error' || m.type === 'pageerror').length,
  failedReqs: failedReqs.slice(0, 30),
};
fs.writeFileSync(path.join(OUT, 'eval-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
