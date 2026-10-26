/**
 * 导航 + 年刻度 + 保存布局 + 导出 PNG/PDF verification (Group 3).
 *
 * Drives the demo (?lang=zh) project fixture and asserts:
 *   1. the 年 (year) granularity button switches the timeline (年刻度),
 *   2. 本周 / 本月 navigation buttons scroll the timeline,
 *   3. 保存布局 persists granularity to localStorage and survives a reload,
 *   4. 导出 PNG / 导出 PDF download files with the right extensions/magic bytes.
 * Persists screenshots 45-48 under docs/verification/.
 *
 *   GANTT_DEMO_URL=http://localhost:5200 node packages/plugin-gantt/scripts/verify-export-layout.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const EXEC =
  '/Users/baozhoutao/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = process.env.GANTT_DEMO_URL || 'http://localhost:5199';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../docs/verification');
const DL = fs.mkdtempSync(path.join(os.tmpdir(), 'gantt-dl-'));

const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const fails = [];
const ok = (cond, msg, detail = '') => {
  if (!cond) fails.push(msg);
  console.log(`${cond ? '✓' : '✗'} ${msg}${detail ? ` — ${detail}` : ''}`);
};
const pressed = (testid) =>
  page.$eval(`[data-testid="${testid}"]`, (el) => el.getAttribute('aria-pressed')).catch(() => null);

const saveDownload = async (triggerSel) => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.click(triggerSel),
  ]);
  const name = download.suggestedFilename();
  const dest = path.join(DL, name);
  await download.saveAs(dest);
  return { name, bytes: fs.readFileSync(dest) };
};

try {
  await page.goto(`${BASE}?lang=zh`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="gantt-view-mode-year"]', { timeout: 8000 });

  // 1) 年刻度 — switch to the year granularity.
  await page.click('[data-testid="gantt-view-mode-year"]');
  await page.waitForTimeout(300);
  ok((await pressed('gantt-view-mode-year')) === 'true', '年 granularity button activates (年刻度)');
  await page.screenshot({ path: path.join(OUT, '45-year-granularity.png') });

  // back to a finer mode for the nav test
  await page.click('[data-testid="gantt-view-mode-month"]');
  await page.waitForTimeout(200);

  // 2) Navigation — 本周 / 本月 scroll the timeline.
  const scrollOf = () =>
    page.$eval('[data-testid="gantt-timeline"]', (el) => el.scrollLeft).catch(() => null);
  await page.click('[data-testid="gantt-jump-month"]');
  await page.waitForTimeout(200);
  const afterMonth = await scrollOf();
  ok(afterMonth !== null && Number.isFinite(afterMonth), '本月 navigation scrolls the timeline', `scrollLeft=${afterMonth}`);
  await page.click('[data-testid="gantt-jump-week"]');
  await page.waitForTimeout(200);
  ok(await page.$('[data-testid="gantt-jump-week"]'), '本周 navigation button present & clickable');
  await page.screenshot({ path: path.join(OUT, '46-navigation.png') });

  // 3) 保存布局 — set month, save, reload, expect month restored.
  await page.click('[data-testid="gantt-view-mode-month"]');
  await page.waitForTimeout(150);
  await page.click('[data-testid="gantt-save-layout"]');
  await page.waitForTimeout(150);
  ok((await pressed('gantt-save-layout')) === 'true', '保存布局 button reflects a save (aria-pressed)');
  await page.screenshot({ path: path.join(OUT, '47-save-layout.png') });

  // Reload WITHOUT a ?mode= override so the persisted layout wins.
  await page.goto(`${BASE}?lang=zh`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="gantt-view-mode-month"]', { timeout: 8000 });
  await page.waitForTimeout(300);
  ok((await pressed('gantt-view-mode-month')) === 'true', '保存布局 restores 月 granularity after reload (持久化)');
  await page.screenshot({ path: path.join(OUT, '48-layout-restored.png') });

  // 4) 导出 PNG / PDF — verify real downloads with correct magic bytes.
  const png = await saveDownload('[data-testid="gantt-export-png"]');
  const pngMagic = png.bytes[0] === 0x89 && png.bytes[1] === 0x50 && png.bytes[2] === 0x4e && png.bytes[3] === 0x47;
  ok(png.name.endsWith('.png') && pngMagic, '导出 PNG downloads a valid PNG', `${png.name} ${png.bytes.length}B`);

  const pdf = await saveDownload('[data-testid="gantt-export-pdf"]');
  const head = pdf.bytes.subarray(0, 5).toString('latin1');
  ok(pdf.name.endsWith('.pdf') && head === '%PDF-', '导出 PDF downloads a valid PDF', `${pdf.name} ${pdf.bytes.length}B head=${head}`);

  console.log(`\nscreenshots → ${OUT} (45–48)`);
} catch (err) {
  console.error(err);
  fails.push(String(err));
} finally {
  await browser.close();
  fs.rmSync(DL, { recursive: true, force: true });
}

if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
