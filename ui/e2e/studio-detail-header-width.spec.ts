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
 * TEST PAGE for objectstack#36892: the full-screen Studio detail header
 * (`StudioDetailHeader`), mounted at a wide and a narrow content column and
 * measured in Chromium.
 *
 * ## Why a Playwright page and not a vitest test
 *
 * jsdom has no layout engine. The unit test (`StudioDetailHeader.test.tsx`)
 * pins the fold's ORDER against stubbed widths; this page proves the real row
 * computes it: on a wide column everything is whole in the row, on a narrow
 * one the identity chips (type, package, api name) leave for ⋯ first, then the
 * position text, the title keeps its readable width, and no box leaves the
 * row. The bundling follows `e2e/studio-item-header-title-width.spec.ts`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: `StudioDetailHeader`, `StudioItemHeader` and everything they import,
 * bundled by Vite from source and mounted with React's client renderer, and
 * the real Tailwind theme compiled for the classes on the page.
 *
 * FIXTURES: the props (an object "Lead" from package "CRM", a draft status, a
 * five-name list with the current item third, a "Publish" primary button and
 * one ⋯ item); the row width is set by the box around the header (its 24 px
 * side padding included), not by the console's rail and aside; fonts are
 * whatever Chromium falls back to, so the assertions are relations (folded or
 * whole, inside the row), never one font's pixels.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const DETAIL_HEADER = source('packages/app-shell/src/views/studio-detail/StudioDetailHeader.tsx');
const COMPONENTS = source('packages/components/src/index.ts');
const THEME_CSS = source('packages/components/src/index.css');

/** `px-6` on the header: the row is this much narrower than the header. */
const HEADER_SIDE_PADDING = 48;

const ENTRY = '\0studio-detail-header-width:entry';

function workspaceSources(): Plugin {
  return {
    name: 'studio-detail-header-width-workspace-src',
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
import { DropdownMenuItem } from ${JSON.stringify(COMPONENTS)};
import { StudioDetailHeader } from ${JSON.stringify(DETAIL_HEADER)};

const h = React.createElement;
const Icon = (props) => h('svg', { ...props, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, h('rect', { x: 2, y: 2, width: 12, height: 12 }));

createRoot(document.getElementById('root')).render(
  h('div', { id: 'frame', className: 'bg-background' },
    h(StudioDetailHeader, {
      testId: 'hdr',
      locale: 'en',
      icon: Icon,
      label: 'Lead qualification board',
      apiName: 'lead_qualification',
      typeLabel: 'Object',
      packageLabel: 'CRM',
      status: { label: 'Unpublished draft' },
      sequence: { names: ['account', 'contact', 'lead_qualification', 'opportunity', 'task'], current: 'lead_qualification' },
      onOpenItem: (name) => { window.__opened = name; },
      onClose: () => { window.__closed = (window.__closed ?? 0) + 1; },
      primaryAction: h('button', { type: 'button', 'data-testid': 'probe-primary', className: 'inline-flex h-7 shrink-0 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground' }, 'Publish'),
      menu: h(DropdownMenuItem, { 'data-testid': 'probe-delete' }, 'Delete'),
    })),
);
`;
  return {
    name: 'studio-detail-header-width-entry',
    resolveId: (id) => (id === 'studio-detail-header-width:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    cacheDir: path.join(os.tmpdir(), 'objectui-studio-detail-header-width'),
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
        input: 'studio-detail-header-width:entry',
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
  const css = compiler.build(candidates);
  // An unstyled row would measure nothing the console draws.
  for (const needle of ['@container', 'text-overflow: ellipsis', '--color-muted']) {
    if (!css.includes(needle)) throw new Error(`Tailwind emitted nothing for ${needle}; the row would be unstyled.`);
  }
  return css;
}

interface Reading {
  row: { width: number; scrollWidth: number };
  title: { width: number; clipped: boolean };
  /** Which identity chips the row holds. */
  inRow: { type: boolean; package: boolean; apiName: boolean };
  /** The position text ("3 / 5") takes room in the row. */
  positionShown: boolean;
  /** The actions' fold stage, as the header marks it. */
  fold: string | null;
  /** Every box of the row lies inside it. */
  childrenInsideRow: boolean;
  /** ×, ‹, › and ⋯ are drawn inside the row. */
  controlsInsideRow: boolean;
  documentOverflowX: number;
}

let bundle = '';

/** Mount on a page whose stylesheet is there before the header, as in the console. */
async function mount(page: Page, row: number): Promise<void> {
  await page.setViewportSize({ width: row + HEADER_SIDE_PADDING, height: 400 });
  // First pass: collect the classes both forms of the header use.
  const compiled = new Set<string>();
  let css = '';
  for (let round = 0; ; round++) {
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0}</style><style id="tailwind"></style></head><body><div id="root"></div></body></html>`,
    );
    await page.evaluate((text) => {
      document.getElementById('tailwind')!.textContent = text;
    }, css);
    await page.addScriptTag({ content: bundle, type: 'module' });
    await page.waitForSelector('[data-testid="studio-detail-title"]', { state: 'attached', timeout: 30_000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const candidates = await page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('[class]')].flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)).filter(Boolean),
      ),
    ]);
    if (round > 0 && candidates.every((cls) => compiled.has(cls))) break;
    if (round === 5) throw new Error('the page kept adding classes; the stylesheet never caught up');
    candidates.forEach((cls) => compiled.add(cls));
    css = await tailwindFor([...compiled]);
  }
  await page.evaluate(() => document.fonts?.ready);
  // Settle: two consecutive frames with the same title and actions widths.
  await page.waitForFunction(
    () => {
      const title = document.querySelector('[data-testid="studio-detail-title"]');
      const actions = title?.parentElement?.lastElementChild;
      if (!title || !actions) return false;
      const sig = `${title.getBoundingClientRect().width},${actions.getBoundingClientRect().width},${actions.getAttribute('data-fold')}`;
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
    const title = document.querySelector<HTMLElement>('[data-testid="studio-detail-title"]')!;
    const row = title.parentElement!;
    const rowRect = row.getBoundingClientRect();
    const actions = row.lastElementChild as HTMLElement;
    const inside = (el: Element | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left >= rowRect.left - 0.5 && r.right <= rowRect.right + 0.5;
    };
    const inRow = (id: string) => {
      const el = row.querySelector(`[data-testid="${id}"]`);
      return !!el && el.getBoundingClientRect().width > 0;
    };
    const boxes = Array.from(row.children)
      .flatMap((el) => (getComputedStyle(el).display === 'contents' ? Array.from(el.children) : [el]))
      .filter((el) => getComputedStyle(el).display !== 'none');
    const position = row.querySelector('[data-testid="studio-detail-position"]');
    return {
      row: { width: round(rowRect.width), scrollWidth: row.scrollWidth },
      title: { width: round(title.getBoundingClientRect().width), clipped: title.scrollWidth > title.clientWidth },
      inRow: { type: inRow('studio-detail-type'), package: inRow('studio-detail-package'), apiName: inRow('studio-item-api-name') },
      positionShown: !!position && position.getBoundingClientRect().width > 1,
      fold: actions.getAttribute('data-fold'),
      childrenInsideRow: boxes.every((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= rowRect.left - 0.5 && r.right <= rowRect.right + 0.5;
      }),
      controlsInsideRow: ['studio-detail-close', 'studio-detail-previous', 'studio-detail-next', 'studio-detail-more'].every((id) =>
        inside(row.querySelector(`[data-testid="${id}"]`)),
      ),
      documentOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });
}

