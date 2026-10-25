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
 * GEOMETRY pin for objectui#12704: a one-row dashboard metric tile is as tall
 * as its content, with no empty lower half.
 *
 * ## The defect
 *
 * The positioned dashboard grid (a dashboard that declares `columns`) gives
 * every row a floor of 5rem (`gridAutoRows: 'minmax(5rem, auto)'`) and lets a
 * widget span the rows its `layout.h` names (`gridRow: span h`). The metric
 * tile fills its box. A tile authored `h: 2` is therefore two rows plus the gap
 * (176 px) with its title and value in the top half and nothing below. The fix
 * is in the metadata (`h: 1`, the designer's default), so what this file pins
 * is the renderer's half of that contract: a one-row tile hugs its content, a
 * tile with a delta line is taller, and a two-row tile is still two rows.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * jsdom and happy-dom have no layout engine, so every rect there is 0x0. The
 * claims here are heights the grid computes, and only a browser computes them.
 * Same reason as `e2e/sidebar-offcanvas-geometry.spec.ts`, which this file
 * follows.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: `DashboardRenderer` and everything it imports, bundled by Vite from
 * their source files (each `@object-ui/*` package resolved to its `src/`, the
 * way the console bundle aliases them), and mounted in Chromium with React's
 * client renderer, so the dataset tile goes through its real loading effect.
 * The stylesheet is real Tailwind: `packages/components/src/index.css` (its
 * `@theme` included), compiled for exactly the classes the mounted page
 * carries. Put a fixed height on the tile, or change the grid rule, and the
 * heights measured here change with it.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - The data source is an object with one method, `queryDataset`, answering
 *     every measure a widget asks for from a constant table (and a
 *     `MEASURE__compare` column when the widget sends `compareTo`). No server
 *     runs: this is the `dataSource` prop the renderer takes, the same stub
 *     shape `packages/plugin-dashboard/src/__tests__/metricTileLayout-12623.test.tsx`
 *     hands it.
 *   - Each case is its own one-widget dashboard, so a case's height is its own
 *     content's and not the tallest tile in a shared row. One more dashboard
 *     puts the bare tile beside the delta tile to read that alignment.
 *   - Fonts are whatever Chromium falls back to (`Inter` is named by the theme
 *     and not installed in the test lane). That is why the assertions are
 *     relations (the box ends where its content ends; one tile is taller than
 *     another; two rows plus the gap), never pixel equality across fonts.
 *
 * The workspace packages are bundled from `src/` because this lane builds no
 * workspace `dist/`, and their `exports` point there.
 */

// The objectui tree, resolved from `scripts/ui-root.mjs`'s own location -- the
// one fact true standalone and under the objectstack monorepo's `ui/`. Walking up
// to `pnpm-workspace.yaml` found the OBJECTSTACK root there (objectstack#25723),
// and the sources this spec reads live under this tree's `packages/`.
const REPO_ROOT = uiRoot();

const source = (rel: string) => path.join(REPO_ROOT, rel);

const DASHBOARD_RENDERER = source('packages/plugin-dashboard/src/DashboardRenderer.tsx');
// By path, the module `@object-ui/i18n` resolves to below, so this file holds
// no import statement naming a workspace package (the premise
// `scripts/__tests__/e2e-type-check.test.ts` pins for `e2e/`).
const I18N_ENTRY = source('packages/i18n/src/index.ts');
const THEME_CSS = source('packages/components/src/index.css');

/** The widths the ruling names: the reported 1024 px and the console's 1280 px. */
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 1024, height: 900 },
] as const;

/** `gridAutoRows: 'minmax(5rem, auto)'` and the default `gap: 4` (1rem), in px. */
const ROW_PX = 80;
const GAP_PX = 16;

const ENTRY = '\0metric-tile-height:entry';

/**
 * `@object-ui/<pkg>` to `packages/<pkg>/src`, and a subpath into that `src/`.
 * The one subpath whose file is not named for it is `types/zod`.
 */
