import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { compile } from 'tailwindcss';
import { build, type Plugin, type Rollup } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for objectstack#35663 (epic #35547): the list page draws ONE
 * left edge, 16 px in from the main area, for the page bar's object icon, the
 * view bar's view icon, the header's select-all box, every row's checkbox and
 * the footer's count; the selection column is 40 px wide (16 inset + 16 box +
 * 8 gap) on a list that fits and on one that scrolls sideways, before and
 * after a scroll; the grid draws no row numbers and every row's checkbox is
 * visible without a hover.
 *
 * ## The defect
 *
 * The table lays its columns out automatically, and the selection column
 * declared only `w-10`. Once the columns overflow the box, the auto layout
 * squeezes that column to its content (16 px, the checkbox), so the box sat at
 * the main area's very left; on a list that fits it sat at 11 or 12. The view
 * bar's icon sat at 22 (the bar's 16 plus the switcher's own 6 of padding),
 * and the grid opened with row numbers in the leading cell, the checkbox only
 * on hover.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * jsdom has no layout engine; the defect IS the table's automatic layout.
 * The bundling follows `e2e/list-narrow-pinned-columns-35446.spec.ts`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: plugin-grid's `ObjectGrid` with the `data-table` it draws, and
 * app-shell's `PageHeader` in its list posture, bundled by Vite from source and
 * mounted with React's client renderer; the view bar's classes are
 * `listToolbarRow.ts`'s own constants, imported into the bundle; the view
 * switcher's trigger class and the record-count bar's class are read out of
 * `objectViewTitleSwitcher.tsx` and `ListView.tsx` at run time. The stylesheet
 * is the real theme (`packages/components/src/index.css`) compiled by the
 * installed Tailwind for exactly the classes the page carries.
 *
 * FIXTURES: the rows and fields are literals; the main area is a frame beside
 * a 256 px block standing in for the open sidebar (edges are measured from the
 * frame, so the sidebar's own width is not an input); icons are 16 px boxes;
 * the switcher's and footer's contents are short literals. Fonts are
 * Chromium's fallbacks: the assertions are edges and widths of boxes, not of
 * glyphs.
 *
 * ## The chart view's view bar (objectstack#35729)
 *
 * A chart view draws its own copy of the view bar (`chartPage` in
 * `objectViewListRenderer.tsx`), which kept `sm:px-4` after #35663 and so put
 * the view icon at 22. Its class is read out of that file at run time and a
 * second bar with that class, holding the same switcher, sits under the list's
 * view bar: at 1280 its icon starts on the list's 16 and its right padding is
 * the list bar's; at 375 it is no closer than 12 to the left edge.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);
const read = (rel: string) => readFileSync(source(rel), 'utf8');

const THEME_CSS = source('packages/components/src/index.css');
// Workspace sources by path, never by package name: the e2e type-check program
// imports no workspace package (it builds nothing first).
const PLUGIN_GRID = source('packages/plugin-grid/src/index.tsx');
const PAGE_HEADER = source('packages/app-shell/src/layout/PageHeader.tsx');
const TOOLBAR_ROW_TS = source('packages/plugin-list/src/listToolbarRow.ts');
const FIELDS_PKG = source('packages/fields/src/index.tsx');
const REACT_BINDINGS = source('packages/react/src/index.ts');
const ROUTER = createRequire(source('packages/app-shell/package.json')).resolve('react-router-dom');

/** The first capture of `re` in `rel`'s source, or a throw naming what is missing. */
function pick(rel: string, re: RegExp, what: string): string {
  const hit = re.exec(read(rel));
  if (!hit) throw new Error(`${rel}: ${what} not found`);
  return hit[1];
}
const SWITCHER_CLASS = pick(
  'packages/app-shell/src/views/objectViewTitleSwitcher.tsx',
  /data-testid="list-view-switcher"[\s\S]*?className=\{cn\(\s*(?:\/\/[^\n]*\n\s*)*'([^']+)'/,
  'the switcher trigger class',
);
const CHART_BAR_CLASS = pick(
  'packages/app-shell/src/views/objectViewListRenderer.tsx',
  /const chartPage = [\s\S]*?hasPhoneTitle && \(\s*<div className="([^"]+)"/,
  'the chart view bar class',
);
const FOOTER_CLASS = pick(
  'packages/plugin-list/src/ListView.tsx',
  /className="([^"]+)"\s*data-testid="record-count-bar"/,
  'the record-count bar class',
);