async function read(page: Page, row: number, testInfo: import('@playwright/test').TestInfo): Promise<Reading> {
  await mount(page, row);
  const r = await measure(page);
  testInfo.annotations.push({ type: `studio-detail-header@${row}`, description: JSON.stringify(r) });
  process.stdout.write(`[studio-detail-header ${row}] ${JSON.stringify(r)}\n`);
  return r;
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  bundle = await bundlePage();
});

test.describe('the Studio detail header at a wide and a narrow column (objectstack#36892)', () => {
  test('wide (1024 px row): every part is whole in the row, nothing folded', async ({ page }, testInfo) => {
    const r = await read(page, 1024, testInfo);
    expect(r.row.width).toBe(1024);
    expect(r.inRow).toEqual({ type: true, package: true, apiName: true });
    expect(r.positionShown).toBe(true);
    expect(r.fold).toBeNull();
    expect(r.title.clipped).toBe(false);
    expect(r.childrenInsideRow).toBe(true);
    expect(r.controlsInsideRow).toBe(true);
    expect(r.documentOverflowX).toBe(0);
    await expect(page.getByTestId('studio-detail-position')).toHaveText('3 / 5');
  });

  test('narrow (360 px row): the identity chips leave for ⋯, and ×, ‹ ›, ⋯ stay inside the row', async ({ page }, testInfo) => {
    const r = await read(page, 360, testInfo);
    expect(r.row.width).toBe(360);
    expect(r.inRow).toEqual({ type: false, package: false, apiName: false });
    // Both of StudioItemHeader's stages are taken before the title is cut:
    // the chips are in ⋯ and the position text is out of the row.
    expect(r.fold).toBe('labels');
    expect(r.positionShown).toBe(false);
    expect(r.title.width).toBeGreaterThan(0);
    expect(r.childrenInsideRow).toBe(true);
    expect(r.controlsInsideRow).toBe(true);
    expect(r.row.scrollWidth).toBeLessThanOrEqual(Math.ceil(r.row.width));
    expect(r.documentOverflowX).toBe(0);
    // The folded chips are in ⋯, above the page's own item.
    await page.getByTestId('studio-detail-more').click();
    const menu = page.getByRole('menu');
    await expect(menu.getByTestId('studio-item-header-folded-chips')).toContainText('CRM');
    await expect(menu.getByTestId('probe-delete')).toBeVisible();
  });

  test('narrow: the keyboard reaches ‹ ›, they step, and Esc triggers ×', async ({ page }, testInfo) => {
    await read(page, 360, testInfo);
    await page.getByTestId('studio-detail-previous').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('studio-detail-next')).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as unknown as { __opened?: string }).__opened)).toBe('opportunity');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as unknown as { __closed?: number }).__closed)).toBe(1);
  });
});
