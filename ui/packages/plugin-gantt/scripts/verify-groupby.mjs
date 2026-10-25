/**
 * Dynamic Group by (动态 Group by) verification — drives the demo app with
 * ?group=owner / ?group=status and asserts that leaf tasks are bucketed under
 * synthesized summary rows, the original phase hierarchy is replaced, and
 * collapsing a group hides its members. Persists one screenshot per grouping
 * into docs/verification/. Run with the demo up:
 *
 *   node packages/plugin-gantt/scripts/verify-groupby.mjs [--executable <chromium path>]
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

const collect = () => page.evaluate(() => ({
  groups: [...document.querySelectorAll('[data-testid^="gantt-summary-bar-__group__"]')]
    .map((e) => e.getAttribute('data-testid')),
  bars: [...document.querySelectorAll('[data-testid^="gantt-task-bar-"]')]
    .map((e) => e.getAttribute('data-testid')),
  // Original phase summaries (p1/p2/p3) must be gone in grouped mode.
  origSummaries: ['p1', 'p2', 'p3'].filter((id) => document.querySelector(`[data-testid="gantt-summary-bar-${id}"]`)),
}));

try {
  // ── group by owner ──────────────────────────────────────────────────────────
  console.log('\n[owner] ?group=owner — leaves bucketed under owner summaries');
  await page.goto(`${BASE}/?group=owner`);
  await page.waitForSelector('[data-testid^="gantt-summary-bar-__group__"]');
  const owner = await collect();
  assert(owner.groups.length === 3, 'three owner group rows synthesized', owner.groups.join(' | '));
  assert(owner.origSummaries.length === 0, 'original phase summaries replaced', `remaining: ${owner.origSummaries.join(',') || 'none'}`);
  assert(owner.bars.length === 8, 'all eight leaf tasks rendered once', `${owner.bars.length} bars`);
  await page.screenshot({ path: join(OUT, '24-groupby-owner.png') });
  console.log('  📸 24-groupby-owner.png');

  // Collapse the first group and confirm its members disappear.
  const firstToggle = await page.$('[data-testid^="gantt-row-toggle-__group__"]');
  const beforeBars = (await collect()).bars.length;
  await firstToggle.click();
  await page.waitForTimeout(120);
  const afterBars = (await collect()).bars.length;
  assert(afterBars < beforeBars, 'collapsing a group hides its members', `${beforeBars} → ${afterBars} bars`);

  // ── group by status ─────────────────────────────────────────────────────────
  console.log('\n[status] ?group=status — leaves bucketed under status summaries');
  await page.goto(`${BASE}/?group=status`);
  await page.waitForSelector('[data-testid^="gantt-summary-bar-__group__"]');
  const status = await collect();
  assert(status.groups.length === 3, 'three status group rows synthesized', status.groups.join(' | '));
  assert(status.origSummaries.length === 0, 'original phase summaries replaced', `remaining: ${status.origSummaries.join(',') || 'none'}`);
  await page.screenshot({ path: join(OUT, '25-groupby-status.png') });
  console.log('  📸 25-groupby-status.png');

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed. Output: ${OUT}`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
} catch (err) {
  console.error(err);
  await browser.close();
  process.exit(1);
}
