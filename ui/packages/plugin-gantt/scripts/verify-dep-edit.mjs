/**
 * Dependency edit verification (依赖增删 + 类型选择).
 *
 * Drives the demo's project fixture (?lang=zh) where t4 "Backend services"
 * depends on t3 "API design" (a FS link t3 → t4). Asserts:
 *   1. an invisible hit-path is laid over each link (editing enabled),
 *   2. right-clicking it opens the link menu (类型选择 + 移除依赖),
 *   3. choosing 开始→开始 (SS) switches the link's data-link-type to "ss",
 *   4. 移除依赖 deletes the link (path gone),
 *   5. a task's 添加紧前依赖 menu opens a candidate picker that re-offers t3,
 *   6. picking t3 re-creates the link.
 * Persists screenshots 38-41 under docs/verification/.
 *
 *   GANTT_DEMO_URL=http://localhost:5200 node packages/plugin-gantt/scripts/verify-dep-edit.mjs
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

// Right-click a link's hit-path by dispatching a bubbling contextmenu event at
// its bbox center — React's delegated onContextMenu picks it up. (A Playwright
// .click on a thin transparent SVG stroke usually misses the stroke region.)
const rightClickLink = (sourceId, targetId) =>
  page.$eval(`[data-testid="gantt-link-hit-${sourceId}-${targetId}"]`, (el) => {
    const r = el.getBoundingClientRect();
    // Clamp so the fixed-position menu (≈190×240) stays inside the viewport.
    const cx = Math.min(r.x + r.width / 2, window.innerWidth - 220);
    const cy = Math.min(r.y + r.height / 2, window.innerHeight - 280);
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: cx, clientY: cy,
    }));
  });

const linkType = (sourceId, targetId) =>
  page.$eval(`[data-testid="gantt-link-${sourceId}-${targetId}"]`, (el) => el.getAttribute('data-link-type')).catch(() => null);

try {
  await page.goto(`${BASE}?lang=zh`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="gantt-task-bar-t4"]', { timeout: 8000 });

  // 1) Hit-path present over the existing t3 → t4 link.
  const hit = await page.$(`[data-testid="gantt-link-hit-t3-t4"]`);
  ok(!!hit, 'an invisible hit-path is rendered over the t3 → t4 link');
  ok((await linkType('t3', 't4')) === 'fs', 'the seeded t3 → t4 link is FS', `type=${await linkType('t3', 't4')}`);

  // 2) Right-click opens the link menu.
  await rightClickLink('t3', 't4');
  await page.waitForSelector('[data-testid="gantt-link-context-menu"]', { timeout: 4000 });
  const menuText = await page.$eval('[data-testid="gantt-link-context-menu"]', (el) => el.innerText);
  ok(/完成→开始|开始→开始|移除依赖/.test(menuText), 'link menu shows zh type options + 移除依赖', JSON.stringify(menuText.replace(/\n/g, ' ')));
  await page.screenshot({ path: path.join(OUT, '38-dep-link-menu.png') });

  // 3) Switch the link to SS.
  await page.click('[data-testid="gantt-link-menu-type-ss"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="gantt-link-t3-t4"]')?.getAttribute('data-link-type') === 'ss',
    { timeout: 4000 },
  );
  ok((await linkType('t3', 't4')) === 'ss', 'choosing 开始→开始 switches the link type to SS');
  await page.screenshot({ path: path.join(OUT, '39-dep-link-type-ss.png') });

  // 4) Remove the link.
  await rightClickLink('t3', 't4');
  await page.waitForSelector('[data-testid="gantt-link-menu-remove"]', { timeout: 4000 });
  await page.click('[data-testid="gantt-link-menu-remove"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="gantt-link-t3-t4"]'),
    { timeout: 4000 },
  );
  ok(!(await page.$('[data-testid="gantt-link-t3-t4"]')), '移除依赖 deletes the t3 → t4 link');
  await page.screenshot({ path: path.join(OUT, '40-dep-link-removed.png') });

  // 5) 添加紧前依赖 on t4 re-offers t3 as a candidate.
  await page.$eval('[data-testid="gantt-task-bar-t4"]', (el) => {
    const r = el.getBoundingClientRect();
    const cx = Math.min(Math.max(r.x + 20, 80), window.innerWidth - 240);
    const cy = Math.min(r.y + r.height / 2, window.innerHeight - 300);
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
  });
  await page.waitForSelector('[data-testid="gantt-context-menu-add-predecessor"]', { timeout: 4000 });
  await page.click('[data-testid="gantt-context-menu-add-predecessor"]');
  await page.waitForSelector('[data-testid="gantt-dep-picker"]', { timeout: 4000 });
  const hasT3 = await page.$('[data-testid="gantt-dep-picker-option-t3"]');
  ok(!!hasT3, 'the 添加紧前依赖 picker re-offers t3 (no longer linked)');
  await page.screenshot({ path: path.join(OUT, '41-dep-add-predecessor.png') });

  // 6) Pick t3 → the FS link returns.
  await page.click('[data-testid="gantt-dep-picker-option-t3"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="gantt-link-t3-t4"]')?.getAttribute('data-link-type') === 'fs',
    { timeout: 4000 },
  );
  ok((await linkType('t3', 't4')) === 'fs', 'picking t3 re-creates the FS link');

  console.log(`\nscreenshots → ${OUT} (38–41)`);
} catch (err) {
  console.error(err);
  fails.push(String(err));
} finally {
  await browser.close();
}

if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
