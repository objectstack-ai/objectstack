/**
 * 只读体验 + 移动端只读缩略 verification (Group 4).
 *
 * Drives the demo (?lang=zh) and asserts:
 *   1. ?readonly=1 → read-only badge shows, write affordances (resize/progress
 *      handles, undo/redo) are stripped, and the root carries data-readonly,
 *   2. an editable wide viewport keeps the handles and hides the badge (control),
 *   3. the read-only context menu offers "查看详情" but no mutation items,
 *   4. ?mobilereadonly=1 on a narrow (420px) viewport auto-enters read-only
 *      (移动端只读缩略) — badge + data-mobile-readonly + no handles.
 * Persists screenshots 49-51 under docs/verification/.
 *
 *   GANTT_DEMO_URL=http://localhost:5200 node packages/plugin-gantt/scripts/verify-readonly-mobile.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const EXEC =
  '/Users/baozhoutao/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = process.env.GANTT_DEMO_URL || 'http://localhost:5199';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../docs/verification');

const browser = await chromium.launch({ executablePath: EXEC });
const fails = [];
const ok = (cond, msg, detail = '') => {
  if (!cond) fails.push(msg);
  console.log(`${cond ? '✓' : '✗'} ${msg}${detail ? ` — ${detail}` : ''}`);
};
const has = (page, sel) => page.$(sel).then((el) => !!el);

try {
  // ---- 1) Desktop read-only (?readonly=1) ----------------------------------
  const wide = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await wide.newPage();
  await page.goto(`${BASE}?readonly=1&lang=zh`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="gantt-view-mode-day"]', { timeout: 8000 });
  await page.waitForTimeout(300);

  ok(await has(page, '[data-testid="gantt-readonly-badge"]'), '只读徽标在 readOnly 下显示 (read-only badge)');
  ok(!(await has(page, '[data-testid^="gantt-task-resize-left-"]')), 'readOnly 下隐藏缩放手柄 (no resize handles)');
  ok(!(await has(page, '[data-testid^="gantt-progress-handle-"]')), 'readOnly 下隐藏进度手柄 (no progress handle)');
  ok(!(await has(page, '[data-testid="gantt-undo"]')), 'readOnly 下隐藏撤销/重做 (no undo)');
  ok(await has(page, '[data-readonly="true"]'), '根节点带 data-readonly');
  await page.screenshot({ path: path.join(OUT, '49-readonly-desktop.png') });

  // ---- 3) Read-only context menu: view-only, no mutations ------------------
  const firstBar = await page.$('[data-testid^="gantt-task-bar-"]');
  ok(!!firstBar, '存在任务条用于右键测试');
  if (firstBar) {
    await firstBar.click({ button: 'right' });
    await page.waitForTimeout(200);
    ok(await has(page, '[data-testid="gantt-context-menu-view"]'), '只读右键菜单含「查看详情」');
    ok(!(await has(page, '[data-testid="gantt-context-menu-delete"]')), '只读右键菜单无「删除」');
    ok(!(await has(page, '[data-testid="gantt-context-menu-add-successor"]')), '只读右键菜单无「添加紧后依赖」');
    await page.screenshot({ path: path.join(OUT, '50-readonly-context-menu.png') });
  }
  await wide.close();

  // ---- 2) Editable wide control --------------------------------------------
  const ctrl = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const cpage = await ctrl.newPage();
  await cpage.goto(`${BASE}?lang=zh`, { waitUntil: 'networkidle' });
  await cpage.waitForSelector('[data-testid="gantt-view-mode-day"]', { timeout: 8000 });
  await cpage.waitForTimeout(300);
  ok(!(await has(cpage, '[data-testid="gantt-readonly-badge"]')), '可编辑(宽屏)无只读徽标');
  ok(await has(cpage, '[data-testid^="gantt-task-resize-left-"]'), '可编辑(宽屏)保留缩放手柄');
  await ctrl.close();

  // ---- 4) Mobile read-only thumbnail (?mobilereadonly=1, 420px) ------------
  const mob = await browser.newContext({ viewport: { width: 420, height: 820 } });
  const mpage = await mob.newPage();
  await mpage.goto(`${BASE}?mobilereadonly=1&lang=zh`, { waitUntil: 'networkidle' });
  await mpage.waitForSelector('[data-testid="gantt-view-mode-day"]', { timeout: 8000 });
  await mpage.waitForTimeout(400);
  ok(await has(mpage, '[data-testid="gantt-readonly-badge"]'), '窄屏 + mobileReadOnly 自动进入只读 (移动端只读缩略)');
  ok(await has(mpage, '[data-mobile-readonly="true"]'), '根节点带 data-mobile-readonly');
  ok(!(await has(mpage, '[data-testid^="gantt-task-resize-left-"]')), '移动端只读隐藏缩放手柄');
  await mpage.screenshot({ path: path.join(OUT, '51-mobile-readonly.png') });
  await mob.close();

  console.log(`\nscreenshots → ${OUT} (49–51)`);
} catch (err) {
  console.error(err);
  fails.push(String(err));
} finally {
  await browser.close();
}

if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
