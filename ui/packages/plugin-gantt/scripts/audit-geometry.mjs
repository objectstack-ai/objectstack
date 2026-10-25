/**
 * Pixel-level geometry audit for the Gantt chart — measures every dependency
 * arrow's endpoints against the actual DOM rects of its source/target bars
 * and saves zoomed-in screenshot clips of each arrow's target anchor.
 *
 *   node packages/plugin-gantt/scripts/audit-geometry.mjs [--executable <chromium>] [--url <demo url>]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (() => {
  const i = process.argv.indexOf('--url');
  return i > -1 ? process.argv[i + 1] : process.env.GANTT_DEMO_URL || 'http://localhost:5199';
})();
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'verification', 'geometry');
mkdirSync(OUT, { recursive: true });
const exeIdx = process.argv.indexOf('--executable');
const executablePath = exeIdx > -1 ? process.argv[exeIdx + 1] : undefined;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await (await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
})).newPage();

/** Measure all links: path endpoints vs bar rects, in SVG coordinates. */
async function measure() {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="gantt-links"]');
    if (!svg) return { error: 'no links svg' };
    const origin = svg.getBoundingClientRect();
    const rel = (r) => ({
      left: r.left - origin.left,
      right: r.right - origin.left,
      top: r.top - origin.top,
      bottom: r.bottom - origin.top,
      cx: (r.left + r.right) / 2 - origin.left,
      cy: (r.top + r.bottom) / 2 - origin.top,
      width: r.width,
      height: r.height,
    });
    const barFor = (id) => {
      for (const kind of ['task-bar', 'milestone', 'summary-bar']) {
        const el = document.querySelector(`[data-testid="gantt-${kind}-${id}"]`);
        if (el) return { kind, rect: rel(el.getBoundingClientRect()) };
      }
      return null;
    };
    const out = [];
    for (const path of svg.querySelectorAll('path[data-link-type]')) {
      const m = path.getAttribute('data-testid').match(/^gantt-link-(.+)-([^-]+)$/);
      const [sourceId, targetId] = [m[1], m[2]];
      const type = path.getAttribute('data-link-type');
      const nums = (path.getAttribute('d').match(/-?[\d.]+/g) || []).map(Number);
      const pts = [];
      for (let i = 0; i < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
      const first = pts[0];
      const last = pts[pts.length - 1];
      const src = barFor(sourceId);
      const tgt = barFor(targetId);
      if (!src || !tgt) { out.push({ sourceId, targetId, type, error: 'bar not found' }); continue; }

      // Expected anchors. Task bars: edge x + vertical center. Milestones:
      // the diamond's left/right TIP (bounding box of the rotated square IS
      // tip-to-tip). Summary: bracket vertical center.
      const exitRight = type === 'fs' || type === 'ff';
      const enterRight = type === 'ff' || type === 'sf';
      const anchor = (bar, right) => ({
        x: bar.kind === 'milestone' ? (right ? bar.rect.right : bar.rect.left) : right ? bar.rect.right : bar.rect.left,
        y: bar.rect.cy,
      });
      const expS = anchor(src, exitRight);
      const expT = anchor(tgt, enterRight);
      out.push({
        sourceId, targetId, type,
        srcKind: src.kind, tgtKind: tgt.kind,
        start: first, end: last,
        expStart: { x: +expS.x.toFixed(1), y: +expS.y.toFixed(1) },
        expEnd: { x: +expT.x.toFixed(1), y: +expT.y.toFixed(1) },
        dStart: { x: +(first.x - expS.x).toFixed(1), y: +(first.y - expS.y).toFixed(1) },
        dEnd: { x: +(last.x - expT.x).toFixed(1), y: +(last.y - expT.y).toFixed(1) },
        endAbs: { x: last.x + origin.left, y: last.y + origin.top },
        startAbs: { x: first.x + origin.left, y: first.y + origin.top },
      });
    }
    return { links: out };
  });
}

async function clip(name, x, y, half = 50) {
  const vp = page.viewportSize();
  if (x < 0 || y < 0 || x > vp.width || y > vp.height) return; // scrolled out of view
  await page.screenshot({
    path: join(OUT, name),
    clip: {
      x: Math.min(Math.max(0, x - half), vp.width - half * 2),
      y: Math.min(Math.max(0, y - half), vp.height - half * 2),
      width: half * 2,
      height: half * 2,
    },
  });
  console.log(`  📸 ${name}`);
}

const TOL = 1.0; // px — sub-pixel rounding is fine, anything more is a bug
let failures = 0;
const report = (label, links) => {
  console.log(`\n=== ${label} — ${links.length} links ===`);
  for (const l of links) {
    if (l.error) { console.log(`  ✗ ${l.sourceId}→${l.targetId} ${l.error}`); failures++; continue; }
    const bad =
      Math.abs(l.dStart.x) > TOL || Math.abs(l.dStart.y) > TOL ||
      Math.abs(l.dEnd.x) > TOL || Math.abs(l.dEnd.y) > TOL;
    const tag = bad ? '✗' : '✓';
    if (bad) failures++;
    console.log(
      `  ${tag} ${l.type} ${l.sourceId}(${l.srcKind})→${l.targetId}(${l.tgtKind})` +
      `  Δstart=(${l.dStart.x},${l.dStart.y})  Δend=(${l.dEnd.x},${l.dEnd.y})`
    );
  }
};

try {
  for (const [label, query, modeClick] of [
    ['project / day mode', '', null],
    ['project / week mode', '', 'week'],
    ['edge cases / day mode', '?edge=1', null],
  ]) {
    await page.goto(`${BASE}${query}`);
    await page.waitForSelector('[data-testid="gantt-links"]');
    if (modeClick) {
      await page.click(`[data-testid="gantt-view-mode-${modeClick}"]`);
      await page.waitForTimeout(250);
    }
    const { links, error } = await measure();
    if (error) { console.log(`✗ ${label}: ${error}`); failures++; continue; }
    report(label, links);
    // Zoomed clips of every arrow's target anchor (and source for the first few).
    const slug = label.replace(/[^a-z0-9]+/gi, '-');
    for (const l of links.slice(0, 14)) {
      if (l.error) continue;
      await clip(`${slug}-${l.type}-${l.sourceId}-${l.targetId}-end.png`, l.endAbs.x, l.endAbs.y, 45);
    }
  }
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} geometry failure(s)` : '\nAll link endpoints within ±1px');
process.exit(failures ? 1 : 0);
