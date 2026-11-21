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
 * GEOMETRY and INTERACTION pin for the list's condition row (objectstack#35549
 * filter, objectstack#35550 sort), on the REAL list: `ListView` with its
 * toolbar, the `list-condition-row` slot objectstack#35548 laid under the view
 * bar, and the grid. Since objectstack#35878 the slot is resident: the one
 * sort chip (the dashed 「Sort」 with nothing set), then the reader's filter
 * chips and 「+」 (the dashed 「Filter」 with none), and 「Reset」; it keeps its
 * 40 px whether or not a condition is set, so the table does not move.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * "Keeps its height", "one row of 24 px chips" and "chips on one line" are
 * layout facts; happy-dom lays nothing out. The vitest pins (`plugin-list/src/conditions/__tests__/
 * listConditions.test.tsx`, `ListView.conditionRow-35549.test.tsx`) hold the
 * logic; this spec holds it in Chromium. The bundling follows
 * `e2e/list-header-narrow-35446.spec.ts`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: `ListView` and `ObjectGrid` from source (plugin-list, plugin-grid),
 * the condition controls, the Radix popovers, bundled by Vite and mounted with
 * React's client renderer under `SchemaRendererProvider`; the stylesheet is
 * real Tailwind, compiled for the classes on the page. Every step is a real
 * pointer click.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - The data source is in memory: one object definition and twelve records.
 *     It records every `find` it is asked, and answers the stage filter
 *     (`in`) and the sort the list sends, so the footer row's count and the row order
 *     move as they do against a server.
 *   - The translator is the English defaults table (no provider).
 *   - Animations are off, so a closed popover leaves the page at once rather
 *     than after its exit animation.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const THEME_CSS = source('packages/components/src/index.css');
const LIST = source('packages/plugin-list/src/index.tsx');
const GRID = source('packages/plugin-grid/src/index.tsx');
const REACT = source('packages/react/src/index.ts');

const ENTRY = '\0list-condition-row:entry';

function workspaceSources(): Plugin {
  return {
    name: 'list-condition-row-workspace-src',
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

function entry(): Plugin {
  const code = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SchemaRendererProvider } from ${JSON.stringify(REACT)};
import ${JSON.stringify(GRID)};
import { ListView } from ${JSON.stringify(LIST)};

const h = React.createElement;
const STAGES = [
  { value: 'prospecting', label: 'Prospecting', color: 'blue' },
  { value: 'proposal', label: 'Proposal', color: 'amber' },
  { value: 'negotiation', label: 'Negotiation', color: 'green' },
  { value: 'closed_won', label: 'Closed won', color: 'gray' },
];
const DEFINITION = {
  name: 'deal',
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'select', label: 'Stage', options: STAGES },
    amount: { type: 'number', label: 'Amount' },
    close_date: { type: 'date', label: 'Close date' },
  },
};
const ROWS = Array.from({ length: 12 }, (_, i) => ({
  id: 'r' + i,
  name: 'Deal ' + i,
  stage: STAGES[i % 4].value,
  amount: (i * 7919) % 50000,
  close_date: '2026-0' + ((i % 9) + 1) + '-15',
}));

// The stage values the filter names ('in', or '=' per value, ORed for two),
// wherever the AST nests them; null when it names none.
function stageIn(node, found = []) {
  if (!Array.isArray(node)) return found.length ? found : null;
  if (node[0] === 'stage' && node[1] === 'in' && Array.isArray(node[2])) found.push(...node[2]);
  else if (node[0] === 'stage' && node[1] === '=') found.push(node[2]);
  else for (const child of node) stageIn(child, found);
  return found.length ? found : null;
}

window.__finds = [];
const dataSource = {
  async find(_object, params) {
    window.__finds.push(JSON.parse(JSON.stringify(params ?? {})));
    const stages = stageIn(params?.$filter);
    let rows = stages ? ROWS.filter((r) => stages.includes(r.stage)) : [...ROWS];
    const order = params?.$orderby ?? params?.sort;
    const levels = Array.isArray(order) ? order : order && typeof order === 'object' ? Object.entries(order).map(([field, dir]) => ({ field, order: dir })) : [];
    rows.sort((a, b) => {
      for (const l of levels) {
        const d = a[l.field] < b[l.field] ? -1 : a[l.field] > b[l.field] ? 1 : 0;
        if (d) return l.order === 'desc' ? -d : d;
      }
      return 0;
    });
    return { data: rows, total: rows.length };
  },
  async findOne() { return null; },
  async create(_o, d) { return d; },
  async update(_o, _id, d) { return d; },
  async delete() { return true; },
  async getObjectSchema() { return JSON.parse(JSON.stringify(DEFINITION)); },
};

const schema = {
  type: 'list-view',
  objectName: 'deal',
  viewType: 'grid',
  columns: [{ field: 'name' }, { field: 'stage' }, { field: 'amount' }],
};

