import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for objectstack#35548 (epic #35547), as redrawn by
 * objectstack#35878 (two rows): the list page's frame.
 *
 *   view bar 40 (the object's name as the page's heading, the switcher and
 *   View settings on the left; search, New and ⋮ on the right) · condition
 *   row 40, resident · header 32 · row 33, 13px on the heading, the header,
 *   the cells and the bar buttons, the view switcher as one trigger (type
 *   icon → name → count → caret), and each column total under its own
 *   column, right edge on the column's right edge. No page bar is drawn
 *   above the view bar.
 *
 * ⚠️ A Playwright spec, not a vitest test: jsdom has no layout engine, so a
 * height read there is 0 and a class-shape assertion would pass against
 * classes that do nothing.
 *
 * ## What is real here and what is a fixture
 *
 * REAL, read out of the sources at run time and compiled with the installed
 * `tailwindcss`: the view bar's object name (`objectViewPageHeader.tsx`) and
 * the 「新建」 button's (`objectViewHeaderChrome.tsx`); the view bar's row,
 * cluster and text-trigger constants (`listToolbarRow.ts`), the View settings
 * trigger that reads that constant (`ViewSettingsPopover.tsx`) and the
 * condition row (`ListView.tsx`); the switcher trigger and the order of its children
 * (`objectViewTitleSwitcher.tsx`); the grid's density constant and default
 * row arm (`ObjectGrid.tsx`), the row ⋮ trigger (`RowActionMenu.tsx`), the
 * header label and summary cell classes (`data-table.tsx`), the Shadcn table
 * primitives (`ui/table.tsx`, read only), and the zh-Hans / en summary
 * strings. Change a class in any of them and what this file measures changes.
 *
 * FIXTURE: the shell's top bar is a 48px block (its own height, measured in
 * the running Console, is not this card's); the element tree is transcribed
 * from those sources; icons are empty boxes of their declared size; `cn`'s
 * merge is replaced by Tailwind's own utility order (a later `px-3` beats an
 * earlier `p-4` there too). The assertions are heights, font sizes, order and
 * edges, not pixels of glyphs.
 *
 * ## The live reading this was cut from
 * CRM 商机 at 1280×800 zh-CN, light and dark: top bar 48, page bar 44, view
 * bar 40, header 32, first data row top 164, rows 33, 13px throughout, totals
 * on their columns' right edges. After objectstack#35878 (showcase tasks at
 * 1312, light and dark): top bar 48, view bar 40, condition row 40, the
 * header's top at 128 with and without a condition set. The kanban view draws the same two bars —
 * pinned in `ListView.viewBarLeading-35548.test.tsx`, where the bars are
 * drawn for every view type by one component.
 */

const ROOT = uiRoot();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const FILES = {
  pageBar: 'packages/app-shell/src/views/objectViewPageHeader.tsx',
  viewSettings: 'packages/plugin-list/src/components/ViewSettingsPopover.tsx',
  chrome: 'packages/app-shell/src/views/objectViewHeaderChrome.tsx',
  row: 'packages/plugin-list/src/listToolbarRow.ts',
  list: 'packages/plugin-list/src/ListView.tsx',
  switcher: 'packages/app-shell/src/views/objectViewTitleSwitcher.tsx',
  grid: 'packages/plugin-grid/src/ObjectGrid.tsx',
  rowAction: 'packages/plugin-grid/src/components/RowActionMenu.tsx',
  dataTable: 'packages/components/src/renderers/complex/data-table.tsx',
  table: 'packages/components/src/ui/table.tsx',
  zh: 'packages/i18n/src/locales/zh-Hans.ts',
  en: 'packages/i18n/src/locales/en.ts',
} as const;
const SRC = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)])) as Record<keyof typeof FILES, string>;

