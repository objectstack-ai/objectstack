import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { build, type Plugin, type Rollup } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for objectstack#35446: an app list whose main area narrows (the
 * AI panel docked, a small window, the record drawer open) keeps every data
 * cell clear of the grid's fixed columns, keeps its name column frozen, and
 * shows its horizontal scrollbar while columns lie out of view.
 *
 * ## The defect
 *
 * The grid pinned its row-actions column (the row's "⋮") to the scroll box's
 * right edge. In a narrow box the table overflows, so at rest the pinned
 * column sat over whichever data column reached that edge (the card measured
 * the amount column cut to 「¥94,0」), and the scrollbar was transparent until
 * the pointer was over the box, so nothing said more columns lay to the right.
 * Now, while the table overflows its box, the "⋮" column joins the frozen zone
 * beside the name column (`useInlineRowActionFold` in plugin-grid) and the
 * scroll box draws its scrollbar at rest (`data-table`).
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * jsdom and happy-dom have no layout engine: no widths, no sticky offsets, no
 * `elementFromPoint`, and the move is decided from the widths the table draws.
 * The bundling follows `e2e/related-list-pinned-actions-width.spec.ts`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: plugin-grid's `ObjectGrid`, the `data-table` and `RowActionMenu`,
 * bundled by Vite from their source files and mounted in Chromium with React's
 * client renderer; the stylesheet is real Tailwind
 * (`packages/components/src/index.css`, its `@theme` included), compiled for
 * exactly the classes the mounted page carries. The row menu is opened and its
 * action dispatched with real pointer clicks.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - The rows, the object's fields and the row actions are literals shaped
 *     like the card's opportunity list; the data source answers them and the
 *     dispatched action is recorded on the page, not run.
 *   - The width is set by a frame around the grid, not by the AI panel, a
 *     window or a drawer: the rule reads the grid's own box, so the cause of
 *     the narrowing is not an input. 699 px is the main area the card measured
 *     with the AI panel docked in a 1167 px window; 1184 px is the list page's
 *     table width at a 1440 px window with the sidebar open (the reading
 *     `related-list-pinned-actions-width.spec.ts` names).
 *   - Fonts are Chromium's fallbacks. The assertions are overlaps, hits and
 *     which edge a column sticks to, not pixels; the readings go to the report.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const THEME_CSS = source('packages/components/src/index.css');
// The entry names workspace sources by path, never by package name: the e2e
// type-check program must import no workspace package (it builds nothing first).
const PLUGIN_GRID = source('packages/plugin-grid/src/index.tsx');
const FIELDS = source('packages/fields/src/index.tsx');
const REACT_BINDINGS = source('packages/react/src/index.ts');

/** The main area with the AI panel docked in a 1167 px window (the card's case). */
const AI_PANEL_MAIN = 699;
/** The list page's table width at a 1440 px window (see the header). */
const FULL_PAGE = 1184;

/** The card's opportunity list, name first and the close date last. */
const COLUMNS = ['name', 'account', 'stage', 'amount', 'probability', 'expected_revenue', 'close_date'];
/** Few enough to fit the narrow frame: nothing overflows, nothing moves. */
const FEW_COLUMNS = ['name', 'stage', 'amount'];

interface Case {
  name: string;
  viewport: number;
  frame: number;
  columns: string[];
  /** Give each row one inline primary action beside the "⋮". */
  inlinePrimary?: boolean;
}

const ENTRY = '\0list-narrow-pinned-columns:entry';

/** `@object-ui/<pkg>` to `packages/<pkg>/src`, and a subpath into that `src/`. */
function workspaceSources(): Plugin {
  return {
    name: 'list-narrow-pinned-columns-workspace-src',
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
import { ObjectGrid } from ${JSON.stringify(PLUGIN_GRID)};
import { registerAllFields } from ${JSON.stringify(FIELDS)};
import { ActionProvider, SchemaRendererProvider } from ${JSON.stringify(REACT_BINDINGS)};

registerAllFields();
const h = React.createElement;
const c = window.__case;
window.__dispatched = [];
const FIELDS = {
  id: { name: 'id', type: 'text' },
  name: { name: 'name', label: 'Opportunity name', type: 'text' },
  account: { name: 'account', label: 'Account', type: 'text' },
  stage: { name: 'stage', label: 'Stage', type: 'text' },
  amount: { name: 'amount', label: 'Amount', type: 'currency' },
  probability: { name: 'probability', label: 'Probability', type: 'percent' },
  expected_revenue: { name: 'expected_revenue', label: 'Expected revenue', type: 'currency' },
  close_date: { name: 'close_date', label: 'Expected close date', type: 'date' },
};
const ROWS = [
  ['Vertex Enterprise Rollout', 'Vertex Analytics', 'Negotiation', 94000, 80],
  ['Wayne Enterprise License', 'Wayne Enterprises', 'Negotiation', 1200000, 80],
  ['Lattice Education Renewal', 'Lattice Education', 'Proposal', 87000, 60],
].map(([name, account, stage, amount, probability], i) => ({
  id: 'o' + (i + 1), name, account, stage, amount, probability,
  expected_revenue: amount * probability / 100, close_date: '2026-12-0' + (i + 1),
}));
const dataSource = {
  find: async () => ({ data: ROWS, total: ROWS.length }),
  getObjectSchema: async (name) => ({ name, fields: FIELDS }),
};
const rowActionDefs = [
  ...(c.inlinePrimary ? [{ name: 'advance', label: 'Advance', variant: 'primary' }] : []),
  { name: 'archive', label: 'Archive' },
];
createRoot(document.getElementById('root')).render(
  h(ActionProvider, { handlers: Object.fromEntries(rowActionDefs.map((d) => [d.name, async () => { window.__dispatched.push(d.name); return { success: true }; }])) },
    h(SchemaRendererProvider, { dataSource },
      h('div', { id: 'frame', className: 'flex flex-col bg-background', style: { width: c.frame + 'px', height: '520px' } },
        h(ObjectGrid, {
          dataSource,
          schema: {
            type: 'object-grid',
            objectName: 'opportunity',
            columns: c.columns.map((field) => ({ field, label: FIELDS[field].label })),
            rowActionDefs,
          },
        })))),
);
`;
  return {
    name: 'list-narrow-pinned-columns-entry',
    resolveId: (id) => (id === 'list-narrow-pinned-columns:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

/** Bundle the page once, from source, to one ES module held in memory. */
async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-list-narrow-pinned-columns'),
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
        input: 'list-narrow-pinned-columns:entry',
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
async function mount(page: Page, c: Case): Promise<void> {
  await page.setViewportSize({ width: c.viewport, height: 900 });
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div id="root"></div></body></html>');
  await page.evaluate((value) => {
    (window as unknown as { __case: Case }).__case = value;
  }, c);
  await page.addScriptTag({ content: bundle, type: 'module' });
  await page.locator('th[data-column-key="_actions"]').first().waitFor({ state: 'attached', timeout: 30_000 });
  const compiled = new Set<string>();
  await styleUntilStable(page, compiled);
  await page.evaluate(() => document.fonts?.ready);
  // The table sizes its columns over several passes and the fold and the move
  // are read once its size holds: wait for a geometry that holds across 500 ms.
  let last = '';
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => {
      const box = document.querySelector<HTMLElement>('[data-table-scroll-box]');
      const host = document.querySelector('[data-row-actions-inline]');
      const state = `${host?.getAttribute('data-row-actions-inline') ?? ''}:${host?.getAttribute('data-row-actions-column') ?? ''}`;
      return box ? `${box.clientWidth}:${box.scrollWidth}:${state}` : `none:${state}`;
    });
    if (now === last) break;
    last = now;
    await page.waitForTimeout(500);
  }
  await styleUntilStable(page, compiled);
}

interface Reading {
  box: { clientWidth: number; scrollWidth: number; scrollbarHeight: number; scrollbarColor: string };
  /** The edge the "⋮" column sticks to, and its box inside the scroll box. */
  actions: { stick: 'left' | 'right' | 'none'; left: number; width: number };
  inlineButtons: number;
  /** The header keys in drawn order. */
  order: string[];
  /** The frozen (left-sticky) header keys. */
  frozen: string[];
  /**
   * The largest overlap, in px, of a fixed cell's box with a data cell's box
   * in the same row (header row and first body row), and the pair.
   */
  overlap: { px: number; fixed: string | null; data: string | null };
  /** Data cells of the first body row whose centre lies in view but answers something else. */
  covered: string[];
}

/** The table at rest: nothing scrolled. */
async function readAtRest(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
    box.scrollLeft = 0;
    const boxRect = box.getBoundingClientRect();
    const view = { left: boxRect.left + box.clientLeft, right: boxRect.left + box.clientLeft + box.clientWidth };
    const headRow = box.querySelector('thead tr')!;
    const bodyRow = box.querySelector('tbody tr')!;
    const keyAt = (i: number) => (headRow.children[i] as HTMLElement).getAttribute('data-column-key') ?? `#${i}`;
    const sticky = (el: Element) => getComputedStyle(el).position === 'sticky';
    let worst = { px: 0, fixed: null as string | null, data: null as string | null };
    for (const row of [headRow, bodyRow]) {
      const cells = [...row.children] as HTMLElement[];
      cells.forEach((fixed, i) => {
        if (!sticky(fixed)) return;
        const f = fixed.getBoundingClientRect();
        cells.forEach((data, j) => {
          if (sticky(data) || !headRow.children[j]?.getAttribute('data-column-key')) return;
          const d = data.getBoundingClientRect();
          const px = Math.max(0, Math.min(f.right, d.right) - Math.max(f.left, d.left));
          if (px > worst.px) worst = { px: Math.round(px * 10) / 10, fixed: keyAt(i), data: keyAt(j) };
        });
      });
    }
    const covered: string[] = [];
    ([...bodyRow.children] as HTMLElement[]).forEach((cell, j) => {
      const key = headRow.children[j]?.getAttribute('data-column-key');
      if (!key || key === '_actions' || sticky(cell)) return;
      const r = cell.getBoundingClientRect();
      const x = r.left + r.width / 2;
      if (x <= view.left || x >= view.right) return;
      const at = document.elementFromPoint(x, r.top + r.height / 2);
      if (!at || !(at === cell || cell.contains(at))) covered.push(key);
    });
    const actionsHead = box.querySelector<HTMLElement>('th[data-column-key="_actions"]')!;
    const ar = actionsHead.getBoundingClientRect();
    const cs = getComputedStyle(actionsHead);
    const stick = cs.position !== 'sticky' ? 'none' : cs.right === '0px' && cs.left === 'auto' ? 'right' : 'left';
    const heads = [...headRow.children] as HTMLElement[];
    return {
      box: {
        clientWidth: box.clientWidth,
        scrollWidth: box.scrollWidth,
        scrollbarHeight: box.offsetHeight - box.clientHeight - box.clientTop * 2,
        scrollbarColor: getComputedStyle(box).scrollbarColor,
      },
      actions: { stick, left: Math.round(ar.left - boxRect.left), width: Math.round(ar.width) },
      inlineButtons: box.querySelectorAll('[data-testid^="row-action-inline-"]').length,
      order: heads.map((h) => h.getAttribute('data-column-key')).filter((k): k is string => !!k),
      frozen: heads
        .filter((h) => h.getAttribute('data-column-key') && sticky(h) && getComputedStyle(h).left !== 'auto')
        .map((h) => h.getAttribute('data-column-key')!),
      overlap: worst,
      covered,
    };
  });
}