/** The open sidebar beside the main area at 1280 (the shell's 16rem). */
const SIDEBAR = 256;
/** The one left edge (card): every leading item starts here, from the main area's left. */
const EDGE = 16;
/** The selection column: 16 inset + 16 box + 8 gap. */
const SELECTION_WIDTH = 40;

/** A contacts-like list: more columns than the 1024 px main area holds. */
const WIDE = ['name', 'email', 'phone', 'account', 'title', 'department', 'owner', 'city', 'country', 'lead_source', 'created_at'];
/** An accounts-like list: few enough to fit. */
const NARROW = ['name', 'industry', 'city', 'owner'];

interface Case {
  name: string;
  viewport: number;
  sidebar: number;
  columns: string[];
  switcherClass: string;
  chartBarClass: string;
  footerClass: string;
}

const ENTRY = '\0list-left-edge:entry';

/** `@object-ui/<pkg>` to `packages/<pkg>/src`, and a subpath into that `src/`. */
function workspaceSources(): Plugin {
  return {
    name: 'list-left-edge-workspace-src',
    enforce: 'pre',
    async resolveId(id, importer) {
      const m = /^@object-ui\/([a-z0-9-]+)(?:\/(.+))?$/.exec(id);
      if (!m) return null;
      const [, pkg, sub] = m;
      const target =
        pkg === 'types' && sub === 'zod'
          ? source('packages/types/src/zod/index.zod.ts')
          : source(`packages/${pkg}/src${sub ? `/${sub}` : ''}`);
      const resolved = await this.resolve(target, importer, { skipSelf: true });
      if (!resolved) throw new Error(`${id} did not resolve to a source file under ${target}`);
      return resolved;
    },
  };
}