/** The first capture of `re` in `file`'s source, or a throw naming what is missing. */
function pick(key: keyof typeof FILES, re: RegExp, what: string): string {
  const hit = re.exec(SRC[key]);
  if (!hit) throw new Error(`${FILES[key]}: ${what} not found`);
  return hit[1];
}
const constant = (key: keyof typeof FILES, name: string) =>
  pick(key, new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`), `string constant ${name}`);
/** Every token of `want` is in `cls`, or a throw: a walk onto the wrong element fails loudly. */
function carrying(cls: string, want: string[], where: string): string {
  for (const t of want) if (!cls.split(/\s+/).includes(t)) throw new Error(`${where}: "${cls}" lacks "${t}"`);
  return cls;
}

// ── the page's name and acts, in the view bar (objectstack#35878) ───────────
const OBJECT_NAME = carrying(pick('pageBar', /data-testid="list-view-bar-object"[\s\S]*?<h1 className="([^"]+)"/, "the view bar's object name"), ['text-[13px]', 'truncate'], 'object name');
const NEW_BUTTON = carrying(pick('chrome', /className="(shadow-none gap-1 h-7[^"]*)"/, 'the create button'), ['h-7', 'text-[13px]'], 'create button');

// ── view bar ────────────────────────────────────────────────────────────────
const TOOLBAR_ROW = constant('row', 'TOOLBAR_ROW');
const TOOLBAR_CLUSTER = constant('row', 'TOOLBAR_CLUSTER');
const TEXT_TRIGGER = carrying(constant('row', 'TOOLBAR_TEXT_TRIGGER'), ['h-7', 'text-[13px]'], 'TOOLBAR_TEXT_TRIGGER');
const CONDITION_ROW = carrying(
  pick('list', /data-slot="list-condition-row"[\s\S]*?className="([^"]+)"/, 'the condition row'),
  ['min-h-10', 'flex-nowrap'],
  'condition row',
);
const SWITCHER_TRIGGER = carrying(
  pick('switcher', /data-testid="list-view-switcher"[\s\S]*?className=\{cn\(\s*(?:\/\/[^\n]*\n\s*)*'([^']+)'/, 'the switcher trigger'),
  ['h-7', 'text-[13px]', 'items-center'],
  'switcher trigger',
);
/** The trigger's children in source order, read off their test ids. */
const SWITCHER_PARTS = ['type-icon', 'label', 'count', 'caret'] as const;
const switcherBody = SRC.switcher.slice(SRC.switcher.indexOf('data-testid="list-view-switcher"'), SRC.switcher.indexOf('</PopoverTrigger>'));

// ── grid ────────────────────────────────────────────────────────────────────
const DENSITY = (() => {
  const block = pick('grid', /export const OBJECT_GRID_TABLE_DENSITY = \[([\s\S]*?)\]\.join/, 'OBJECT_GRID_TABLE_DENSITY');
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).join(' ');
})();
const ROW_CELL = carrying(pick('grid', /rowHeightMode === 'compact'\s*\?\s*'([^']+)'/, 'the default (compact) row arm'), ['h-8', 'text-[13px]'], 'row arm');
const ROW_ACTION = (() => {
  const at = SRC.rowAction.indexOf('data-testid="row-action-trigger"');
  const cls = [...SRC.rowAction.slice(0, at).matchAll(/className="([^"]+)"/g)].pop()?.[1];
  if (!cls) throw new Error(`${FILES.rowAction}: the row ⋮ trigger's class was not found`);
  return cls;
})();
const HEADER_LABEL = carrying(pick('dataTable', /<span className="([^"]+)" title=\{col\.header/, 'the column header label'), ['text-[13px]'], 'header label');
const SUMMARY_CELL = carrying(pick('dataTable', /"(h-8 px-\S+ py-0 [^"]+)",\s*\n\s*col\.align === 'right'/, 'the summary cell'), ['h-8', 'tabular-nums'], 'summary cell');
/** What the summary cell adds for a right-aligned column, read off its own arm. */
const SUMMARY_RIGHT = pick('dataTable', /"h-8 px-\S+ py-0 [^"]+",\s*\n\s*col\.align === 'right' && '([^']+)'/, "the summary cell's right-aligned arm");
const TABLE = pick('table', /cn\("(w-full caption-bottom[^"]*)"/, 'Table');
const THEAD = pick('table', /<thead ref=\{ref\} className=\{cn\("([^"]+)"/, 'TableHeader');
const TR = pick('table', /<tr\s+ref=\{ref\}\s+className=\{cn\(\s*"([^"]+)"/, 'TableRow');
const TH = pick('table', /<th\s+ref=\{ref\}\s+className=\{cn\(\s*"([^"]+)"/, 'TableHead');
const TD = pick('table', /cn\("(p-4 align-middle[^"]*)"/, 'TableCell');

// ── summary strings ─────────────────────────────────────────────────────────
function summaryStrings(key: 'zh' | 'en') {
  const src = SRC[key];
  const at = src.indexOf('countLead:');
  // Up to the block's closing brace on its own line (a value's `{{value}}` is not one).
  const close = /\n\s*\}/.exec(src.slice(at));
  const block = src.slice(src.lastIndexOf('summary: {', at), close ? at + close.index : src.length);
  const s = (name: string) => {
    const hit = new RegExp(`\\b${name}:\\s*'([^']*)'`).exec(block);
    if (!hit) throw new Error(`${FILES[key]}: grid.summary.${name} not found`);
    return hit[1];
  };
  return { pattern: s('pattern'), lead: s('countLead'), labels: ['count', 'sum', 'avg', 'min', 'max', 'countUnique'].map(s) };
}

const ICON_16 = 'flex shrink-0 h-4 w-4';
const COLUMNS = [
  { key: 'name', label: '商机名称', width: 260, value: 'Globex — Initial Seats', align: '' },
  { key: 'account', label: '客户', width: 160, value: 'Globex Ltd', align: '' },
  { key: 'amount', label: '金额', width: 150, value: '145,000.00', align: 'text-right tabular-nums', total: 'sum' },
  { key: 'expected', label: '预期收入', width: 150, value: '16,000.00', align: 'text-right tabular-nums', total: 'sum' },
  { key: 'close', label: '预计成交日期', width: 140, value: '2027年1月3日', align: '' },
];

function fixture(locale: 'zh' | 'en' = 'zh'): string {
  const str = summaryStrings(locale);
  const total = (label: string, value: string) => str.pattern.replace('{{label}}', label).replace('{{value}}', value);
  const row = (i: number) => `<tr class="${TR}" data-row="${i}">
      <td class="${TD} ${ROW_CELL} w-10"></td>
      ${COLUMNS.map((c) => `<td class="${TD} ${ROW_CELL} ${c.align}" data-col="${c.key}"><span class="cell-text">${c.value}</span></td>`).join('')}
      <td class="${TD} ${ROW_CELL} w-16"><div class="flex items-center justify-end"><button class="inline-flex items-center justify-center ${ROW_ACTION}"><span class="h-4 w-4"></span></button></div></td>
    </tr>`;
  return `
<div id="topbar" style="height:48px"></div>
<div id="viewbar" class="${TOOLBAR_ROW}">
  <div class="flex min-w-0 flex-1 items-center gap-2">
    <span class="flex min-w-0 items-center gap-1.5"><span class="${ICON_16}"></span><h1 id="title" class="${OBJECT_NAME}">商机</h1><span>/</span></span>
    <button id="switcher" class="${SWITCHER_TRIGGER}">
      <span id="sw-type-icon" class="${ICON_16}"></span><span id="sw-label" class="truncate">全部商机</span><span id="sw-count" class="shrink-0 tabular-nums">12</span><span id="sw-caret" class="h-3.5 w-3.5 shrink-0"></span>
    </button>
    <button class="bar-button inline-flex items-center ${TEXT_TRIGGER}">视图设置</button>
  </div>
  <div class="${TOOLBAR_CLUSTER}"><button class="inline-flex h-7 w-7"></button><button id="new" class="inline-flex items-center ${NEW_BUTTON}">新建</button><button class="inline-flex h-7 w-7"></button></div>
</div>
<div id="condition" class="${CONDITION_ROW}"><span class="inline-flex h-6 w-16 shrink-0"></span><span class="inline-flex h-6 w-16 shrink-0"></span></div>
<table class="${TABLE} ${DENSITY}" style="table-layout:fixed;width:${40 + COLUMNS.reduce((n, c) => n + c.width, 0) + 64}px">
  <thead class="${THEAD}"><tr class="${TR}">
    <th class="${TH}" style="width:40px"></th>
    ${COLUMNS.map((c) => `<th class="${TH} px-3 ${c.align}" style="width:${c.width}px" data-col="${c.key}"><span class="${HEADER_LABEL}">${c.label}</span></th>`).join('')}
    <th class="${TH}" style="width:64px"></th>
  </tr></thead>
  <tbody>${Array.from({ length: 3 }, (_, i) => row(i)).join('')}</tbody>
  <tfoot id="tfoot"><tr class="${TR} border-t border-b-0">
    <td class="${TD} w-10 h-8 py-0"></td>
    ${COLUMNS.map((c, i) => {
      const figure = c.total ? `<span class="total-text">${total(str.labels[1], '1,415,000.00')}</span>` : '';
      const lead = i === 0 ? `<span id="lead">${str.lead.replace('{{value}}', '12')}</span>` : '';
      return `<td class="${TD} ${SUMMARY_CELL} ${c.align ? SUMMARY_RIGHT : ''}" data-col="${c.key}">${lead}${figure}</td>`;
    }).join('')}
    <td class="${TD} h-8 py-0"></td>
  </tr></tfoot>
</table>`;
}

const CANDIDATES = [
  OBJECT_NAME, NEW_BUTTON, TOOLBAR_ROW, TOOLBAR_CLUSTER, TEXT_TRIGGER, CONDITION_ROW,
  SWITCHER_TRIGGER, DENSITY, ROW_CELL, ROW_ACTION, HEADER_LABEL, SUMMARY_CELL, SUMMARY_RIGHT, TABLE, THEAD, TR, TH, TD, ICON_16,
  ...COLUMNS.map((c) => c.align),
  'flex min-w-0 flex-1 items-center gap-2 gap-1.5 h-6 w-16 inline-flex h-7 w-7 truncate shrink-0 tabular-nums h-3.5 w-3.5 h-4 w-4 w-10 w-16 justify-end px-3 h-8 py-0 border-t border-b-0',
]
  .join(' ')
  .split(/\s+/)
  .filter(Boolean);

let css = '';
test.beforeAll(async () => {
  const twEntry = fileURLToPath(import.meta.resolve('tailwindcss/index.css'));
  const compiler = await compile('@import "tailwindcss";', {
    base: path.dirname(twEntry),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? twEntry : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
    },
  });
  css = compiler.build(CANDIDATES);
  if (!css.includes('thead th')) throw new Error('Tailwind dropped the density variants, so the header height under test would be inert.');
});

async function measure(page: Page, locale: 'zh' | 'en' = 'zh') {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<style>${css} body{margin:0}</style>${fixture(locale)}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height };
    };
    const $ = (s: string) => document.querySelector(s);
    const fs = (el: Element | null) => (el ? getComputedStyle(el).fontSize : null);
    const rows = [...document.querySelectorAll('tbody tr')];
    const cols = [...document.querySelectorAll('thead th[data-col]')].map((th) => {
      const key = (th as HTMLElement).dataset.col!;
      const foot = $(`#tfoot td[data-col="${key}"]`);
      const text = foot?.querySelector('.total-text');
      const cellText = $(`tbody tr td[data-col="${key}"] .cell-text`);
      return { key, th: rect(th)!, foot: rect(foot), text: rect(text ?? null), cellText: rect(cellText) };
    });
    return {
      page: rect($('#page')),
      viewbar: rect($('#viewbar'))!,
      condition: rect($('#condition'))!,
      thead: rect($('thead tr'))!,
      firstRow: rect(rows[0])!,
      rowHeights: rows.map((r) => r.getBoundingClientRect().height),
      newButton: rect($('#new'))!,
      barButtons: [...document.querySelectorAll('.bar-button')].map((b) => b.getBoundingClientRect().height),
      fonts: {
        title: fs($('#title')),
        header: fs($('thead th[data-col] span')),
        cell: fs($('tbody td[data-col]')),
        bar: [...document.querySelectorAll('.bar-button, #switcher, #new')].map(fs),
      },
      switcherOrder: ['type-icon', 'label', 'count', 'caret'].map((p) => rect($(`#sw-${p}`))!.left),
      cols,
      footText: ($('#tfoot') as HTMLElement).innerText,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test.describe('the list page frame (objectstack#35548)', () => {
  test('the sources still draw what this file measures', () => {
    expect(SRC.grid.includes('OBJECT_GRID_TABLE_DENSITY, schema.className'), `${FILES.grid} no longer hands its density to the table`).toBe(true);
    expect(/className=\{cn\(\s*TOOLBAR_TEXT_TRIGGER,[\s\S]{0,200}data-testid="toolbar-display-trigger"/.test(SRC.viewSettings), `${FILES.viewSettings}: View settings no longer draws from TOOLBAR_TEXT_TRIGGER`).toBe(true);
    // The view bar names the object as the page's heading (objectstack#35878).
    expect(SRC.pageBar.includes('data-testid="list-view-bar-object-name"'), `${FILES.pageBar} no longer names the object in the view bar`).toBe(true);
    // One trigger: type icon → name → count → caret, in that source order.
    const at = SWITCHER_PARTS.map((p) => switcherBody.indexOf(`data-testid="list-view-switcher-${p}"`));
    expect(at.every((i) => i > 0), `a switcher part is missing: ${JSON.stringify(at)}`).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test('1280×800: no page bar, view bar 40, condition row 40, header 32, rows 33, first row top ≤ 168', async ({ page }) => {
    const r = await measure(page);
    expect(r.page, 'a page bar is drawn above the view bar').toBeNull();
    expect(r.viewbar.top).toBeCloseTo(48, 0);
    expect(r.viewbar.height).toBeCloseTo(40, 0);
    expect(r.condition.height, 'the resident condition row').toBeCloseTo(40, 0);
    expect(r.thead.top, 'the header under the two rows').toBeCloseTo(128, 0);
    expect(r.thead.height).toBeCloseTo(32, 0);
    for (const h of r.rowHeights) expect(h, 'a data row is not 33px').toBeCloseTo(33, 0);
    expect(r.firstRow.top).toBeLessThanOrEqual(168);
    expect(r.newButton.height).toBeGreaterThanOrEqual(24);
    expect(r.newButton.height).toBeLessThanOrEqual(28);
    for (const h of r.barButtons) {
      expect(h).toBeGreaterThanOrEqual(24);
      expect(h).toBeLessThanOrEqual(28);
    }
    expect(r.overflowX).toBe(0);
  });

  test('13px on the object name, the header, the cells and every bar button', async ({ page }) => {
    const { fonts } = await measure(page);
    expect(fonts.title).toBe('13px');
    expect(fonts.header).toBe('13px');
    expect(fonts.cell).toBe('13px');
    expect(fonts.bar.length).toBe(3);
    for (const f of fonts.bar) expect(f).toBe('13px');
  });

  test('the switcher reads type icon → name → count → caret, left to right', async ({ page }) => {
    const { switcherOrder } = await measure(page);
    expect([...switcherOrder].sort((a, b) => a - b)).toEqual(switcherOrder);
  });

  test('each total sits under its column: cell and figure right edges on the column\'s', async ({ page }) => {
    const r = await measure(page);
    const totals = r.cols.filter((c) => c.text);
    expect(totals.length).toBe(2);
    for (const c of totals) {
      expect(Math.abs(c.foot!.right - c.th.right), `${c.key}: summary cell edge`).toBeLessThanOrEqual(1);
      // The figure ends where the column's own figures end (same inset).
      expect(Math.abs(c.text!.right - c.cellText!.right), `${c.key}: total ${c.text!.right} vs cells ${c.cellText!.right}`).toBeLessThanOrEqual(1);
    }
  });

  for (const locale of ['zh', 'en'] as const) {
    test(`${locale}: the footer leads with the count and never doubles a colon`, async ({ page }) => {
      const r = await measure(page, locale);
      const s = summaryStrings(locale);
      expect(r.footText.trim().startsWith(s.lead.replace('{{value}}', '12'))).toBe(true);
      expect(r.footText).not.toMatch(/::|：:|:：|：：/);
      // Every label the pattern may carry, not only the one drawn.
      for (const label of s.labels) {
        expect(s.pattern.replace('{{label}}', label)).not.toMatch(/::|：:|:：|：：/);
      }
    });
  }
});