/** Scrolled to the far right: does the last column's header answer at its centre? */
async function lastColumnReachable(page: Page, key: string): Promise<boolean> {
  return page.evaluate(async (k) => {
    const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
    box.scrollLeft = box.scrollWidth;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const head = box.querySelector<HTMLElement>(`th[data-column-key="${k}"]`)!;
    const r = head.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const hit = !!at && (at === head || head.contains(at));
    box.scrollLeft = 0;
    return hit;
  }, key);
}

function report(testInfo: import('@playwright/test').TestInfo, c: Case, r: Reading): void {
  testInfo.annotations.push({ type: `list-narrow-pinned-columns@${c.name}`, description: JSON.stringify(r) });
  process.stdout.write(`[list-narrow-pinned-columns ${c.name}] ${JSON.stringify(r)}\n`);
}

/** Open the first row's "⋮" menu with the pointer and run Archive from it. */
async function archiveFromMenu(page: Page): Promise<void> {
  await page.getByTestId('row-action-trigger').first().click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __dispatched: unknown[] }).__dispatched.length))
    .toBe(1);
}

test.describe('app list in a narrowed main area — no fixed column covers a data cell (objectstack#35446)', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    bundle = await bundlePage();
  });

  for (const inlinePrimary of [false, true]) {
    test(`AI panel docked (${AI_PANEL_MAIN} px main area${inlinePrimary ? ', inline primary action' : ''}): the "⋮" joins the frozen zone and the rest scrolls`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const c: Case = { name: `aiPanel${inlinePrimary ? 'Inline' : ''}`, viewport: 1167, frame: AI_PANEL_MAIN, columns: COLUMNS, inlinePrimary };
      await mount(page, c);
      const r = await readAtRest(page);
      report(testInfo, c, r);
      expect(r.box.scrollWidth, 'the fixture no longer overflows the narrow frame').toBeGreaterThan(r.box.clientWidth + 1);
      expect(r.overlap.px, `the fixed column ${r.overlap.fixed} covers ${r.overlap.data} by ${r.overlap.px} px at rest`).toBeLessThanOrEqual(0.5);
      expect(r.covered, 'data cells in view answer another element at their centre').toEqual([]);
      expect(r.actions.stick, 'the "⋮" column is not in the frozen zone').toBe('left');
      expect(r.frozen).toEqual(['name', '_actions']);
      expect(r.inlineButtons, 'inline buttons are drawn although the table overflows').toBe(0);
      expect(r.box.scrollbarHeight, 'the horizontal scrollbar takes no room').toBeGreaterThan(0);
      expect(r.box.scrollbarColor, 'the scrollbar is transparent at rest').not.toMatch(/^transparent/);
      expect(await lastColumnReachable(page, 'close_date'), 'the last column cannot be reached by scrolling').toBe(true);
      await archiveFromMenu(page);
    });
  }

  test('CONTROL: on the full list page nothing moves and nothing is covered', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const c: Case = { name: 'fullPage1440', viewport: 1440, frame: FULL_PAGE, columns: COLUMNS };
    await mount(page, c);
    const r = await readAtRest(page);
    report(testInfo, c, r);
    expect(r.box.scrollWidth - r.box.clientWidth, 'the fixture overflows the full page').toBeLessThanOrEqual(1);
    expect(r.actions.stick).toBe('right');
    expect(r.order[r.order.length - 1]).toBe('_actions');
    expect(r.frozen).toEqual(['name']);
    expect(r.overlap.px).toBeLessThanOrEqual(0.5);
    expect(r.covered).toEqual([]);
    await archiveFromMenu(page);
  });

  test('CONTROL: a narrow list whose columns fit keeps the "⋮" at the right edge', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const c: Case = { name: 'aiPanelFew', viewport: 1167, frame: AI_PANEL_MAIN, columns: FEW_COLUMNS };
    await mount(page, c);
    const r = await readAtRest(page);
    report(testInfo, c, r);
    expect(r.box.scrollWidth - r.box.clientWidth).toBeLessThanOrEqual(1);
    expect(r.actions.stick).toBe('right');
    expect(r.frozen).toEqual(['name']);
    expect(r.overlap.px).toBeLessThanOrEqual(0.5);
  });
});
