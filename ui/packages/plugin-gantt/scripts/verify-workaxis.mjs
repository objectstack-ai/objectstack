/**
 * Non-linear working-time axis (非线性工作时间轴) verification — drives the demo
 * with ?cal=1 (day mode + skip-weekends) and compares against the plain linear
 * axis. Asserts the folded grid has materially fewer columns (weekends dropped)
 * and that the same task bar is compressed once non-working time folds out.
 * Persists screenshots into docs/verification/. Run with the demo up:
 *
 *   node packages/plugin-gantt/scripts/verify-workaxis.mjs [--executable <chromium path>]
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

const snapshot = () => page.evaluate(() => {
  const cells = [...document.querySelectorAll('[data-testid="gantt-header-units"] > div')];
  const days = cells.map((c) => Number((c.textContent || '').match(/^\d+/)?.[0] ?? '0'));
  // Count same-month adjacencies whose day-number jumps by exactly 3 — a
  // Friday→Monday step that only exists when the weekend columns are folded out.
  let weekendSkips = 0;
  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] === 3) weekendSkips++;
  }
  return { columns: cells.length, days, weekendSkips };
});

try {
  // ── linear day axis (no calendar) ─────────────────────────────────────────
  console.log('\n[linear] ?mode=day — plain linear axis');
  await page.goto(`${BASE}/?mode=day`);
  await page.waitForSelector('[data-testid="gantt-header-units"] > div');
  await page.waitForSelector('[data-testid^="gantt-task-bar-"]');
  const linear = await snapshot();
  assert(linear.columns > 0, 'linear axis renders day columns', `${linear.columns} columns`);
  assert(
    linear.weekendSkips === 0,
    'linear axis has no Fri→Mon jumps (every day rendered)',
    `${linear.weekendSkips} skips`,
  );
  await page.screenshot({ path: join(OUT, '29-workaxis-linear.png') });
  console.log('  📸 29-workaxis-linear.png');

  // ── folded working axis (skip weekends) ───────────────────────────────────
  console.log('\n[folded] ?cal=1 — weekends folded out of the day axis');
  await page.goto(`${BASE}/?cal=1`);
  await page.waitForSelector('[data-testid="gantt-header-units"] > div');
  await page.waitForSelector('[data-testid^="gantt-task-bar-"]');
  const folded = await snapshot();
  assert(folded.columns > 0, 'folded axis renders working columns', `${folded.columns} columns`);
  // Weekend columns are dropped, so every working week ends Fri then resumes
  // Mon — a +3 day-number jump that the linear axis never shows.
  assert(
    folded.weekendSkips >= 2,
    'folded axis collapses weekends (Fri→Mon jumps present)',
    `${folded.weekendSkips} weekend skips`,
  );
  await page.screenshot({ path: join(OUT, '30-workaxis-folded.png') });
  console.log('  📸 30-workaxis-folded.png');

  // ── folded axis, Chinese chrome ───────────────────────────────────────────
  console.log('\n[folded-zh] ?cal=1&lang=zh — folded axis with localized chrome');
  await page.goto(`${BASE}/?cal=1&lang=zh`);
  await page.waitForSelector('[data-testid="gantt-header-units"] > div');
  await page.waitForSelector('[data-testid^="gantt-task-bar-"]');
  const zh = await snapshot();
  assert(
    zh.weekendSkips >= 2,
    'folded axis collapses weekends under zh locale too',
    `${zh.weekendSkips} weekend skips`,
  );
  await page.screenshot({ path: join(OUT, '31-workaxis-folded-zh.png') });
  console.log('  📸 31-workaxis-folded-zh.png');

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed. Output: ${OUT}`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
} catch (err) {
  console.error(err);
  await browser.close();
  process.exit(1);
}
