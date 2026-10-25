/**
 * Browser verification: dragging a summary bracket moves its whole subtree,
 * and dragging a child past the parent edge stretches the bracket via rollup.
 * Screenshots persisted to docs/verification/.
 *
 *   node packages/plugin-gantt/scripts/verify-group-drag.mjs [--executable <chromium>]
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

await page.goto(BASE);
await page.waitForSelector('[data-testid="gantt-summary-bar-p2"]');
// Week mode: the whole project fits in the viewport, so every drag target is
// reachable by real mouse coordinates. Drags snap to whole weeks here.
await page.click('[data-testid="gantt-view-mode-week"]');
await page.waitForTimeout(100);

const barLeft = (testid) => page.evaluate((id) => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  return el ? parseFloat(el.style.left) : null;
}, testid);
const barWidth = (testid) => page.evaluate((id) => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  return el ? parseFloat(el.style.width) : null;
}, testid);

// Day-mode column width (px per day) read from the bracket itself: p2 spans
// rollup t3..t6 = Jun 12 → Jul 22 (40 days).
const CHILDREN = ['gantt-task-bar-t3', 'gantt-task-bar-t4', 'gantt-task-bar-t5', 'gantt-task-bar-t6'];

console.log('1. Summary drag moves the whole subtree');
const before = {};
for (const id of [...CHILDREN, 'gantt-summary-bar-p2']) before[id] = await barLeft(id);
const pxPerDay = (await barWidth('gantt-summary-bar-p2')) / 40;

const bracket = page.locator('[data-testid="gantt-summary-bar-p2"]');
const bb = await bracket.boundingBox();
const dragDays = 14; // 2 columns in week mode
const dx = Math.round(pxPerDay * dragDays);
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width / 2 + dx, bb.y + bb.height / 2, { steps: 8 });
await page.waitForTimeout(100);

// Mid-drag: live preview shifts every child bar, drag chip shows new dates.
const chipVisible = await page.locator('[data-testid="gantt-summary-drag-chip-p2"]').isVisible();
check('drag chip visible mid-drag', chipVisible);
let previewOk = true;
for (const id of CHILDREN) {
  const now = await barLeft(id);
  if (Math.abs(now - before[id] - dx) > pxPerDay / 2) previewOk = false;
}
check('children bars preview-shift with the bracket', previewOk);
await page.screenshot({ path: join(OUT, '09-group-drag-mid.png') });
await page.mouse.up();
await page.waitForTimeout(150);

let commitOk = true;
const deltas = [];
for (const id of [...CHILDREN, 'gantt-summary-bar-p2']) {
  const now = await barLeft(id);
  const days = (now - before[id]) / pxPerDay;
  deltas.push(`${id.replace('gantt-task-bar-', '').replace('gantt-summary-bar-', '')}: +${days.toFixed(1)}d`);
  if (Math.abs(days - dragDays) > 0.5) commitOk = false;
}
check(`all bars committed +${dragDays} days`, commitOk, deltas.join(', '));
await page.screenshot({ path: join(OUT, '10-group-drag-committed.png') });

console.log('2. Child drag past the parent edge stretches the bracket');
const bracketBefore = { left: await barLeft('gantt-summary-bar-p2'), width: await barWidth('gantt-summary-bar-p2') };
const t6 = page.locator('[data-testid="gantt-task-bar-t6"]');
const tb = await t6.boundingBox();
const childDays = 7; // 1 column in week mode
const cdx = Math.round(pxPerDay * childDays);
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.mouse.down();
await page.mouse.move(tb.x + tb.width / 2 + cdx, tb.y + tb.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);

const bracketAfter = { left: await barLeft('gantt-summary-bar-p2'), width: await barWidth('gantt-summary-bar-p2') };
const widthGrowthDays = (bracketAfter.width - bracketBefore.width) / pxPerDay;
check('parent start unchanged (t3 still defines it)', Math.abs(bracketAfter.left - bracketBefore.left) < pxPerDay / 2);
check(`parent end follows the moved child (+${childDays}d wider)`, Math.abs(widthGrowthDays - childDays) < 0.5, `width +${widthGrowthDays.toFixed(1)}d`);
await page.screenshot({ path: join(OUT, '11-child-drag-stretches-parent.png') });

console.log(failures === 0 ? '\nAll group-drag checks passed.' : `\n${failures} check(s) FAILED.`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
