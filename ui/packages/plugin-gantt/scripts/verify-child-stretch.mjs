/**
 * Browser verification: dragging a child task PAST the parent's current edge
 * stretches the parent summary bar in REAL TIME (mid-drag), not just on drop.
 *
 * Drags t4 (Backend services, ends Jul 8) three weeks to the right so its new
 * end (Jul 29) overshoots the Build group's current right edge (Jul 22, set by
 * t6). The p2 summary bar must visibly widen while the pointer is still down,
 * its left edge staying pinned to the earliest child (a stretch, not a shift),
 * and stay widened after drop. Screenshot persisted to docs/verification/.
 *
 *   node packages/plugin-gantt/scripts/verify-child-stretch.mjs [--executable <chromium>]
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

const geom = (testid) => page.evaluate((id) => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  return el ? { left: parseFloat(el.style.left), width: parseFloat(el.style.width) } : null;
}, testid);

await page.goto(BASE);
await page.waitForSelector('[data-testid="gantt-summary-bar-p2"]');
await page.click('[data-testid="gantt-view-mode-week"]');
await page.waitForTimeout(120);

// p2 (Build) rollup spans t3..t6 = Jun 12 → Jul 22 = 40 days.
const p2Before = await geom('gantt-summary-bar-p2');
const pxPerDay = p2Before.width / 40;
const p2RightBefore = p2Before.left + p2Before.width;

// Drag t4 right by 3 weeks (snaps cleanly in week mode).
const dragDays = 21;
const dx = Math.round(pxPerDay * dragDays);
const t4 = await page.locator('[data-testid="gantt-task-bar-t4"]').boundingBox();
await page.mouse.move(t4.x + t4.width / 2, t4.y + t4.height / 2);
await page.mouse.down();
await page.mouse.move(t4.x + t4.width / 2 + dx, t4.y + t4.height / 2, { steps: 10 });
await page.waitForTimeout(120);

// --- Mid-drag: the parent must already be wider, pointer still down. ---
const p2Mid = await geom('gantt-summary-bar-p2');
const p2RightMid = p2Mid.left + p2Mid.width;
const grewDays = (p2RightMid - p2RightBefore) / pxPerDay;
check('parent left edge stays pinned (stretch, not shift)',
  Math.abs(p2Mid.left - p2Before.left) <= pxPerDay / 2,
  `left ${p2Before.left.toFixed(0)} → ${p2Mid.left.toFixed(0)}px`);
check('parent right edge extends LIVE mid-drag', grewDays >= 5,
  `+${grewDays.toFixed(1)}d (≈Jul22→Jul29)`);
await page.screenshot({ path: join(OUT, '13-child-stretch-mid.png') });

await page.mouse.up();
await page.waitForTimeout(180);

// --- After drop: stays widened (committed via rollup), no jump-back. ---
const p2After = await geom('gantt-summary-bar-p2');
const p2RightAfter = p2After.left + p2After.width;
check('parent stays widened after drop (no jump-back)',
  (p2RightAfter - p2RightBefore) / pxPerDay >= 5,
  `+${((p2RightAfter - p2RightBefore) / pxPerDay).toFixed(1)}d`);
check('mid-drag and post-drop widths agree (no flicker)',
  Math.abs(p2RightAfter - p2RightMid) <= pxPerDay,
  `${p2RightMid.toFixed(0)} vs ${p2RightAfter.toFixed(0)}px`);
await page.screenshot({ path: join(OUT, '14-child-stretch-committed.png') });

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