function workspaceSources(): Plugin {
  return {
    name: 'metric-tile-height-workspace-src',
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

/** The page: the cases described in the header, mounted with the client renderer. */
function entry(): Plugin {
  const code = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from ${JSON.stringify(I18N_ENTRY)};
import { DashboardRenderer } from ${JSON.stringify(DASHBOARD_RENDERER)};

const VALUES = { total_amount: 1964500, open_count: 42 };
const PREVIOUS = { total_amount: 1720000, open_count: 37 };
const dataSource = {
  async queryDataset(_dataset, selection) {
    const row = {};
    for (const m of selection.measures) {
      row[m] = VALUES[m];
      if (selection.compareTo) row[m + '__compare'] = PREVIOUS[m];
    }
    return {
      rows: [row],
      fields: selection.measures.map((m) => ({ name: m, label: m === 'total_amount' ? 'Total Amount' : 'Open Deals', type: 'number' })),
    };
  },
};

const metric = (id, title, layout, extra) => ({
  id, type: 'metric', title, dataset: 'opportunity_metrics', values: ['total_amount'], layout, ...extra,
});
const BARE = (layout) => metric('bare', 'Total Pipeline', layout);
const DELTA = (layout) => metric('delta', 'Pipeline vs prior', layout, { compareTo: { kind: 'previousPeriod' } });

// Each case is its own dashboard (see the header). 12 columns, a quarter-width tile.
const CASES = [
  ['bare', [BARE({ x: 0, y: 0, w: 3, h: 1 })]],
  ['delta', [DELTA({ x: 0, y: 0, w: 3, h: 1 })]],
  ['control', [metric('control', 'Win Rate', { x: 0, y: 0, w: 3, h: 2 })]],
  ['row', [BARE({ x: 0, y: 0, w: 3, h: 1 }), DELTA({ x: 3, y: 0, w: 3, h: 1 })]],
];

const h = React.createElement;
createRoot(document.getElementById('root')).render(
  h(I18nProvider, { config: { defaultLanguage: 'en', detectBrowserLanguage: false } },
    h('div', { className: 'flex flex-col gap-8 bg-background p-6' },
      ...CASES.map(([name, widgets]) =>
        h('section', { key: name, 'data-case': name },
          h(DashboardRenderer, { schema: { type: 'dashboard', name, columns: 12, widgets }, dataSource }))))),
);
`;
  return {
    name: 'metric-tile-height-entry',
    resolveId: (id) => (id === 'metric-tile-height:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

/** Bundle the page once, from source, to one ES module held in memory. */
async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-metric-tile-height'),
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
        input: 'metric-tile-height:entry',
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
  const css = compiler.build(candidates);
  // A stylesheet missing the rules under test would measure an unstyled tree
  // and could pass for the wrong reason.
  for (const needle of ['@container', 'line-clamp', '--color-card']) {
    if (!css.includes(needle)) throw new Error(`Tailwind emitted nothing for ${needle}; the tile would be unstyled.`);
  }
  return css;
}

interface TileReading {
  title: string;
  /** The grid item's border box: what the grid sized. */
  height: number;
  gridRow: string;
  /** The box's bottom edge minus the bottom of the last line drawn inside it. */
  slackBelowContent: number;
  /** The padding and border between the last line and the box's bottom edge. */
  chromeBelowContent: number;
  hasDelta: boolean;
}

type CaseName = 'bare' | 'delta' | 'control' | 'row';
type Reading = Record<CaseName, TileReading[]>;

let bundle = '';

async function mount(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.setContent('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: bundle, type: 'module' });
  // Every tile has answered: the stub resolves at once, so this waits only for
  // the effects to run.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="dataset-metric-title"]').length === 5,
    null,
    { timeout: 30_000 },
  );
  // The stylesheet is compiled for the classes on the page, and the page can
  // still add classes after the tiles answer (a later effect re-renders a
  // node). So compile until the class set stops growing: a rule missing from a
  // one-shot sheet (a card's `border`, say) moves the reading by a pixel or two.
  const classesOnPage = () =>
    page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('[class]')].flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)).filter(Boolean),
      ),
    ]);
  const compiled = new Set<string>();
  for (let round = 0; ; round++) {
    const candidates = await classesOnPage();
    if (round > 0 && candidates.every((c) => compiled.has(c))) break;
    if (round === 5) throw new Error('the page kept adding classes; the stylesheet never caught up');
    candidates.forEach((c) => compiled.add(c));
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
  // Settle: two consecutive frames with the same heights.
  await page.waitForFunction(
    () => {
      const sig = [...document.querySelectorAll('[data-case]')].map((s) => s.getBoundingClientRect().height).join(',');
      const w = window as unknown as { __sig?: string };
      const prev = w.__sig;
      w.__sig = sig;
      return prev === sig;
    },
    null,
    { polling: 'raf', timeout: 10_000 },
  );
}

async function measure(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const px = (v: string) => parseFloat(v) || 0;
    const reading = {} as Record<string, unknown[]>;
    for (const section of document.querySelectorAll<HTMLElement>('[data-case]')) {
      reading[section.dataset.case as string] = [...section.querySelectorAll('[data-testid="dataset-metric-title"]')].map(
        (title) => {
          // The grid item: the ancestor the renderer put the row span on.
          let item = title as HTMLElement;
          while (item.parentElement && !item.style.gridRow) item = item.parentElement;
          if (!item.style.gridRow) throw new Error('no grid item carries a row span above the tile title');
          const box = item.getBoundingClientRect();
          // The bottom of the last thing drawn: the lowest text or icon box
          // inside the item (an element with no element children).
          let contentBottom = 0;
          for (const leaf of item.querySelectorAll('*')) {
            if (leaf.children.length > 0) continue;
            const r = leaf.getBoundingClientRect();
            if (r.height > 0 && r.width > 0) contentBottom = Math.max(contentBottom, r.bottom);
          }
          // The padding and border between that line and the item's edge: every
          // ancestor from the last leaf's parent up to the item contributes its
          // bottom padding and border.
          let chrome = 0;
          let lowest: Element | null = null;
          for (const leaf of item.querySelectorAll('*')) {
            if (leaf.children.length > 0) continue;
            const r = leaf.getBoundingClientRect();
            if (r.height > 0 && r.width > 0 && Math.abs(r.bottom - contentBottom) < 0.01) lowest = leaf;
          }
          for (let el = lowest?.parentElement ?? null; el && item.contains(el); el = el.parentElement) {
            const s = getComputedStyle(el);
            chrome += px(s.paddingBottom) + px(s.borderBottomWidth);
            if (el === item) break;
          }
          return {
            title: title.textContent ?? '',
            height: round(box.height),
            gridRow: item.style.gridRow,
            slackBelowContent: round(box.bottom - contentBottom),
            chromeBelowContent: round(chrome),
            hasDelta: !!item.querySelector('svg.lucide-arrow-up, svg.lucide-arrow-down, svg.lucide-minus'),
          };
        },
      );
    }
    return reading as unknown as Reading;
  });
}

test.beforeAll(async () => {
  // Bundling the renderer's module graph is the slow part (tens of seconds);
  // it happens once per worker.
  test.setTimeout(240_000);
  bundle = await bundlePage();
});

test.describe('a dashboard metric tile is as tall as its content (objectui#12704)', () => {
  for (const viewport of VIEWPORTS) {
    test(`at ${viewport.width} px: one row hugs its content, a delta line adds height, two rows stay two rows`, async ({
      page,
    }, testInfo) => {
      await mount(page, viewport);
      const reading = await measure(page);
      // The readings go to the report: the numbers depend on the font, so they
      // are recorded, not asserted for equality.
      await testInfo.attach(`metric-tile-heights-${viewport.width}.json`, {
        body: JSON.stringify(reading, null, 2),
        contentType: 'application/json',
      });
      testInfo.annotations.push({ type: `metric-tile-heights@${viewport.width}`, description: JSON.stringify(reading) });
      const shot = testInfo.outputPath(`metric-tile-heights-${viewport.width}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await testInfo.attach(`metric-tile-heights-${viewport.width}.png`, { path: shot, contentType: 'image/png' });

      const [bare] = reading.bare;
      const [delta] = reading.delta;
      const [control] = reading.control;

      // The configuration under test, so a green run is about these spans.
      expect([bare.gridRow, delta.gridRow, control.gridRow]).toEqual(['span 1', 'span 1', 'span 2']);
      expect(delta.hasDelta, 'the delta case must draw its delta line').toBe(true);
      expect(bare.hasDelta).toBe(false);

      // Content height, no empty lower half: the box ends at its last line
      // plus the padding and border below it. Half a pixel of rounding.
      for (const [name, tile] of [['bare', bare], ['delta', delta]] as const) {
        expect(
          Math.abs(tile.slackBelowContent - tile.chromeBelowContent),
          `${name}: the one-row box runs ${tile.slackBelowContent - tile.chromeBelowContent}px past its content and padding`,
        ).toBeLessThanOrEqual(0.5);
      }
      // A one-row tile is above the 5rem floor here, so it is content-sized and
      // not floor-sized; that is what makes the check above mean something.
      expect(bare.height).toBeGreaterThan(ROW_PX);

      // The delta line is a line of its own.
      expect(delta.height).toBeGreaterThan(bare.height);

      // CONTROL: two rows plus the gap, and the empty lower half the
      // metadata fix removes is still there for a tile that asks for it.
      expect(control.height).toBe(2 * ROW_PX + GAP_PX);
      expect(control.slackBelowContent - control.chromeBelowContent).toBeGreaterThan(ROW_PX / 2);
      expect(control.height).toBeGreaterThan(delta.height);

      // Tiles in one row align on the tallest.
      expect(reading.row.map((t) => t.height)).toEqual([delta.height, delta.height]);
    });
  }
});
