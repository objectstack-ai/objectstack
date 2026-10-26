/**
 * Drag conflict + 顺延 confirmation verification (拖拽冲突校验 + 顺延确认).
 *
 * Drives the demo's project fixture (?lang=zh) where t4 "Backend services"
 * depends on t3 "API design" via an FS link. Dragging t4's bar to the LEFT so
 * it would start before t3 finishes violates the link. Asserts:
 *   1. the drag raises a 顺延 confirmation dialog (排期冲突 / 自动顺延 / 取消保留),
 *   2. 取消保留 dismisses it and leaves the manual placement,
 *   3. dragging again + 自动顺延 reschedules the bar (dialog clears, bar shifts).
 * Persists screenshots 42-44 under docs/verification/.
 *
 *   GANTT_DEMO_URL=http://localhost:5200 node packages/plugin-gantt/scripts/verify-conflict.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EXEC =
  '/Users/baozhoutao/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = process.env.GANTT_DEMO_URL || 'http://localhost:5199';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../docs/verification');

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const fails = [];
const ok = (cond, msg, detail = '') => {
  if (!cond) fails.push(msg);
  console.log(`${cond ? '✓' : '✗'} ${msg}${detail ? ` — ${detail}` : ''}`);
};

// The fixture's June/July bars start far to the right of the initial viewport;
// scroll the timeline horizontally so the target bar's left edge sits near
// `targetX` and the drag stays on-screen.
const scrollBarIntoView = async (id, targetX = 360) => {
  await page.$eval(
    `[data-testid="gantt-task-bar-${id}"]`,
    (el, tx) => {
      const scroller = document.querySelector('[data-testid="gantt-timeline"]');
      const barX = el.getBoundingClientRect().x;
      scroller.scrollLeft += barX - tx;
    },
    targetX,
  );
  await page.waitForTimeout(150);
};

// Drag a task bar by `dx` px (negative = earlier) using real pointer events so
// the GanttView column-snapping move handler fires.
const dragBar = async (id, dx) => {
  const box = await page.$eval(`[data-testid="gantt-task-bar-${id}"]`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const startX = box.x + Math.min(box.w / 2, 40);
  const y = box.y + box.h / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + dx, y, { steps: 12 });
  await page.mouse.up();
};

const barLeft = (id) =>
  page.$eval(`[data-testid="gantt-task-bar-${id}"]`, (el) => Math.round(el.getBoundingClientRect().x)).catch(() => null);

try {
  await page.goto(`${BASE}?lang=zh`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="gantt-task-bar-t4"]', { timeout: 8000 });

  await scrollBarIntoView('t4');
  const before = await barLeft('t4');

  // 1) Drag t4 well to the left → starts before t3 finishes → conflict.
  await dragBar('t4', -160);
  await page.waitForSelector('[data-testid="gantt-conflict-dialog"]', { timeout: 4000 });
  const dlgText = await page.$eval('[data-testid="gantt-conflict-dialog"]', (el) => el.innerText);
  ok(/排期冲突|自动顺延|取消保留/.test(dlgText), '顺延 confirmation dialog appears on conflicting drag', JSON.stringify(dlgText.replace(/\n/g, ' ')));
  await page.screenshot({ path: path.join(OUT, '42-conflict-dialog.png') });

  // 2) 取消保留 dismisses without rescheduling.
  await page.click('[data-testid="gantt-conflict-cancel"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="gantt-conflict-dialog"]'), { timeout: 4000 });
  ok(!(await page.$('[data-testid="gantt-conflict-dialog"]')), '取消保留 dismisses the dialog');
  const keptLeft = await barLeft('t4');
  ok(keptLeft !== null && keptLeft < before, '取消保留 keeps the manual (earlier) placement', `before=${before} kept=${keptLeft}`);
  await page.screenshot({ path: path.join(OUT, '43-conflict-cancel-kept.png') });

  // 3) Drag again into conflict, then 自动顺延 to reschedule. Measure the bar's
  //    manual position and the rescheduled position in the SAME scroll state so
  //    the pixel comparison is valid.
  await scrollBarIntoView('t4');
  await dragBar('t4', -160);
  await page.waitForSelector('[data-testid="gantt-conflict-dialog"]', { timeout: 4000 });
  const manualLeft = await barLeft('t4');
  await page.click('[data-testid="gantt-conflict-confirm"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="gantt-conflict-dialog"]'), { timeout: 4000 });
  ok(!(await page.$('[data-testid="gantt-conflict-dialog"]')), '自动顺延 clears the dialog');
  const afterLeft = await barLeft('t4');
  // Reschedule pushes t4 back to satisfy FS, so it lands to the RIGHT of where
  // the manual drag left it.
  ok(afterLeft !== null && afterLeft > manualLeft, '自动顺延 shifts t4 back to satisfy the link', `manual=${manualLeft} after=${afterLeft}`);
  await page.screenshot({ path: path.join(OUT, '44-conflict-rescheduled.png') });

  console.log(`\nscreenshots → ${OUT} (42–44)`);
} catch (err) {
  console.error(err);
  fails.push(String(err));
} finally {
  await browser.close();
}

if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
