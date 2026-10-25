/**
 * Browser verification for Phase 6.2 — baselines, working calendar, undo/redo.
 *
 * Drives the demo and asserts:
 *   1. Baselines — planned-vs-actual reference strips render for the tasks that
 *      carry baselineStart/baselineEnd (t1, t4, t5); `?baselines=0` removes
 *      them; the slipped task (t4: planned end Jul 2, actual Jul 8) shows a
 *      baseline strip NARROWER than and offset from its live bar.
 *   2. Working calendar — with `?cal=1`, auto-scheduling snaps every moved
 *      task to a working-day boundary (no Saturday/Sunday starts), and the
 *      result differs from the calendar-off run on the same fixture.
 *   3. Undo/redo — a drag is undoable (bar returns to its exact origin) and
 *      redoable; toolbar buttons + Ctrl/Cmd+Z / Ctrl+Y both drive history.
 * Screenshots persisted to docs/verification/.
 *
 *   node packages/plugin-gantt/scripts/verify-phase6b.mjs [--executable <chromium>]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.GANTT_DEMO_URL || 'http://localhost:5199';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'verification');
mkdirSync(OUT, { recursive: true });
const argIdx = process.argv.indexOf('--executable');
const executablePath = argIdx > -1 ? process.argv[argIdx + 1] : undefined;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// Geometry of every task bar from layout (unit-independent).
const barGeom = () =>
  page.evaluate(() => {
    const out = {};
    document.querySelectorAll('[data-testid^="gantt-task-bar-"]').forEach((el) => {
      out[el.getAttribute('data-testid').replace('gantt-task-bar-', '')] = {
        left: Math.round(el.offsetLeft),
        width: Math.round(el.offsetWidth),
      };
    });
    return out;
  });

// Read the live task array the demo exposes on window.__ganttTasks.
const liveTasks = () =>
  page.evaluate(() =>
    (window.__ganttTasks || []).map((t) => ({
      id: String(t.id),
      start: t.start instanceof Date ? t.start.toISOString() : t.start,
      end: t.end instanceof Date ? t.end.toISOString() : t.end,
      parent: t.parent ?? null,
      type: t.type ?? null,
    })),
  );

// --- 1. Baselines ----------------------------------------------------------
await page.goto(`${BASE}/?critical=0`);
await page.waitForSelector('[data-testid="gantt-task-bar-t1"]');
await page.waitForTimeout(120);

const baseState = await page.evaluate(() => {
  const ids = [...document.querySelectorAll('[data-testid^="gantt-baseline-"]')].map((e) =>
    e.getAttribute('data-testid').replace('gantt-baseline-', ''),
  );
  const geom = (sel) => {
    const el = document.querySelector(sel);
    return el ? { left: Math.round(el.offsetLeft), width: Math.round(el.offsetWidth) } : null;
  };
  return {
    ids,
    t4Baseline: geom('[data-testid="gantt-baseline-t4"]'),
    t4Bar: geom('[data-testid="gantt-task-bar-t4"]'),
  };
});
check('baselines render for the planned tasks (t1, t4, t5)',
  ['t1', 't4', 't5'].every((id) => baseState.ids.includes(id)),
  baseState.ids.join(','));
check('slipped task t4 baseline ends earlier than its live bar (planned < actual)',
  baseState.t4Baseline && baseState.t4Bar &&
    baseState.t4Baseline.left + baseState.t4Baseline.width < baseState.t4Bar.left + baseState.t4Bar.width,
  baseState.t4Baseline && baseState.t4Bar
    ? `baseline end ${baseState.t4Baseline.left + baseState.t4Baseline.width} vs bar end ${baseState.t4Bar.left + baseState.t4Bar.width}`
    : 'missing geom');
await page.screenshot({ path: join(OUT, '17-baselines.png') });

// Baselines off.
await page.goto(`${BASE}/?baselines=0`);
await page.waitForSelector('[data-testid="gantt-task-bar-t1"]');
await page.waitForTimeout(120);
const baselineOff = await page.evaluate(
  () => document.querySelectorAll('[data-testid^="gantt-baseline-"]').length,
);
check('?baselines=0 removes all baseline strips', baselineOff === 0, `${baselineOff} remain`);

// --- 2. Working calendar ---------------------------------------------------
// Calendar OFF: auto-schedule, snapshot resulting starts.
await page.goto(`${BASE}/?critical=0`);
await page.waitForSelector('[data-testid="gantt-task-bar-t1"]');
await page.waitForTimeout(120);
await page.click('[data-testid="gantt-auto-schedule"]');
await page.waitForTimeout(250);
const noCal = await liveTasks();

// Calendar ON: same fixture, auto-schedule, snapshot.
await page.goto(`${BASE}/?critical=0&cal=1`);
await page.waitForSelector('[data-testid="gantt-task-bar-t1"]');
await page.waitForTimeout(120);
await page.click('[data-testid="gantt-auto-schedule"]');
await page.waitForTimeout(250);
const withCal = await liveTasks();

// No leaf task (non-summary, non-milestone) may START on a weekend under cal.
// 0 Sun, 6 Sat, read on the chart's LOCAL calendar: the working calendar counts
// local days since objectui#10866, and this browser context sets no
// `timezoneId`, so the page and this process share one zone.
const dow = (iso) => new Date(iso).getDay();
const leaves = withCal.filter((t) => t.type !== 'milestone' && !withCal.some((c) => c.parent === t.id));
const weekendStarts = leaves.filter((t) => dow(t.start) === 0 || dow(t.start) === 6);
check('working calendar: no leaf task starts on a weekend',
  weekendStarts.length === 0,
  weekendStarts.map((t) => `${t.id}@${t.start.slice(0, 10)}`).join(',') || 'all weekdays');

// The calendar run must differ from the calendar-off run for ≥1 task.
const noCalById = Object.fromEntries(noCal.map((t) => [t.id, t]));
const diffs = withCal.filter((t) => noCalById[t.id] && noCalById[t.id].start !== t.start);
check('working calendar changes the schedule vs calendar-off run',
  diffs.length >= 1,
  diffs.map((t) => `${t.id}: ${noCalById[t.id].start.slice(0, 10)}→${t.start.slice(0, 10)}`).join(', ') || 'identical');
await page.screenshot({ path: join(OUT, '18-working-calendar.png') });

// --- 3. Undo / redo --------------------------------------------------------
await page.goto(`${BASE}/?critical=0`);
await page.waitForSelector('[data-testid="gantt-task-bar-t4"]');
// Week mode keeps the whole project inside the viewport so the drag target is
// reachable by real mouse coordinates (day mode pushes t4 off-screen right).
await page.click('[data-testid="gantt-view-mode-week"]');
await page.waitForTimeout(120);

const undoBtn = '[data-testid="gantt-undo"]';
const redoBtn = '[data-testid="gantt-redo"]';
const isDisabled = (sel) => page.evaluate((s) => document.querySelector(s)?.disabled === true, sel);

check('undo button starts disabled', await isDisabled(undoBtn));
check('redo button starts disabled', await isDisabled(redoBtn));

// Drag t4's bar ~2 week-columns to the right.
const before = await barGeom();
const box = await page.locator('[data-testid="gantt-task-bar-t4"]').boundingBox();
const dragDx = 200;
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + dragDx, box.y + box.height / 2, { steps: 10 });
await page.waitForTimeout(80);
await page.mouse.up();
await page.waitForTimeout(200);
const afterDrag = await barGeom();
check('dragging t4 moves its bar', afterDrag.t4 && afterDrag.t4.left !== before.t4.left,
  `${before.t4.left} → ${afterDrag.t4?.left}`);
check('undo button enabled after a drag', !(await isDisabled(undoBtn)));
await page.screenshot({ path: join(OUT, '19-undo-after-drag.png') });

// Undo via toolbar button → bar returns to origin.
await page.click(undoBtn);
await page.waitForTimeout(200);
const afterUndo = await barGeom();
check('undo restores t4 to its exact origin',
  afterUndo.t4 && Math.abs(afterUndo.t4.left - before.t4.left) <= 1,
  `${afterUndo.t4?.left} vs origin ${before.t4.left}`);
check('redo button enabled after undo', !(await isDisabled(redoBtn)));
check('undo button disabled after the only entry is undone', await isDisabled(undoBtn));

// Redo via Ctrl+Y → bar moves back to the dragged position. The keyboard
// handler lives on the focusable gantt-body, so focus it first (clicking the
// now-disabled undo button dropped focus to <body>).
await page.evaluate(() => document.querySelector('[data-testid="gantt-body"]')?.focus());
await page.keyboard.press('Control+y');
await page.waitForTimeout(200);
const afterRedo = await barGeom();
check('Ctrl+Y redo re-applies the drag',
  afterRedo.t4 && Math.abs(afterRedo.t4.left - afterDrag.t4.left) <= 1,
  `${afterRedo.t4?.left} vs dragged ${afterDrag.t4.left}`);

// Ctrl+Z keyboard undo → origin again.
await page.evaluate(() => document.querySelector('[data-testid="gantt-body"]')?.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
const afterKeyUndo = await barGeom();
check('Ctrl+Z keyboard undo restores the origin',
  afterKeyUndo.t4 && Math.abs(afterKeyUndo.t4.left - before.t4.left) <= 1,
  `${afterKeyUndo.t4?.left} vs origin ${before.t4.left}`);
await page.screenshot({ path: join(OUT, '20-undo-redo-final.png') });

// --- 4. Read-only mode -----------------------------------------------------
// The demo still wires every write callback; `?readonly=1` must override them.
await page.goto(`${BASE}/?readonly=1`);
await page.waitForSelector('[data-testid="gantt-task-bar-t4"]');
await page.click('[data-testid="gantt-view-mode-week"]');
await page.waitForTimeout(120);

const ro = await page.evaluate(() => ({
  bars: document.querySelectorAll('[data-testid^="gantt-task-bar-"]').length,
  baselines: document.querySelectorAll('[data-testid^="gantt-baseline-"]').length,
  resizeHandles: document.querySelectorAll('[data-testid^="gantt-task-resize-"]').length,
  progressHandles: document.querySelectorAll('[data-testid^="gantt-progress-handle-"]').length,
  undo: !!document.querySelector('[data-testid="gantt-undo"]'),
  redo: !!document.querySelector('[data-testid="gantt-redo"]'),
  autoSchedule: !!document.querySelector('[data-testid="gantt-auto-schedule"]'),
}));
check('read-only still renders task bars', ro.bars > 0, `${ro.bars} bars`);
check('read-only still renders baselines', ro.baselines > 0, `${ro.baselines} baselines`);
check('read-only attaches NO resize handles', ro.resizeHandles === 0, `${ro.resizeHandles}`);
check('read-only attaches NO progress handles', ro.progressHandles === 0, `${ro.progressHandles}`);
check('read-only hides Undo/Redo + auto-schedule buttons',
  !ro.undo && !ro.redo && !ro.autoSchedule,
  `undo=${ro.undo} redo=${ro.redo} auto=${ro.autoSchedule}`);

// Dragging a bar must not move it (no write path).
const roBefore = await barGeom();
const roBox = await page.locator('[data-testid="gantt-task-bar-t4"]').boundingBox();
await page.mouse.move(roBox.x + roBox.width / 2, roBox.y + roBox.height / 2);
await page.mouse.down();
await page.mouse.move(roBox.x + roBox.width / 2 + 200, roBox.y + roBox.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(200);
const roAfter = await barGeom();
check('read-only: dragging a bar does not move it',
  roAfter.t4 && roAfter.t4.left === roBefore.t4.left,
  `${roBefore.t4?.left} → ${roAfter.t4?.left}`);
await page.screenshot({ path: join(OUT, '21-read-only.png') });

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
