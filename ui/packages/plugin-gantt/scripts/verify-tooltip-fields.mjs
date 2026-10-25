/**
 * Verifies the configurable hover tooltip (悬浮详情 / tooltipFields).
 *
 * Drives the demo's project fixture (t4 "Backend services" carries explicit
 * tooltip `fields`), hovers its bar, and asserts the tooltip renders the
 * label/value rows instead of the default date·duration·progress line.
 * Persists a screenshot under docs/verification/.
 *
 *   pnpm --dir packages/plugin-gantt exec vite demo --port 5199
 *   node packages/plugin-gantt/scripts/verify-tooltip-fields.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EXEC =
  '/Users/baozhoutao/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = 'http://localhost:5199';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../docs/verification');

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? '✓' : '✗'} ${msg}`); };

await page.goto(`${BASE}?`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid^="gantt-bar-"], .gantt-bar-hover', { timeout: 8000 }).catch(() => {});

// Find the bar for t4 (Backend services, 30% progress) and hover it.
const bar = page.locator('[data-testid="gantt-timeline"] .gantt-bar-hover', { hasText: '30%' }).first();
await bar.waitFor({ state: 'visible', timeout: 8000 });

// Scroll the timeline so the bar's start sits well inside the viewport — the
// tooltip anchors to the bar's left edge, so an off-screen start would clamp
// it under the sticky task-list panel and clip the text.
await page.evaluate(() => {
  const tl = document.querySelector('[data-testid="gantt-timeline"]');
  const bar = [...document.querySelectorAll('[data-testid="gantt-timeline"] .gantt-bar-hover')]
    .find((e) => e.textContent.includes('30%'));
  if (tl && bar) tl.scrollLeft = bar.offsetLeft - 360;
});
await page.waitForTimeout(150);
await bar.hover({ force: true });
await page.waitForTimeout(300);

const tip = page.locator('[data-testid="gantt-tooltip-t4"]');
ok(await tip.count() > 0, 'tooltip for t4 is visible on hover');
const text = (await tip.first().innerText().catch(() => '')) || '';
console.log('tooltip text:', JSON.stringify(text));
ok(text.includes('Backend services'), 'tooltip shows the task title');
ok(text.includes('Owner') && text.includes('Priya N.'), 'tooltip shows configured Owner field');
ok(text.includes('Status') && text.includes('In Progress'), 'tooltip shows configured Status field');
ok(text.includes('Effort') && text.includes('15 days'), 'tooltip shows configured Effort field');
ok(!/→/.test(text), 'configured fields replace the default date→date line');

await page.screenshot({ path: path.join(OUT, '12-tooltip-fields.png') });
console.log(`\nscreenshot → ${path.join(OUT, '12-tooltip-fields.png')}`);

await browser.close();
if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
