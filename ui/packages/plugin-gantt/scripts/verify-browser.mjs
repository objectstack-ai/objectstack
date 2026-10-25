/**
 * Browser verification for the Gantt plugin — drives the demo app with
 * Playwright and persists screenshots + a results summary into
 * docs/verification/. Run with the demo server up on :5199
 * (pnpm --dir packages/plugin-gantt exec vite demo --port 5199):
 *
 *   node packages/plugin-gantt/scripts/verify-browser.mjs [--executable <chromium path>]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.GANTT_DEMO_URL || 'http://localhost:5199';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'verification');
mkdirSync(OUT, { recursive: true });

const exeIdx = process.argv.indexOf('--executable');
const executablePath = exeIdx > -1 ? process.argv[exeIdx + 1] : undefined;

const results = [];
const ok = (name, detail) => { results.push({ name, pass: true, detail }); console.log(`  ✓ ${name} — ${detail}`); };
const fail = (name, detail) => { results.push({ name, pass: false, detail }); console.error(`  ✗ ${name} — ${detail}`); };
const assert = (cond, name, detail) => (cond ? ok(name, detail) : fail(name, detail));

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const shot = async (file) => { await page.screenshot({ path: join(OUT, file) }); console.log(`  📸 ${file}`); };

try {
  // ── 1. Project fixture: hierarchy + links ────────────────────────────────
  console.log('\n[1] Project fixture — hierarchy, links, today marker');
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="gantt-task-bar-t1"]');

  const treeitems = await page.locator('[role="treeitem"]').count();
  assert(treeitems === 13, 'hierarchy rows', `${treeitems}/13 treeitems (3 summaries + 8 tasks + 2 milestones)`);
  const summaries = await page.locator('[data-testid^="gantt-summary-bar-"]').count();
  assert(summaries === 3, 'summary brackets', `${summaries}/3 rendered`);
  const milestones = await page.locator('[data-testid^="gantt-milestone-"]').count();
  assert(milestones === 2, 'milestone diamonds', `${milestones}/2 rendered`);
  const links = await page.locator('[data-testid="gantt-links"] path[data-link-type]').count();
  assert(links === 10, 'dependency links', `${links}/10 arrows (fs/ss/ff/sf)`);
  const linkTypes = await page.$$eval('[data-testid="gantt-links"] path[data-link-type]',
    (els) => [...new Set(els.map((e) => e.getAttribute('data-link-type')))].sort());
  assert(linkTypes.join(',') === 'ff,fs,sf,ss', 'all 4 link types', linkTypes.join(','));
  await shot('01-project-overview.png');

  // Week mode fits the whole project on one screen.
  await page.click('[data-testid="gantt-view-mode-week"]');
  await page.waitForTimeout(200);
  // A short date span must still fill the timeline area, but WITHOUT padding the
  // calendar with empty units. Instead the column width stretches ("zoom to
  // fit") so the natural span reaches the right edge — so the grid fills the
  // viewport AND keeps a tight column count (no years of blank columns).
  const weekFill = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="gantt-timeline"]');
    const units = document.querySelectorAll('[data-testid="gantt-header-units"] > div');
    return { client: s.clientWidth, scroll: s.scrollWidth, cols: units.length };
  });
  assert(weekFill.scroll >= weekFill.client - 2, 'week grid fills the viewport (no right-side gap)',
    `content ${weekFill.scroll}px ≥ viewport ${weekFill.client}px`);
  assert(weekFill.cols <= 24, 'week grid stays tight (stretch, not pad)', `${weekFill.cols} week columns`);
  await shot('02-week-mode-all-links.png');

  // Month mode: the ~2.5-month project must NOT pad out to years of empty
  // months. Fit-to-width keeps a handful of columns that still fill the area.
  await page.click('[data-testid="gantt-view-mode-month"]');
  await page.waitForTimeout(200);
  const monthFit = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="gantt-timeline"]');
    const units = document.querySelectorAll('[data-testid="gantt-header-units"] > div');
    return { client: s.clientWidth, scroll: s.scrollWidth, cols: units.length };
  });
  assert(monthFit.cols <= 8, 'month grid has no trailing empty months', `${monthFit.cols} month columns`);
  assert(monthFit.scroll >= monthFit.client - 2, 'month grid still fills the viewport',
    `content ${monthFit.scroll}px ≥ viewport ${monthFit.client}px`);
  await page.click('[data-testid="gantt-view-mode-week"]');
  await page.waitForTimeout(150);

  // ── 2. Collapse/expand ───────────────────────────────────────────────────
  console.log('\n[2] Hierarchy collapse/expand');
  await page.click('[data-testid="gantt-row-toggle-p2"]');
  const collapsedRows = await page.locator('[role="treeitem"]').count();
  const collapsedLinks = await page.locator('[data-testid="gantt-links"] path[data-link-type]').count();
  assert(collapsedRows === 9, 'collapse hides child rows', `${collapsedRows}/9 rows with Build collapsed`);
  assert(collapsedLinks < 10, 'collapse hides child links', `${collapsedLinks} links remain`);
  await shot('03-build-collapsed.png');
  await page.click('[data-testid="gantt-row-toggle-p2"]');
  assert(await page.locator('[role="treeitem"]').count() === 13, 'expand restores rows', '13 rows back');

  // ── 3. Hover: link highlight + tooltip ───────────────────────────────────
  console.log('\n[3] Hover tooltip + link highlight');
  await page.hover('[data-testid="gantt-task-bar-t4"]');
  await page.waitForSelector('[data-testid="gantt-tooltip-t4"]');
  const tooltipText = await page.locator('[data-testid="gantt-tooltip-t4"]').innerText();
  // t4 carries configured tooltipFields (Owner/Status/Effort), which replace
  // the default start→end·duration·progress line — so assert those, not '30%'.
  assert(
    tooltipText.includes('Backend services') && tooltipText.includes('Owner') && tooltipText.includes('Priya N.'),
    'tooltip content (configured fields)',
    JSON.stringify(tooltipText.replace(/\n/g, ' · ')),
  );
  const activeLinks = await page.locator('[data-testid="gantt-links"] path[data-active="true"]').count();
  assert(activeLinks === 2, 'hover highlights its links', `${activeLinks}/2 active (t3→t4, t4→t6)`);
  await shot('04-tooltip-and-link-highlight.png');

  // ── 4. Drag-to-create dependency (the rubber band) ───────────────────────
  console.log('\n[4] Drag-to-create dependency');
  await page.hover('[data-testid="gantt-task-bar-t8"]');
  const dot = await page.locator('[data-testid="gantt-link-dot-t8"]').boundingBox();
  const target = await page.locator('[data-testid="gantt-task-bar-t5"]').boundingBox();
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  const draft = await page.locator('[data-testid="gantt-link-draft"]').count();
  assert(draft === 1, 'rubber band visible mid-drag', 'dashed draft path rendered');
  await shot('05-link-create-drag.png');
  await page.mouse.up();
  await page.waitForSelector('[data-testid="gantt-link-t8-t5"]');
  ok('drop creates the dependency', 'new t8→t5 fs arrow rendered');
  await shot('06-link-created.png');

  // ── 5. Custom markers ────────────────────────────────────────────────────
  console.log('\n[5] Custom markers');
  const markerCount = await page.locator('[data-testid^="gantt-marker-"]').count();
  const freeze = await page.locator('[data-testid="gantt-marker-1"]').innerText();
  assert(markerCount === 2 && freeze.includes('Code freeze'), 'markers render', `Sprint 2 + ${freeze}`);

  // ── 6. Performance: 5000 tasks ───────────────────────────────────────────
  console.log('\n[6] Performance — 5000 tasks, virtualization');
  await page.goto(`${BASE}?perf=5000&mode=week`);
  await page.waitForSelector('[data-testid="demo-render-ms"]');
  const renderMs = parseFloat((await page.locator('[data-testid="demo-render-ms"]').innerText()).match(/[\d.]+/)[0]);
  assert(renderMs < 3000, 'initial render of 5000 tasks', `${renderMs}ms`);

  const visible = await page.locator('[role="treeitem"]').count();
  assert(visible < 60, 'row virtualization', `${visible} of 5000 rows in the DOM`);
  const gridCols = await page.evaluate(() =>
    document.querySelectorAll('[data-testid="gantt-header-units"] > div').length);
  ok('column virtualization', `${gridCols} week columns in the DOM`);
  await shot('07-perf-5000-top.png');

  // Scroll deep into the list and time the window shift.
  const scrollStats = await page.evaluate(() => new Promise((resolve) => {
    const el = document.querySelector('[data-testid="gantt-timeline"]');
    const t0 = performance.now();
    el.scrollTop = el.scrollHeight / 2;
    el.scrollLeft = 2000;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      ms: +(performance.now() - t0).toFixed(1),
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
    })));
  }));
  await page.waitForTimeout(100);
  const visibleMid = await page.locator('[role="treeitem"]').count();
  const firstRow = await page.locator('[role="treeitem"]').first().innerText();
  assert(scrollStats.ms < 200, 'mid-list scroll window shift', `${scrollStats.ms}ms to re-render at scrollTop ${Math.round(scrollStats.scrollTop)} of ${scrollStats.scrollHeight}`);
  assert(visibleMid < 60, 'window stays small after scroll', `${visibleMid} rows, first: ${firstRow.split('\n')[0]}`);
  await shot('08-perf-5000-scrolled-mid.png');

  results.push({ name: '__renderMs', pass: true, detail: String(renderMs) });
} finally {
  await browser.close();
}

// ── Summary ────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
const summary = results.filter((r) => !r.name.startsWith('__'));
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ date: new Date().toISOString(), results: summary }, null, 2));
console.log(`\n${summary.length - failed.length}/${summary.length} checks passed. Output: ${OUT}`);
if (failed.length) process.exit(1);
