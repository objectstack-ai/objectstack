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
 * GEOMETRY pin for objectstack#33230: a related list enlarged inside a record
 * drawer, whose rows offer one inline primary action, shows its last data
 * column (Status) at rest instead of hiding it under the right-pinned Actions
 * column, and the action stays one click away in the row's "⋮" menu.
 *
 * ## The defect
 *
 * The grid pins its Actions column to the scroll box's right edge. With an
 * inline primary button beside the "⋮" trigger the column is about twice the
 * menu-only width, and in the drawer that extra width alone made a table whose
 * data columns fit overflow its box: the pinned column then sat over Status at
 * rest (`elementFromPoint` at the Status cell's centre answered the inline
 * button), and only a sideways scroll showed it. The grid now draws inline
 * buttons only while the table fits its box with them, and folds them into
 * the row menu otherwise (`useInlineRowActionFold` in plugin-grid).
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * jsdom and happy-dom have no layout engine: no widths, no sticky offsets, no
 * `elementFromPoint`, and the fold is decided from the widths the table
 * draws. The bundling follows `e2e/permission-field-panel-scroll.spec.ts`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: `RelatedList` from plugin-detail, drawn as its enlarged face
 * (`RelatedListEnlargedContext`), which renders plugin-grid's `object-grid`,
 * the `data-table` and `RowActionMenu`, all bundled by Vite from their source
 * files and mounted in Chromium with React's client renderer. The stylesheet
 * is real Tailwind: `packages/components/src/index.css` (its `@theme`
 * included), compiled for exactly the classes the mounted page carries. The
 * menu is opened and the action dispatched with real pointer clicks.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - The rows, the object's fields and the two row actions are literals, and
 *     the data source answers them; the dispatched action is recorded on the
 *     page, not run.
 *   - The width is set by a frame around the list, not by a drawer: 622 px is
 *     the content width the record drawer's default 720 px pane gives its page
 *     (read in the running Console at 1440, 1280 and 1024 px windows: the pane
 *     is `min(92vw, 720px)` at all three), and 1184 px is the list page's
 *     table width at a 1440 px window with the sidebar open.
 *   - Fonts are Chromium's fallbacks. The assertions are hits, overflow and
 *     which control is drawn, not pixels; the readings go to the report.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const THEME_CSS = source('packages/components/src/index.css');
const RELATED_LIST = source('packages/plugin-detail/src/RelatedList.tsx');
const ENLARGED_CONTEXT = source('packages/plugin-detail/src/relatedListCompact.ts');
// The entry names workspace sources by path, never by package name: the e2e
// type-check program must import no workspace package (it builds nothing first).
const PLUGIN_GRID = source('packages/plugin-grid/src/index.tsx');
const FIELDS = source('packages/fields/src/index.tsx');
const REACT_BINDINGS = source('packages/react/src/index.ts');

/** The record drawer's page width (see the header). */
const DRAWER_PAGE = 622;
/** The list page's table width at a 1440 px window (see the header). */
const FULL_PAGE = 1184;

/**
 * The allocation-plan columns the card names, Status last. Their widths fit
 * the drawer menu-only and do not fit it with the inline button: the readings
 * each case reports say by how much, so a font that moves them is visible.
 */
const PLAN_COLUMNS = ['name', 'plan_date', 'amount', 'warehouse', 'status'];
/** Wide enough to overflow the drawer even menu-only. */
const WIDE_COLUMNS = ['name', 'plan_date', 'quantity', 'amount', 'warehouse', 'owner', 'note', 'status'];

interface Case {
  name: string;
  /** The window, which decides desktop table or phone cards. */
  viewport: number;
  /** The list's width. */
  frame: number;
  columns: string[];
}

const ENTRY = '\0related-list-pinned-actions:entry';