/** The page: the case named by `window.__case`, mounted with the client renderer. */
function entry(): Plugin {
  const code = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from ${JSON.stringify(ROUTER)};
import { ObjectGrid } from ${JSON.stringify(PLUGIN_GRID)};
import { PageHeader } from ${JSON.stringify(PAGE_HEADER)};
import * as Row from ${JSON.stringify(TOOLBAR_ROW_TS)};
import { registerAllFields } from ${JSON.stringify(FIELDS_PKG)};
import { ActionProvider, SchemaRendererProvider } from ${JSON.stringify(REACT_BINDINGS)};

registerAllFields();
const h = React.createElement;
const c = window.__case;
const LABELS = {
  name: 'Name', email: 'Email', phone: 'Phone', account: 'Account', title: 'Title', department: 'Department',
  owner: 'Owner', city: 'City', country: 'Country', lead_source: 'Lead source', created_at: 'Created', industry: 'Industry',
};
const FIELDS = Object.fromEntries(Object.entries(LABELS).map(([name, label]) => [name, { name, label, type: name === 'created_at' ? 'date' : 'text' }]));
FIELDS.id = { name: 'id', type: 'text' };
const ROWS = Array.from({ length: 12 }, (_, i) => ({
  id: 'r' + (i + 1),
  name: ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Edsger Dijkstra'][i % 4] + ' ' + (i + 1),
  email: 'person' + (i + 1) + '@example.com', phone: '+1 555 010 ' + String(i).padStart(4, '0'),
  account: 'Globex Corporation', title: 'Director of Engineering', department: 'Research and Development',
  owner: 'Bill Admin', city: 'San Francisco', country: 'United States', lead_source: 'Partner referral',
  created_at: '2026-11-' + String((i % 28) + 1).padStart(2, '0'), industry: 'Manufacturing',
}));
const dataSource = {
  find: async () => ({ data: ROWS, total: ROWS.length }),
  getObjectSchema: async (name) => ({ name, fields: FIELDS }),
};
const box16 = (id) => h('span', { id, className: 'inline-block h-4 w-4 shrink-0' });
createRoot(document.getElementById('root')).render(
  h(MemoryRouter, null,
    h(ActionProvider, { handlers: {} },
      h(SchemaRendererProvider, { dataSource },
        h('div', { className: 'flex', style: { width: c.viewport + 'px' } },
          h('div', { id: 'sidebar', style: { width: c.sidebar + 'px', flexShrink: 0 } }),
          h('div', { id: 'main', className: 'flex min-w-0 flex-1 flex-col bg-background', style: { height: '640px' } },
            h(PageHeader, {
              posture: 'list',
              title: 'Contacts',
              icon: box16('page-icon'),
              actions: h('button', { id: 'page-new', className: 'inline-flex h-7 items-center px-2' }, 'New'),
            }),
            h('div', { id: 'viewbar', className: Row.TOOLBAR_ROW },
              h('div', { className: Row.TOOLBAR_LEFT_GROUP_LEADING },
                h('div', { className: Row.TOOLBAR_LEADING },
                  h('button', { id: 'switcher', className: c.switcherClass }, box16('view-icon'), h('span', { className: 'truncate' }, 'All contacts')))),
              h('div', { id: 'cluster', className: Row.TOOLBAR_CLUSTER },
                ...['Filter', 'Sort', 'Options'].map((l) => h('button', { key: l, className: 'bar-button inline-flex items-center ' + Row.TOOLBAR_TEXT_TRIGGER }, l)))),
            h('div', { id: 'chartbar', className: c.chartBarClass },
              h('button', { id: 'chart-switcher', className: c.switcherClass }, box16('chart-view-icon'), h('span', { className: 'truncate' }, 'Pipeline chart'))),
            h('div', { className: 'flex min-h-0 flex-1 flex-col' },
              h(ObjectGrid, {
                dataSource,
                schema: {
                  type: 'object-grid',
                  objectName: 'contact',
                  columns: c.columns.map((field) => ({ field, label: LABELS[field] })),
                  selection: { type: 'multiple' },
                },
              })),
            h('div', { id: 'footer', className: c.footerClass },
              h('span', { id: 'footer-text', className: 'shrink-0 font-medium text-foreground/80' }, '12 records'))))))),
);
`;
  return {
    name: 'list-left-edge-entry',
    resolveId: (id) => (id === 'list-left-edge:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

/** Bundle the page once, from source, to one ES module held in memory. */
async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-list-left-edge'),
    logLevel: 'error',
    mode: 'production',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [workspaceSources(), entry()],
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: 'list-left-edge:entry',
        output: { format: 'es', codeSplitting: false },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunks = outputs.flatMap((o) => o.output).filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`expected one bundled chunk, got ${chunks.length}`);
  return chunks[0].code;
}

/** The real theme sheet, compiled for the given class candidates. */
async function tailwindFor(candidates: string[]): Promise<string> {
  const requireFromComponents = createRequire(source('packages/components/package.json'));
  const twEntry = requireFromComponents.resolve('tailwindcss/index.css');
  const compiler = await compile(readFileSync(THEME_CSS, 'utf8'), {
    base: path.dirname(THEME_CSS),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? twEntry : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
    },
    loadModule: async (id: string) => {
      const file = requireFromComponents.resolve(id);
      const mod = await import(pathToFileURL(file).href);
      return { path: file, base: path.dirname(file), module: mod.default ?? mod };
    },
  });
  return compiler.build(candidates);
}

let bundle = '';

/** Compile the stylesheet until the page's class set stops growing. */
async function styleUntilStable(page: Page, compiled: Set<string>): Promise<void> {
  const classesOnPage = () =>
    page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('[class]')].flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)).filter(Boolean),
      ),
    ]);
  for (let round = 0; ; round++) {
    const candidates = await classesOnPage();
    if (round > 0 && candidates.every((cls) => compiled.has(cls))) break;
    if (round === 5) throw new Error('the page kept adding classes; the stylesheet never caught up');
    candidates.forEach((cls) => compiled.add(cls));
    const css = await tailwindFor([...compiled]);
    await page.evaluate((text) => {
      let sheet = document.getElementById('tailwind');
      if (!sheet) {
        sheet = document.createElement('style');
        sheet.id = 'tailwind';
        document.head.appendChild(sheet);
      }
      sheet.textContent = text;
    }, css);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
}

/** Mount the case, style it, and wait until the table's geometry holds still. */
async function mount(page: Page, c: Omit<Case, 'switcherClass' | 'chartBarClass' | 'footerClass'>): Promise<void> {
  await page.setViewportSize({ width: c.viewport, height: 800 });
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div id="root"></div></body></html>');
  await page.evaluate((value) => {
    (window as unknown as { __case: Case }).__case = value;
  }, { ...c, switcherClass: SWITCHER_CLASS, chartBarClass: CHART_BAR_CLASS, footerClass: FOOTER_CLASS });
  await page.addScriptTag({ content: bundle, type: 'module' });
  // Below 768 the grid draws cards, not a table.
  await page.locator('tbody [role="checkbox"], [data-testid="grid-mobile-card"]').first().waitFor({ state: 'attached', timeout: 30_000 });
  const compiled = new Set<string>();
  await styleUntilStable(page, compiled);
  await page.evaluate(() => document.fonts?.ready);
  let last = '';
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => {
      const box = document.querySelector<HTMLElement>('[data-table-scroll-box]');
      const lead = document.querySelector('thead tr')?.children[0]?.getBoundingClientRect().width;
      return box ? `${box.clientWidth}:${box.scrollWidth}:${lead}` : 'none';
    });
    if (now === last) break;
    last = now;
    await page.waitForTimeout(300);
  }
  await styleUntilStable(page, compiled);
}

interface Reading {
  overflows: boolean;
  /** Left edges, from the main area's left. */
  left: {
    pageIcon: number;
    viewIcon: number;
    /** The chart view's view bar (objectstack#35729). */
    chartViewIcon: number;
    headerCheckbox: number;
    rowCheckboxes: number[];
    footerText: number;
    firstHeaderText: number;
    firstCellText: number;
  };
  /** Right edges, from the main area's right (distance in): the page bar's button box, the view bar's last label. */
  right: { pageAction: number; viewCluster: number; footer: number; scrollBox: number };
  /** The right padding of the list's view bar and of the chart view's (objectstack#35729). */
  barPaddingRight: { list: number; chart: number };
  /** The selection column's header cell: width and drawn left, from the main area. */
  selection: { width: number; left: number };
  rowNumbers: number;
  /** Each row's checkbox: its effective opacity at rest, no hover anywhere. */
  rowCheckboxOpacity: number[];
}

async function readEdges(page: Page): Promise<Reading> {
  await page.mouse.move(0, 0);
  return page.evaluate(() => {
    const main = document.getElementById('main')!.getBoundingClientRect();
    const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
    const r = (el: Element | null) => {
      if (!el) throw new Error('an element under test is missing');
      return el.getBoundingClientRect();
    };
    const x = (el: Element | null) => Math.round((r(el).left - main.left) * 10) / 10;
    const inRight = (el: Element | null) => Math.round((main.right - r(el).right) * 10) / 10;
    /** The product of the opacities from the element up to the table. */
    const opacity = (el: Element) => {
      let o = 1;
      for (let n: Element | null = el; n && n.tagName !== 'TABLE'; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
      return o;
    };
    const head = document.querySelector('thead tr')!;
    const lead = head.children[0] as HTMLElement;
    const firstData = head.querySelector('th[data-column-key]')!;
    const firstKey = firstData.getAttribute('data-column-key')!;
    const firstRow = document.querySelector('tbody tr')!;
    const firstCellIndex = [...head.children].indexOf(firstData);
    const firstCell = firstRow.children[firstCellIndex] as HTMLElement;
    /** The first text-bearing descendant's box (the text, not the padded cell). */
    const textOf = (el: Element) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
      const t = walker.nextNode();
      if (!t) throw new Error(`no text under ${firstKey}`);
      const range = document.createRange();
      range.selectNodeContents(t);
      return range.getBoundingClientRect();
    };
    const rowBoxes = [...document.querySelectorAll('tbody [role="checkbox"]')];
    return {
      overflows: box.scrollWidth > box.clientWidth + 1,
      left: {
        pageIcon: x(document.getElementById('page-icon')),
        viewIcon: x(document.getElementById('view-icon')),
        chartViewIcon: x(document.getElementById('chart-view-icon')),
        headerCheckbox: x(document.querySelector('thead [role="checkbox"]')),
        rowCheckboxes: rowBoxes.map((b) => x(b)),
        footerText: x(document.getElementById('footer-text')),
        firstHeaderText: Math.round((textOf(firstData).left - main.left) * 10) / 10,
        firstCellText: Math.round((textOf(firstCell).left - main.left) * 10) / 10,
      },
      right: {
        pageAction: inRight(document.getElementById('page-new')),
        // The last trigger's label (the trigger's box is unpainted at rest).
        viewCluster: Math.round((main.right - textOf([...document.querySelectorAll('.bar-button')].pop()!).right) * 10) / 10,
        footer: Math.round((main.right - r(document.getElementById('footer-text')!.parentElement).right) * 10) / 10,
        scrollBox: inRight(box),
      },
      barPaddingRight: {
        list: parseFloat(getComputedStyle(document.getElementById('viewbar')!).paddingRight),
        chart: parseFloat(getComputedStyle(document.getElementById('chartbar')!).paddingRight),
      },
      selection: { width: Math.round(r(lead).width * 10) / 10, left: x(lead) },
      rowNumbers: document.querySelectorAll('[data-slot="row-number"]').length,
      rowCheckboxOpacity: rowBoxes.map((b) => opacity(b)),
    };
  });
}

/** Scroll the table to its far right, read the selection column, scroll back. */
async function scrollRoundTrip(page: Page): Promise<{ far: { width: number; left: number; checkbox: number }; back: { width: number; left: number } }> {
  return page.evaluate(async () => {
    const main = document.getElementById('main')!.getBoundingClientRect();
    const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
    const lead = document.querySelector('thead tr')!.children[0] as HTMLElement;
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const read = () => {
      const lr = lead.getBoundingClientRect();
      return { width: Math.round(lr.width * 10) / 10, left: Math.round((lr.left - main.left) * 10) / 10 };
    };
    box.scrollLeft = box.scrollWidth;
    await frame();
    const far = { ...read(), checkbox: Math.round((document.querySelector('thead [role="checkbox"]')!.getBoundingClientRect().left - main.left) * 10) / 10 };
    box.scrollLeft = 0;
    await frame();
    return { far, back: read() };
  });
}

/** Scrolled to the far right: is any strip between the frozen cells left uncovered? */
async function frozenGap(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
    box.scrollLeft = box.scrollWidth;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const cells = [...document.querySelector('tbody tr')!.children].filter((c) => getComputedStyle(c).position === 'sticky' && getComputedStyle(c).left !== 'auto');
    let gap = 0;
    for (let i = 1; i < cells.length; i++) {
      gap = Math.max(gap, cells[i].getBoundingClientRect().left - cells[i - 1].getBoundingClientRect().right);
    }
    box.scrollLeft = 0;
    return Math.round(gap * 10) / 10;
  });
}

function report(testInfo: TestInfo, name: string, value: unknown): void {
  testInfo.annotations.push({ type: `list-left-edge@${name}`, description: JSON.stringify(value) });
  process.stdout.write(`[list-left-edge ${name}] ${JSON.stringify(value)}\n`);
}

function expectOnEdge(r: Reading, edge: number, slack = 1): void {
  const named: Array<[string, number]> = [
    ['page-bar icon', r.left.pageIcon],
    ['view-bar icon', r.left.viewIcon],
    ['chart view-bar icon', r.left.chartViewIcon],
    ['select-all box', r.left.headerCheckbox],
    ...r.left.rowCheckboxes.map((v, i): [string, number] => [`row ${i + 1} checkbox`, v]),
    ['footer count', r.left.footerText],
  ];
  for (const [what, at] of named) expect(Math.abs(at - edge), `${what} starts at ${at}, not ${edge}`).toBeLessThanOrEqual(slack);
}

test.describe('the list page draws one left edge (objectstack#35663)', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    bundle = await bundlePage();
  });

  for (const [name, columns, overflows] of [['wide', WIDE, true], ['narrow', NARROW, false]] as const) {
    test(`1280, ${name} list (${overflows ? 'scrolls sideways' : 'fits'}): every leading item at ${EDGE}, selection column ${SELECTION_WIDTH}`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await mount(page, { name, viewport: 1280, sidebar: SIDEBAR, columns: [...columns] });
      const r = await readEdges(page);
      report(testInfo, name, r);
      expect(r.overflows, `the ${name} fixture ${overflows ? 'no longer overflows' : 'overflows'} the main area`).toBe(overflows);
      expectOnEdge(r, EDGE);
      expect(Math.abs(r.selection.width - SELECTION_WIDTH), `the selection column is ${r.selection.width} wide`).toBeLessThanOrEqual(0.5);
      // Both lists hold it at the one constant, so they are equal to each other.
      expect(r.selection.left).toBeCloseTo(0, 0);
      // The first column's header label and its cells start on one line.
      expect(Math.abs(r.left.firstHeaderText - r.left.firstCellText), `header text ${r.left.firstHeaderText} vs cell text ${r.left.firstCellText}`).toBeLessThanOrEqual(1);
      // No row numbers; every row's checkbox shows without a hover.
      expect(r.rowNumbers, 'the grid draws row numbers').toBe(0);
      expect(r.rowCheckboxOpacity.length).toBe(12);
      for (const o of r.rowCheckboxOpacity) expect(o, 'a row checkbox is hidden until hover').toBe(1);
      // The right edges: the page bar's action and the view bar's cluster end
      // on one line, 16 in, as the footer's padding does.
      expect(Math.abs(r.right.pageAction - r.right.viewCluster), `page action ${r.right.pageAction} vs view cluster ${r.right.viewCluster}`).toBeLessThanOrEqual(1);
      expect(Math.abs(r.right.pageAction - EDGE)).toBeLessThanOrEqual(1);
      // The chart view's view bar is the list's (objectstack#35729): its icon
      // is on the list's view icon (also in `expectOnEdge`), its right end the list bar's.
      expect(Math.abs(r.left.chartViewIcon - r.left.viewIcon), `chart view icon ${r.left.chartViewIcon} vs list view icon ${r.left.viewIcon}`).toBeLessThanOrEqual(1);
      expect(r.barPaddingRight.chart, 'the chart view bar ends where the list view bar does').toBe(r.barPaddingRight.list);
    });
  }

  test('1280, wide list: scrolled to the far right and back, the selection column keeps its width and its place, no gap between frozen cells', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await mount(page, { name: 'wideScroll', viewport: 1280, sidebar: SIDEBAR, columns: [...WIDE] });
    const trip = await scrollRoundTrip(page);
    const gap = await frozenGap(page);
    report(testInfo, 'wideScroll', { trip, gap });
    for (const leg of [trip.far, trip.back]) {
      expect(Math.abs(leg.width - SELECTION_WIDTH), `the selection column is ${leg.width} wide after scrolling`).toBeLessThanOrEqual(0.5);
      expect(leg.left).toBeCloseTo(0, 0);
    }
    expect(Math.abs(trip.far.checkbox - EDGE)).toBeLessThanOrEqual(1);
    expect(gap, 'a strip between the frozen cells shows the scrolled content').toBeLessThanOrEqual(0.5);
  });

  test('375 (phone): no leading item closer than 12 to the left edge', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await mount(page, { name: 'phone', viewport: 375, sidebar: 0, columns: [...WIDE] });
    // Below 768 the grid draws each record as a card; its content is the
    // leading item there (the phone list's own layout is not this card's).
    const r = await page.evaluate(() => {
      const main = document.getElementById('main')!.getBoundingClientRect();
      const x = (el: Element | null) => {
        if (!el) throw new Error('an element under test is missing');
        return Math.round((el.getBoundingClientRect().left - main.left) * 10) / 10;
      };
      const cards = [...document.querySelectorAll('[data-testid="grid-mobile-card"]')];
      return {
        pageIcon: x(document.getElementById('page-icon')),
        viewIcon: x(document.getElementById('view-icon')),
        chartViewIcon: x(document.getElementById('chart-view-icon')),
        cardContent: cards.map((c) => x(c.firstElementChild)),
        footerText: x(document.getElementById('footer-text')),
      };
    });
    report(testInfo, 'phone', r);
    expect(r.cardContent.length).toBe(12);
    // Below `sm` the chart view's view bar keeps the list bar's `px-2` (objectstack#35729).
    expect(Math.abs(r.chartViewIcon - r.viewIcon), `chart view icon ${r.chartViewIcon} vs list view icon ${r.viewIcon}`).toBeLessThanOrEqual(1);
    for (const at of [r.pageIcon, r.viewIcon, r.chartViewIcon, ...r.cardContent, r.footerText]) {
      expect(at).toBeGreaterThanOrEqual(12);
    }
  });
});
