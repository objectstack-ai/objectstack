/**
 * 10,000-task stress run — measures initial render, deep-scroll window
 * shifts, sustained-scroll frame times, view-mode switching and group
 * collapse on ?perf=10000, saving screenshots + metrics to
 * docs/verification/.
 *
 *   node packages/plugin-gantt/scripts/perf-10k.mjs [--executable <chromium>] [--n 10000]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.GANTT_DEMO_URL || 'http://localhost:5199';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'verification');
mkdirSync(OUT, { recursive: true });
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const executablePath = arg('--executable', undefined);
const N = Number(arg('--n', 10000));

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const metrics = { n: N };

console.log(`[perf] loading ?perf=${N}&mode=week …`);
await page.goto(`${BASE}?perf=${N}&mode=week`);
await page.waitForSelector('[data-testid="demo-render-ms"]');
metrics.initialRenderMs = parseFloat(
  (await page.locator('[data-testid="demo-render-ms"]').innerText()).match(/[\d.]+/)[0]
);
metrics.domRows = await page.locator('[role="treeitem"]').count();
metrics.domNodesTotal = await page.evaluate(() => document.querySelectorAll('*').length);
await page.screenshot({ path: join(OUT, `perf-${N}-top.png`) });

// ── Single deep jumps: top → 25% → 50% → 75% → bottom ──────────────────────
metrics.jumps = [];
for (const frac of [0.25, 0.5, 0.75, 1]) {
  const r = await page.evaluate((f) => new Promise((resolve) => {
    const el = document.querySelector('[data-testid="gantt-timeline"]');
    const t0 = performance.now();
    el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
    requestAnimationFrame(() => requestAnimationFrame(() =>
      resolve({ frac: f, ms: +(performance.now() - t0).toFixed(1), scrollTop: Math.round(el.scrollTop) })));
  }), frac);
  metrics.jumps.push(r);
  console.log(`  jump to ${frac * 100}% → ${r.ms}ms (scrollTop ${r.scrollTop})`);
}
await page.screenshot({ path: join(OUT, `perf-${N}-bottom.png`) });

// ── Sustained wheel-style scroll: 120 steps of 300px, measure frames ───────
const sustained = await page.evaluate(() => new Promise((resolve) => {
  const el = document.querySelector('[data-testid="gantt-timeline"]');
  el.scrollTop = 0;
  const frames = [];
  let last = performance.now();
  let steps = 0;
  const tick = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    el.scrollTop += 300;
    if (++steps < 120) requestAnimationFrame(tick);
    else {
      frames.shift(); // first frame includes setup
      const sorted = [...frames].sort((a, b) => a - b);
      resolve({
        steps,
        avgMs: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2),
        p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
        maxMs: +Math.max(...frames).toFixed(2),
        endScrollTop: Math.round(el.scrollTop),
      });
    }
  };
  requestAnimationFrame(tick);
}));
metrics.sustainedScroll = sustained;
console.log(`  sustained scroll ×${sustained.steps}: avg ${sustained.avgMs}ms, p95 ${sustained.p95Ms}ms, max ${sustained.maxMs}ms/frame`);

// ── Horizontal scroll burst ────────────────────────────────────────────────
metrics.horizontal = await page.evaluate(() => new Promise((resolve) => {
  const el = document.querySelector('[data-testid="gantt-timeline"]');
  const frames = [];
  let last = performance.now();
  let steps = 0;
  const tick = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    el.scrollLeft += 200;
    if (++steps < 60) requestAnimationFrame(tick);
    else {
      frames.shift();
      resolve({
        avgMs: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2),
        maxMs: +Math.max(...frames).toFixed(2),
      });
    }
  };
  requestAnimationFrame(tick);
}));
console.log(`  horizontal scroll ×60: avg ${metrics.horizontal.avgMs}ms, max ${metrics.horizontal.maxMs}ms/frame`);
await page.screenshot({ path: join(OUT, `perf-${N}-mid-scrolled.png`) });

// ── View-mode switch (week → month → week) ─────────────────────────────────
for (const mode of ['month', 'week']) {
  const t0 = Date.now();
  await page.click(`[data-testid="gantt-view-mode-${mode}"]`);
  await page.waitForTimeout(50);
  metrics[`switchTo${mode[0].toUpperCase()}${mode.slice(1)}Ms`] = Date.now() - t0 - 50;
}
console.log(`  view-mode switch: →month ${metrics.switchToMonthMs}ms, →week ${metrics.switchToWeekMs}ms`);

// ── Collapse/expand a summary group near the viewport ──────────────────────
await page.evaluate(() => {
  const el = document.querySelector('[data-testid="gantt-timeline"]');
  el.scrollTop = 0;
});
await page.waitForTimeout(100);
const t0 = Date.now();
await page.click('[data-testid="gantt-row-toggle-g0"]');
await page.waitForTimeout(50);
metrics.collapseGroupMs = Date.now() - t0 - 50;
await page.click('[data-testid="gantt-row-toggle-g0"]');
console.log(`  collapse first group: ${metrics.collapseGroupMs}ms`);

// ── Hover (tooltip + link highlight) responsiveness ────────────────────────
const t1 = Date.now();
await page.hover('[data-testid="gantt-task-bar-task2"]');
await page.waitForSelector('[data-testid="gantt-tooltip-task2"]');
metrics.hoverTooltipMs = Date.now() - t1;
console.log(`  hover → tooltip visible: ${metrics.hoverTooltipMs}ms`);

metrics.jsHeapMB = await page.evaluate(() =>
  performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null);
console.log(`  JS heap: ${metrics.jsHeapMB}MB`);

writeFileSync(join(OUT, `perf-${N}-metrics.json`), JSON.stringify(metrics, null, 2));
console.log(`\nSaved metrics + screenshots to ${OUT}`);
await browser.close();
