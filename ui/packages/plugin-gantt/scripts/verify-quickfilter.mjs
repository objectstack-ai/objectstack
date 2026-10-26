/**
 * Quick-filter (快速筛选) verification — drives the demo with ?quickfilter=1 (the
 * real ObjectGantt + a mock 排产计划 data source). Asserts the filter bar renders
 * a dropdown per configured dimension, that select + lookup options resolve to
 * their full domain (including reference values with no tasks), that selecting
 * an option narrows the visible bars AND auto-zooms the timeline, that two
 * dimensions combine with AND, and that Clear restores everything. Persists
 * screenshots into docs/verification/. Run with the demo up:
 *
 *   node packages/plugin-gantt/scripts/verify-quickfilter.mjs [--executable <chromium path>]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.GANTT_DEMO_URL || 'http://localhost:5199';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'verification');
mkdirSync(OUT, { recursive: true });

const exeIdx = process.argv.indexOf('--executable');
const executablePath = exeIdx > -1 ? process.argv[exeIdx + 1] : undefined;

const results = [];
const ok = (name, detail) => { results.push({ pass: true }); console.log(`  ✓ ${name} — ${detail}`); };
const fail = (name, detail) => { results.push({ pass: false }); console.error(`  ✗ ${name} — ${detail}`); };
const assert = (cond, name, detail) => (cond ? ok(name, detail) : fail(name, detail));

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

// Count the task bars currently rendered in the grid.
const barCount = () =>
  page.$$eval('[data-testid^="gantt-task-bar-"]', (els) => els.length).catch(() => 0);
// Full content width (px) of the timeline track. The grid renders the whole
// span at a fixed per-day scale and SCROLLS when it overflows the viewport;
// "auto-zoom" re-derives the range from the (now fewer) tasks, so the track
// shrinks toward the viewport width. Individual bar widths barely move in a
// fixed-scale day view, so the track's total width is the reliable signal.
const timelineWidth = () =>
  page.$eval('[data-testid="gantt-header-units"]', (el) => Math.round(el.getBoundingClientRect().width)).catch(() => 0);

try {
  console.log('\n[quickfilter] ?quickfilter=1 — ObjectGantt + 排产计划 mock');
  await page.goto(`${BASE}/?quickfilter=1`);
  await page.waitForSelector('[data-testid="quick-filter-bar"]');
  await page.waitForSelector('[data-testid^="gantt-task-bar-"]');

  // ── filter bar renders a dropdown per configured dimension ────────────────
  const triggers = await page.$$eval('[data-testid^="quick-filter-trigger-"]', (els) =>
    els.map((e) => e.getAttribute('data-testid')),
  );
  assert(triggers.length === 5, 'renders one dropdown per configured dimension', `${triggers.length} dropdowns`);

  const baseBars = await barCount();
  const baseTimelineWidth = await timelineWidth(); // full track width across all 8 tasks
  assert(baseBars === 8, 'all 8 plan tasks visible before filtering', `${baseBars} bars`);
  await page.screenshot({ path: join(OUT, '32-quickfilter-all.png') });
  console.log('  📸 32-quickfilter-all.png');

  // ── lookup option domain: 项目 pulls the full referenced object list ──────
  await page.click('[data-testid="quick-filter-trigger-project"]');
  await page.waitForSelector('[data-testid="quick-filter-panel-project"]');
  const projectOpts = await page.$$eval('[data-testid^="quick-filter-option-project-"]', (els) =>
    els.map((e) => e.textContent),
  );
  // pA/pB are in the data; pC has no tasks but still appears (full lookup domain).
  assert(
    projectOpts.length === 3 && projectOpts.some((t) => (t || '').includes('暂无任务')),
    'lookup 项目 shows full domain incl. the no-task reference value',
    `${projectOpts.length} options: ${projectOpts.join(' | ')}`,
  );
  await page.screenshot({ path: join(OUT, '33-quickfilter-project-options.png') });
  console.log('  📸 33-quickfilter-project-options.png');

  // Pick 项目A → bars narrow to that project's 4 tasks.
  await page.click('[data-testid="quick-filter-option-project-pA"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="gantt-task-bar-"]').length < 8,
  );
  const projBars = await barCount();
  assert(projBars === 4, '项目A filter narrows to its 4 tasks', `${projBars} bars`);
  // Close the project panel before opening the next.
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(OUT, '34-quickfilter-project-A.png') });
  console.log('  📸 34-quickfilter-project-A.png');

  // ── AND across dimensions: 项目A + 状态=待开始 ───────────────────────────
  await page.click('[data-testid="quick-filter-trigger-status"]');
  await page.waitForSelector('[data-testid="quick-filter-panel-status"]');
  const statusOpts = await page.$$eval('[data-testid^="quick-filter-option-status-"]', (els) => els.length);
  assert(statusOpts === 4, 'select 状态 resolves all 4 schema options', `${statusOpts} options`);
  await page.click('[data-testid="quick-filter-option-status-todo"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="gantt-task-bar-"]').length < 4,
  );
  const andBars = await barCount();
  // 项目A todo tasks: 下料-01, 质检-03, 总装-07 (焊接-02 is 进行中).
  assert(andBars === 3, '项目A AND 待开始 → 3 tasks (AND semantics)', `${andBars} bars`);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(OUT, '35-quickfilter-project-A-status-todo.png') });
  console.log('  📸 35-quickfilter-project-A-status-todo.png');

  // ── Clear restores the full set + axis ────────────────────────────────────
  await page.click('[data-testid="quick-filter-clear"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="gantt-task-bar-"]').length === 8,
  );
  const clearedBars = await barCount();
  assert(clearedBars === 8, 'Clear restores all 8 tasks', `${clearedBars} bars`);
  await page.screenshot({ path: join(OUT, '36-quickfilter-cleared.png') });
  console.log('  📸 36-quickfilter-cleared.png');

  // ── Auto-zoom probe: a single-task filter visibly shrinks the axis ────────
  // 状态=已完成 → only 返修-06 (early July), a far tighter span than the full set,
  // so the timeline re-derives to materially fewer columns (auto-zoom is free).
  await page.click('[data-testid="quick-filter-trigger-status"]');
  await page.waitForSelector('[data-testid="quick-filter-panel-status"]');
  await page.click('[data-testid="quick-filter-option-status-done"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="gantt-task-bar-"]').length === 1,
  );
  const doneBars = await barCount();
  const doneTimelineWidth = await timelineWidth();
  assert(doneBars === 1, '状态=已完成 narrows to the single done task', `${doneBars} bar`);
  assert(
    doneTimelineWidth < baseTimelineWidth * 0.6,
    'timeline auto-zooms to the filtered span (track shrinks toward the viewport)',
    `track width ${baseTimelineWidth}px → ${doneTimelineWidth}px`,
  );
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(OUT, '37-quickfilter-autozoom.png') });
  console.log('  📸 37-quickfilter-autozoom.png');

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed. Output: ${OUT}`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
} catch (err) {
  console.error(err);
  await browser.close();
  process.exit(1);
}