/** `@object-ui/<pkg>` to `packages/<pkg>/src`, and a subpath into that `src/`. */
function workspaceSources(): Plugin {
  return {
    name: 'related-list-pinned-actions-workspace-src',
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
import ${JSON.stringify(PLUGIN_GRID)};
import { registerAllFields } from ${JSON.stringify(FIELDS)};
import { ActionProvider, SchemaRendererProvider } from ${JSON.stringify(REACT_BINDINGS)};
import { RelatedList } from ${JSON.stringify(RELATED_LIST)};
import { RelatedListEnlargedContext } from ${JSON.stringify(ENLARGED_CONTEXT)};

registerAllFields();
const h = React.createElement;
const c = window.__case;
window.__dispatched = [];
const FIELDS = {
  id: { name: 'id', type: 'text' },
  name: { name: 'name', label: 'Name', type: 'text' },
  plan_date: { name: 'plan_date', label: 'Plan date', type: 'date' },
  quantity: { name: 'quantity', label: 'Quantity', type: 'number' },
  amount: { name: 'amount', label: 'Amount', type: 'currency' },
  warehouse: { name: 'warehouse', label: 'Warehouse', type: 'text' },
  owner: { name: 'owner', label: 'Owner', type: 'text' },
  note: { name: 'note', label: 'Note', type: 'text' },
  status: { name: 'status', label: 'Status', type: 'text' },
};
const ROWS = [1, 2, 3].map((i) => ({
  id: 'p' + i, name: 'Allocation ' + i, plan_date: '2026-11-0' + i, quantity: 10 * i, amount: 1250.5 * i,
  warehouse: 'Main warehouse east', owner: 'Dana Smith', note: 'Ship with the next batch',
  status: i === 1 ? 'confirmed' : 'draft',
}));
const dataSource = {
  find: async () => ({ data: ROWS, total: ROWS.length }),
  getObjectSchema: async (name) => ({ name, fields: FIELDS }),
};
createRoot(document.getElementById('root')).render(
  h(ActionProvider, null,
    h(SchemaRendererProvider, { dataSource },
      h('div', { id: 'frame', className: 'bg-background', style: { width: c.frame + 'px' } },
        h(RelatedListEnlargedContext.Provider, { value: true },
          h(RelatedList, {
            title: 'Allocation plans',
            type: 'table',
            api: 'allocation_plan',
            objectName: 'allocation_plan',
            data: ROWS,
            columns: c.columns.map((field) => ({ field, label: FIELDS[field].label })),
            rowActions: [
              { name: 'allocate', label: 'Allocate', variant: 'primary', locations: ['record_related'] },
              { name: 'archive', label: 'Archive', locations: ['record_related'] },
            ],
            onRowAction: (action, row) => { window.__dispatched.push([action.name, row.id]); },
          }))))),
);
`;
  return {
    name: 'related-list-pinned-actions-entry',
    resolveId: (id) => (id === 'related-list-pinned-actions:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

/** Bundle the page once, from source, to one ES module held in memory. */
async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-related-list-pinned-actions'),
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
        input: 'related-list-pinned-actions:entry',
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
async function mount(page: Page, c: Case, ready: string): Promise<void> {
  await page.setViewportSize({ width: c.viewport, height: 900 });
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div id="root"></div></body></html>');
  await page.evaluate((value) => {
    (window as unknown as { __case: Case }).__case = value;
  }, c);
  await page.addScriptTag({ content: bundle, type: 'module' });
  await page.locator(ready).first().waitFor({ state: 'attached', timeout: 30_000 });
  const compiled = new Set<string>();
  await styleUntilStable(page, compiled);
  await page.evaluate(() => document.fonts?.ready);
  // The table sizes its columns over several passes and the fold is read once
  // its size holds: wait for a geometry that holds across 500 ms.
  let last = '';
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => {
      const box = document.querySelector<HTMLElement>('[data-table-scroll-box]');
      const fold = document.querySelector('[data-row-actions-inline]')?.getAttribute('data-row-actions-inline') ?? '';
      return box ? `${box.clientWidth}:${box.scrollWidth}:${fold}` : `cards:${fold}`;
    });
    if (now === last) break;
    last = now;
    await page.waitForTimeout(500);
  }
  await styleUntilStable(page, compiled);
}

interface Reading {
  box: { clientWidth: number; scrollWidth: number };
  folded: boolean;
  inlineButtons: number;
  /** The Actions column's left edge and width, inside the box. */
  actions: { left: number; width: number };
  /** The Status header and body cell answer `elementFromPoint` at their centres. */
  statusHeaderHit: boolean;
  statusCellHit: boolean;
  /** What answered at the Status cell's centre, when not the cell. */
  statusHitBy: string | null;
  /** The Status cell's right edge, inside the box. */
  statusRight: number;
}

/** The table at rest: nothing scrolled. */
async function readAtRest(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
    box.scrollLeft = 0;
    const boxLeft = box.getBoundingClientRect().left;
    const describe = (el: Element | null) =>
      el ? `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : ''}` : null;
    const centreHit = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { ok: !!at && (at === el || el.contains(at)), at };
    };
    const statusHead = box.querySelector<HTMLElement>('th[data-column-key="status"]')!;
    const statusIndex = [...statusHead.parentElement!.children].indexOf(statusHead);
    const statusCell = box.querySelector('tbody tr')!.children[statusIndex] as HTMLElement;
    const actionsHead = box.querySelector<HTMLElement>('th[data-column-key="_actions"]')!;
    const ar = actionsHead.getBoundingClientRect();
    const head = centreHit(statusHead);
    const cell = centreHit(statusCell);
    return {
      box: { clientWidth: box.clientWidth, scrollWidth: box.scrollWidth },
      folded: !!document.querySelector('[data-row-actions-inline="folded"]'),
      inlineButtons: box.querySelectorAll('[data-testid^="row-action-inline-"]').length,
      actions: { left: Math.round(ar.left - boxLeft), width: Math.round(ar.width) },
      statusHeaderHit: head.ok,
      statusCellHit: cell.ok,
      statusHitBy: cell.ok ? null : describe(cell.at),
      statusRight: Math.round(statusCell.getBoundingClientRect().right - boxLeft),
    };
  });
}

function report(testInfo: import('@playwright/test').TestInfo, c: Case, r: Reading): void {
  testInfo.annotations.push({ type: `related-list-pinned-actions@${c.name}`, description: JSON.stringify(r) });
  process.stdout.write(`[related-list-pinned-actions ${c.name}] ${JSON.stringify(r)}\n`);
}

/** Open the first row's "⋮" menu with the pointer and dispatch Allocate from it. */
async function allocateFromMenu(page: Page): Promise<void> {
  await page.getByTestId('row-action-trigger').first().click();
  await page.getByRole('menuitem', { name: 'Allocate' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __dispatched: unknown[] }).__dispatched))
    .toEqual([['allocate', 'p1']]);
}

test.describe('enlarged related list in a record drawer — the pinned Actions column leaves Status in view (objectstack#33230)', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    bundle = await bundlePage();
  });

  for (const viewport of [1440, 1280, 1024]) {
    test(`drawer at a ${viewport} px window: Status shows at rest and Allocate is in the row menu`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const c: Case = { name: `drawer${viewport}`, viewport, frame: DRAWER_PAGE, columns: PLAN_COLUMNS };
      await mount(page, c, 'th[data-column-key="status"]');
      const r = await readAtRest(page);
      report(testInfo, c, r);
      expect(r.statusRight, 'the pinned Actions column covers part of Status at rest').toBeLessThanOrEqual(r.actions.left);
      expect(r.statusCellHit, `the Status cell is covered at rest by ${r.statusHitBy}`).toBe(true);
      expect(r.statusHeaderHit, 'the Status header is covered at rest').toBe(true);
      expect(r.box.scrollWidth - r.box.clientWidth, 'the table still overflows the drawer').toBeLessThanOrEqual(1);
      expect(r.folded, 'the inline button was not folded although the table overflows with it').toBe(true);
      expect(r.inlineButtons).toBe(0);
      await allocateFromMenu(page);
    });
  }

  test('CONTROL: on the full list page the inline button stays and covers nothing', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const c: Case = { name: 'fullPage1440', viewport: 1440, frame: FULL_PAGE, columns: PLAN_COLUMNS };
    await mount(page, c, 'th[data-column-key="status"]');
    const r = await readAtRest(page);
    report(testInfo, c, r);
    expect(r.folded).toBe(false);
    expect(r.inlineButtons).toBe(3);
    expect(r.box.scrollWidth - r.box.clientWidth).toBeLessThanOrEqual(1);
    expect(r.statusCellHit, `the Status cell is covered at rest by ${r.statusHitBy}`).toBe(true);
    await page.getByTestId('row-action-inline-allocate').first().click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __dispatched: unknown[] }).__dispatched))
      .toEqual([['allocate', 'p1']]);
  });

  test('CONTROL: under 390 px the list draws cards, with Allocate in the card menu', async ({ page }) => {
    test.setTimeout(120_000);
    const c: Case = { name: 'phone390', viewport: 390, frame: 390, columns: PLAN_COLUMNS };
    await mount(page, c, '[data-testid="row-action-trigger"]');
    expect(await page.locator('[data-table-scroll-box]').count()).toBe(0);
    expect(await page.locator('[data-row-actions-inline]').count()).toBe(0);
    await allocateFromMenu(page);
  });

  test('a table that overflows the drawer even menu-only folds too, and Status is reached by scrolling', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const c: Case = { name: 'drawerWide1440', viewport: 1440, frame: DRAWER_PAGE, columns: WIDE_COLUMNS };
    await mount(page, c, 'th[data-column-key="status"]');
    const r = await readAtRest(page);
    report(testInfo, c, r);
    expect(r.folded).toBe(true);
    expect(r.inlineButtons).toBe(0);
    // Still wider than the drawer: the Actions column leaves the right edge
    // for the frozen zone beside the name column (objectstack#35446), and a
    // scroll to the end shows Status whole.
    expect(r.box.scrollWidth).toBeGreaterThan(r.box.clientWidth);
    expect(r.actions.left, 'the Actions column still sits at the right edge').toBeLessThan(r.box.clientWidth / 2);
    const end = await page.evaluate(async () => {
      const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
      box.scrollLeft = box.scrollWidth;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const head = box.querySelector<HTMLElement>('th[data-column-key="status"]')!;
      const hr = head.getBoundingClientRect();
      const at = document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
      const hit = !!at && (at === head || head.contains(at));
      box.scrollLeft = 0;
      return hit;
    });
    expect(end, 'Status cannot be reached by scrolling to the end').toBe(true);
    await allocateFromMenu(page);
  });
});
