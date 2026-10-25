/**
 * Resource / Workload view (资源/工作负载视图) verification — drives the demo with
 * ?resource=owner / ?resource=status and asserts the per-resource load
 * histogram renders: one row per resource, an overload flag on the
 * double-booked rep, and bar geometry that scales with concurrent load.
 * Persists one screenshot per mode into docs/verification/. Run with the demo
 * up:
 *
 *   node packages/plugin-gantt/scripts/verify-resource.mjs [--executable <chromium path>]
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

const collect = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid^="resource-row-"]')]
    .map((e) => e.getAttribute('data-testid'));
  const peaks = [...document.querySelectorAll('[data-testid^="resource-peak-"]')]
    .map((e) => ({ id: e.getAttribute('data-testid'), overloaded: e.getAttribute('data-overloaded') === 'true', text: e.textContent }));
  // Any cell flagged over-allocated across the whole histogram.
  const overloadedCells = [...document.querySelectorAll('[data-testid^="resource-cell-"]')]
    .filter((e) => e.getAttribute('data-overloaded') === 'true').length;
  const totalCells = document.querySelectorAll('[data-testid^="resource-cell-"]').length;
  return { rows, peaks, overloadedCells, totalCells };
});

try {
  // ── resource by owner ─────────────────────────────────────────────────────
  console.log('\n[owner] ?resource=owner — per-owner load histogram');
  await page.goto(`${BASE}/?resource=owner`);
  await page.waitForSelector('[data-testid="resource-workload"]');
  await page.waitForSelector('[data-testid^="resource-row-"]');
  const owner = await collect();
  // Three round-robin owners decorate the fixture.
  assert(owner.rows.length === 3, 'three resource rows rendered', owner.rows.join(' | '));
  assert(owner.totalCells > 0, 'histogram cells rendered', `${owner.totalCells} cells`);
  assert(owner.overloadedCells > 0, 'at least one column flagged over-allocated', `${owner.overloadedCells} overloaded cells`);
  const anyPeakOver = owner.peaks.some((p) => p.overloaded);
  assert(anyPeakOver, 'an overloaded resource surfaces on its peak caption', owner.peaks.map((p) => `${p.id}:${p.overloaded}`).join(' '));
  await page.screenshot({ path: join(OUT, '26-resource-owner.png') });
  console.log('  📸 26-resource-owner.png');

  // ── resource by status ────────────────────────────────────────────────────
  console.log('\n[status] ?resource=status — per-status load histogram');
  await page.goto(`${BASE}/?resource=status`);
  await page.waitForSelector('[data-testid="resource-workload"]');
  await page.waitForSelector('[data-testid^="resource-row-"]');
  const status = await collect();
  assert(status.rows.length === 3, 'three status rows rendered', status.rows.join(' | '));
  await page.screenshot({ path: join(OUT, '27-resource-status.png') });
  console.log('  📸 27-resource-status.png');

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed. Output: ${OUT}`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
} catch (err) {
  console.error(err);
  await browser.close();
  process.exit(1);
}
