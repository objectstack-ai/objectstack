/**
 * i18n verification for the Gantt plugin — drives the demo app in both
 * languages (?lang=en / ?lang=zh) and asserts the chrome is FULLY translated
 * with NO raw i18n keys leaking (e.g. "gantt.viewMode.day"). Persists one
 * screenshot per language into docs/verification/. Run with the demo up:
 *
 *   node packages/plugin-gantt/scripts/verify-i18n.mjs [--executable <chromium path>]
 *
 * Background: the central locale packs (@object-ui/i18n) shipped a STALE
 * `gantt:` namespace that predated Phases 4–6, so apps wrapped in I18nProvider
 * rendered raw keys for the newer toolbar/menu/viewMode strings. This guards
 * that the namespace stays complete (mirrors GANTT_DEFAULT_TRANSLATIONS).
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

// Collect chrome strings: every button title/aria-label + the view-mode tabs.
const collectChrome = () => page.evaluate(() => {
  const titles = [...document.querySelectorAll('button[title], [aria-label]')]
    .map((b) => b.getAttribute('title') || b.getAttribute('aria-label'))
    .filter(Boolean);
  const viewModes = [...document.querySelectorAll('[data-testid^="gantt-view-mode-"]')]
    .map((b) => b.textContent.trim());
  // The task-list header row (column names) is the muted border-b row inside
  // gantt-body — no test id of its own, so reach it by structure.
  const headerRow = document.querySelector('[data-testid="gantt-body"] .border-b');
  const cols = headerRow ? headerRow.innerText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  return { htmlLang: document.documentElement.lang, titles: [...new Set(titles)], viewModes, cols };
});

try {
  // ── English ───────────────────────────────────────────────────────────────
  console.log('\n[en] ?lang=en — chrome fully English, no raw keys');
  await page.goto(`${BASE}/?lang=en`);
  await page.waitForSelector('[data-testid="gantt-task-bar-t1"]');
  const en = await collectChrome();
  assert(en.htmlLang === 'en', 'html lang attribute', en.htmlLang);
  assert(!en.titles.some((t) => /^gantt\./.test(t)), 'no raw key in button titles', `${en.titles.length} titles`);
  assert(!en.viewModes.some((t) => /^gantt\./.test(t)), 'no raw key in view-mode tabs', en.viewModes.join('/'));
  assert(en.viewModes.join('/') === 'Day/Week/Month/Quarter', 'view-mode tabs English', en.viewModes.join('/'));
  assert(en.titles.includes('Highlight critical path'), 'critical-path title (Phase 6)', 'present');
  assert(en.titles.includes('Auto-schedule dependencies'), 'auto-schedule title (Phase 6)', 'present');
  assert(en.titles.includes('Export as PNG'), 'export title (Phase 6)', 'present');
  assert(en.titles.includes('Undo') && en.titles.includes('Redo'), 'undo/redo titles', 'present');
  await page.screenshot({ path: join(OUT, '22-i18n-english.png') });
  console.log('  📸 22-i18n-english.png');

  // ── Chinese ─────────────────────────────────────────────────────────────────
  console.log('\n[zh] ?lang=zh — chrome fully Chinese, no raw keys, localized dates');
  await page.goto(`${BASE}/?lang=zh`);
  await page.waitForSelector('[data-testid="gantt-task-bar-t1"]');
  const zh = await collectChrome();
  assert(zh.htmlLang === 'zh', 'html lang attribute', zh.htmlLang);
  assert(!zh.titles.some((t) => /^gantt\./.test(t)), 'no raw key in button titles', `${zh.titles.length} titles`);
  assert(!zh.viewModes.some((t) => /^gantt\./.test(t)), 'no raw key in view-mode tabs', zh.viewModes.join('/'));
  // every view-mode tab is a CJK glyph, not latin
  assert(zh.viewModes.every((t) => /[一-鿿]/.test(t)), 'view-mode tabs Chinese', zh.viewModes.join('/'));
  // column headers localized to Chinese (任务名称 / 开始 / 结束)
  assert(zh.cols.some((c) => /[一-鿿]/.test(c)), 'task-list column headers Chinese', zh.cols.join(','));
  await page.screenshot({ path: join(OUT, '23-i18n-chinese.png') });
  console.log('  📸 23-i18n-chinese.png');

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed. Output: ${OUT}`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
} catch (err) {
  console.error(err);
  await browser.close();
  process.exit(1);
}