function Harness() {
  const [sort, setSort] = React.useState([]);
  window.__sort = sort;
  return h('div', { className: 'h-[700px] w-[1280px] bg-background text-foreground' },
    h(SchemaRendererProvider, { dataSource },
      h(ListView, { schema, dataSource, onSortChange: setSort })));
}

createRoot(document.getElementById('root')).render(h(Harness));
`;
  return {
    name: 'list-condition-row-entry',
    resolveId: (id) => (id === 'list-condition-row:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    cacheDir: path.join(os.tmpdir(), 'objectui-list-condition-row-real'),
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
        input: 'list-condition-row:entry',
        output: { format: 'es', codeSplitting: false },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunks = outputs.flatMap((o) => o.output).filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`expected one bundled chunk, got ${chunks.length}`);
  return chunks[0].code;
}

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
// Seeded with the popover's stacking class: Radix copies the content's
// computed z-index onto its positioned wrapper when it mounts, so the rule
// has to be on the page before the first popover opens, or the grid's sticky
// header (z-10) paints over it.
const compiled = new Set<string>(['z-50']);

/** Compile the stylesheet for every class now on the page (popovers included). */
async function style(page: Page): Promise<void> {
  for (let round = 0; ; round++) {
    const candidates: string[] = await page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('[class]')].flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)).filter(Boolean),
      ),
    ]);
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

async function mount(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Served from a localhost URL rather than `setContent`'s about:blank, which
  // is not a secure context: the list mints ids with `crypto.randomUUID`, which
  // only a secure context has (the Console is served over https or localhost).
  // No animations: a closing popover then unmounts at once, as it does once its exit animation ends.
  await page.route('http://localhost/list-condition-row', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><style>html,body{margin:0} *,*::before,*::after{animation:none!important;transition:none!important}</style></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/list-condition-row');
  await page.addScriptTag({ content: bundle, type: 'module' });
  await page.getByTestId('condition-add-filter').waitFor({ state: 'attached', timeout: 30_000 });
  await page.getByTestId('data-table-summary-lead').waitFor({ state: 'attached', timeout: 30_000 });
  await style(page);
}

/** Click, then style whatever the click opened. */
async function click(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).click();
  await style(page);
}

const slot = (page: Page) => page.getByTestId('list-condition-row');
/** The resident row's height (`min-h-10`, objectstack#35878). */
const ROW_HEIGHT = 40;
const slotHeight = (page: Page) => slot(page).evaluate((el) => el.getBoundingClientRect().height);
/** The number the grid's footer row leads with (objectstack#35702), once the list has answered. */
const count = async (page: Page) => (await page.getByTestId('data-table-summary-lead').textContent())?.match(/\d+/)?.[0];
const sortNow = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sort: Array<{ field: string; order: string }> }).__sort.map((s) => `${s.field}:${s.order}`));

test.describe('list condition row under the view bar (objectstack#35549, objectstack#35550)', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    bundle = await bundlePage();
  });

  // objectstack#35878: the row is resident. With nothing set it holds the
  // dashed 「Sort」 and 「Filter」 and keeps its height, so the table never
  // moves when the first condition is set or after Reset.
  test('CONTROL: with no sort and no filter the row is drawn with dashed Sort and Filter, 40 px tall', async ({ page }) => {
    test.setTimeout(120_000);
    await mount(page);
    await expect.poll(() => count(page)).toBe('12');
    expect(Math.round(await slotHeight(page))).toBe(ROW_HEIGHT);
    await expect(page.getByTestId('condition-sort')).toHaveAttribute('data-levels', '0');
    await expect(page.getByTestId('condition-sort')).toHaveText('Sort');
    await expect(page.getByTestId('condition-add-filter')).toHaveAttribute('data-empty', 'true');
    await expect(page.getByTestId('condition-add-filter')).toHaveText('Filter');
  });

  test('filter: Filter → Stage → Negotiation is three clicks; the chip names field and value, reopens on click, × removes', async ({ page }) => {
    test.setTimeout(120_000);
    await mount(page);
    await expect.poll(() => count(page)).toBe('12');
    await click(page, 'condition-add-filter');
    await click(page, 'filter-panel-fields-item-stage');
    await page.getByTestId('filter-panel-values-option-negotiation').getByRole('checkbox').click();
    await style(page);
    // applied on the pick: no Apply button, the list asks again at once
    await expect.poll(() => count(page)).toBe('3');
    const chip = page.getByTestId('filter-chip-stage');
    await expect(chip).toHaveText(/Stage: Negotiation/);
    // the row is one line of 24 px chips at its resident height (min-h-10)
    expect(Math.round(await slotHeight(page))).toBe(ROW_HEIGHT);
    const chipBox = await chip.boundingBox();
    expect(Math.round(chipBox!.height)).toBe(24);
    await page.keyboard.press('Escape');
    // a click on the chip reopens that condition's values, already ticked
    await click(page, 'filter-chip-open-stage');
    await expect(page.locator('[data-testid$="-values-option-negotiation"][data-checked="true"]')).toBeVisible();
    await page.locator('[data-testid$="-values-option-proposal"]').getByRole('checkbox').click();
    await expect(chip).toHaveText(/Stage: Negotiation, Proposal/);
    await expect.poll(() => count(page)).toBe('6');
    await page.keyboard.press('Escape');
    await click(page, 'filter-chip-remove-stage');
    await expect.poll(() => count(page)).toBe('12');
    // the row stays, back to its dashed 「Filter」, at the same height
    expect(Math.round(await slotHeight(page))).toBe(ROW_HEIGHT);
    await expect(page.getByTestId('condition-add-filter')).toHaveAttribute('data-empty', 'true');
  });

  // objectstack#35878: a sort of any number of levels is ONE chip, 「Sorted by
  // X」 with 「+N」, before the filter chips. With no sort the dashed 「Sort」
  // opens the sort panel; with one, the chip opens every level in one panel
  // (objectstack#35876), where a level is added and a handle reorders.
  test('sort: Sort → Descending → Amount is three clicks; one chip with +N comes before the filter chips; its panel adds a level and a handle reorders; a header menu pick shows on it; Reset restores', async ({ page }) => {
    test.setTimeout(120_000);
    await mount(page);
    await expect.poll(() => count(page)).toBe('12');
    await click(page, 'condition-sort');
    await click(page, 'sort-panel-order-desc');
    await click(page, 'sort-panel-fields-item-amount');
    expect(await sortNow(page)).toEqual(['amount:desc']);
    const sortChip = page.getByTestId('condition-sort');
    await expect(sortChip).toHaveAttribute('data-levels', '1');
    await expect(sortChip).toHaveText('Sorted by Amount');
    // a second level, from the chip's panel of every level: still one chip, now carrying +1
    await click(page, 'condition-sort');
    const panel = page.getByTestId('sort-chip-panel');
    await panel.getByRole('button', { name: 'Add sort' }).click();
    await expect.poll(async () => (await sortNow(page)).length).toBe(2);
    const levels = await sortNow(page);
    expect(levels[0]).toBe('amount:desc');
    await expect(sortChip).toHaveAttribute('data-levels', '2');
    await expect(page.getByTestId('sort-chip-more')).toHaveText('+1');
    // a real drag of the second level's handle onto the first row puts it first
    await expect(panel.getByTestId('sort-builder-handle')).toHaveCount(2);
    await panel.getByTestId('sort-builder-handle').nth(1).dragTo(panel.getByTestId('sort-builder-row').first());
    await expect.poll(() => sortNow(page)).toEqual([levels[1], levels[0]]);
    await page.keyboard.press('Escape');
    // a filter chip joins after the sort chip
    await click(page, 'condition-add-filter');
    await click(page, 'filter-panel-fields-item-stage');
    await page.getByTestId('filter-panel-values-option-proposal').getByRole('checkbox').click();
    await page.keyboard.press('Escape');
    await style(page);
    const order = await page.getByTestId('condition-chips').evaluate((row) =>
      [...row.querySelectorAll('[data-testid="condition-sort"], [data-testid^="filter-chip-"]:not([data-testid*="-open-"]):not([data-testid*="-remove-"])')]
        .map((el) => el.getAttribute('data-testid')),
    );
    expect(order).toEqual(['condition-sort', 'filter-chip-stage']);
    // all chips on one line, Reset at the right end of the slot
    const tops = await page.getByTestId('condition-chips').evaluate((row) =>
      [...new Set([...row.children].map((el) => Math.round(el.getBoundingClientRect().top)))],
    );
    expect(tops).toHaveLength(1);
    const reset = await page.getByTestId('condition-reset').boundingBox();
    const slotBox = await slot(page).boundingBox();
    expect(slotBox!.x + slotBox!.width - (reset!.x + reset!.width)).toBeLessThanOrEqual(17);
    // Reset puts the list back as saved: no sort, no filter, the same row height
    await click(page, 'condition-reset');
    expect(await sortNow(page)).toEqual([]);
    await expect.poll(() => count(page)).toBe('12');
    expect(Math.round(await slotHeight(page))).toBe(ROW_HEIGHT);
    await expect(sortChip).toHaveAttribute('data-levels', '0');
    // a click on a column header opens its menu and sorts nothing
    // (objectstack#35876); the entry chosen there sorts, and the row shows it
    // on the one chip
    await page.getByRole('columnheader', { name: /Amount/ }).click();
    const columnMenu = page.getByTestId('column-context-menu');
    await expect(columnMenu).toBeVisible();
    expect(await sortNow(page)).toEqual([]);
    await columnMenu.getByRole('menuitem', { name: 'Sort descending' }).click();
    await style(page);
    await expect(sortChip).toHaveText(/^Sorted by Amount/);
    expect(await sortNow(page)).toEqual(['amount:desc']);
  });
});
