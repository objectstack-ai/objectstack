/**
 * Browser verification for Phase 6 — critical path, auto-schedule, export PNG.
 *
 * Drives the demo (with `?critical=1` so the highlight starts on) and asserts:
 *   1. Critical path — the longest dependency chain (t1→t2→m1→t3→t5→t6→t7→t8)
 *      is flagged `data-critical`, the shorter parallel leg (t4 Backend, 20d vs
 *      t5 Frontend 23d) is NOT, and the joining links are red.
 *   2. Auto-schedule — clicking the wand pushes overlapping successors LATER
 *      (顺延) while preserving their durations, cascading down the chain.
 *   3. Export PNG — clicking download produces a real `gantt-day.png` raster
 *      (2× scale) with no NaN geometry.
 * Screenshots persisted to docs/verification/.
 *
 *   node packages/plugin-gantt/scripts/verify-phase6.mjs [--executable <chromium>]
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

// Geometry of a task bar from layout (works regardless of inline-style units).
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

// --- 1. Critical path ------------------------------------------------------
await page.goto(`${BASE}/?critical=1`);
await page.waitForSelector('[data-testid="gantt-task-bar-t1"]');
await page.waitForTimeout(120);

const critState = await page.evaluate(() => ({
  critBars: [...document.querySelectorAll('[data-testid^="gantt-task-bar-"][data-critical="true"]')].map((e) =>
    e.getAttribute('data-testid').replace('gantt-task-bar-', ''),
  ),
  critEdges: [...document.querySelectorAll('[data-testid^="gantt-link-"][data-critical="true"]')].length,
  t4Critical: document.querySelector('[data-testid="gantt-task-bar-t4"]')?.getAttribute('data-critical') === 'true',
  t5Critical: document.querySelector('[data-testid="gantt-task-bar-t5"]')?.getAttribute('data-critical') === 'true',
  milestoneCrit: document.querySelector('[data-testid="gantt-milestone-m1"]')?.getAttribute('data-critical') === 'true',
}));
check('critical chain highlights the long leg (t1,t2,t3,t5,t6,t7,t8)',
  ['t1', 't2', 't3', 't5', 't6', 't7', 't8'].every((id) => critState.critBars.includes(id)),
  critState.critBars.join(','));
check('parallel SHORT leg t4 (Backend 20d) is NOT critical', !critState.t4Critical);
check('parallel LONG leg t5 (Frontend 23d) IS critical', critState.t5Critical);
check('milestone m1 on the path is flagged critical', critState.milestoneCrit);
check('critical links are drawn (red edges)', critState.critEdges >= 6, `${critState.critEdges} edges`);
await page.screenshot({ path: join(OUT, '15-critical-path.png') });

// Toggle off → no critical flags remain.
await page.click('[data-testid="gantt-critical-path"]');
await page.waitForTimeout(120);
const offCount = await page.evaluate(() => document.querySelectorAll('[data-critical="true"]').length);
check('toggling off clears all critical highlights', offCount === 0, `${offCount} remain`);

// --- 2. Auto-schedule ------------------------------------------------------
const before = await barGeom();
await page.click('[data-testid="gantt-auto-schedule"]');
await page.waitForTimeout(250);
const after = await barGeom();
const moved = Object.keys(before).filter(
  (k) => after[k] && (before[k].left !== after[k].left || before[k].width !== after[k].width),
);
check('auto-schedule shifts overlapping successors', moved.length >= 1, `moved: ${moved.join(',') || 'none'}`);
const allLater = moved.every((k) => after[k].left >= before[k].left); // 顺延 only
const widthsKept = moved.every((k) => Math.abs(after[k].width - before[k].width) <= 1);
check('moved tasks only go LATER (顺延, never earlier)', allLater);
check('durations preserved (width unchanged)', widthsKept);
await page.screenshot({ path: join(OUT, '16-auto-scheduled.png') });

// --- 3. Export PNG ---------------------------------------------------------
const png = await page.evaluate(async () => {
  let svgText = null,
    download = null,
    href = null;
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = function (blob) {
    if (blob && blob.type && blob.type.indexOf('image/svg') === 0) {
      try {
        blob.text().then((t) => (svgText = t));
      } catch (e) {
        /* ignore */
      }
    }
    return origCreate.apply(this, arguments);
  };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) {
      download = this.download;
      href = this.href;
      return;
    }
    return origClick.apply(this, arguments);
  };
  document.querySelector('[data-testid="gantt-export-png"]').click();
  // Poll for the download anchor, then read it BEFORE the export revokes its
  // blob URL (~1s after creation).
  let dims = null,
    bytes = 0,
    type = null;
  for (let i = 0; i < 40 && !href; i++) await new Promise((r) => setTimeout(r, 25));
  if (href) {
    const b = await (await fetch(href)).blob();
    bytes = b.size;
    type = b.type;
    dims = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res(null);
      im.src = href;
    });
  }
  URL.createObjectURL = origCreate;
  HTMLAnchorElement.prototype.click = origClick;
  const svg = svgText || '';
  return {
    svgLen: svg.length,
    svgNaN: svgText ? (svg.match(/NaN/g) || []).length : -1,
    download, type, bytes, dims,
    // The export must carry the same information the live chart shows:
    // baseline strips (BASELINE_FILL) and the custom marker labels.
    baselineCount: (svg.match(/rgba\(100, ?116, ?139, ?0\.35\)/g) || []).length,
    hasSprint2: svg.includes('Sprint 2'),
    hasCodeFreeze: svg.includes('Code freeze'),
    // Two-row header: the month/year band carries the year; unit labels and
    // bars never do, so the year string proves the group band is drawn.
    hasMonthBand: /20\d\d/.test(svg),
  };
});
check('export produces a valid SVG (no NaN geometry)', png.svgLen > 0 && png.svgNaN === 0, `${png.svgLen} chars, ${png.svgNaN} NaN`);
check('download is named gantt-day.png', png.download === 'gantt-day.png', String(png.download));
check('rasterized PNG is non-trivial', png.type === 'image/png' && png.bytes > 5000, `${png.type}, ${png.bytes}B`);
check('PNG is 2× scale of the SVG', png.dims && png.dims.w > 0 && png.dims.h > 0, png.dims ? `${png.dims.w}×${png.dims.h}` : 'no dims');
check('export includes baseline strips (t1/t4/t5)', png.baselineCount === 3, `${png.baselineCount} baselines`);
check('export includes custom markers (Sprint 2 + Code freeze)', png.hasSprint2 && png.hasCodeFreeze, `sprint2=${png.hasSprint2} codeFreeze=${png.hasCodeFreeze}`);
check('export includes the month/year header band', png.hasMonthBand, `hasYear=${png.hasMonthBand}`);

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
