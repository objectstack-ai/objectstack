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
 * GEOMETRY pin for objectui#12791: in Studio's item header a long api-name
 * chip gives way before the title, so the title keeps at least 200 px. And
 * for objectui#12897: on an Interfaces view leaf the actions slot no longer
 * takes the title's whole width (the last describe block below).
 *
 * ## The defect
 *
 * The title row draws the title (`STUDIO_ITEM_TITLE`, `min-w-0 truncate`) and
 * then the api-name chip (`STUDIO_API_CHIP`). The chip was `shrink-0`, so a
 * long machine name kept its whole width and the title gave way to a few
 * characters ("Service T…", about 100 px at a 560 px row). objectui#12611's
 * order for this row is: the meta slot folds, the status chip's text folds,
 * and the title truncates last with at least 200 px. The api chip now sits in
 * that order before the title: it truncates first, its full name in its
 * tooltip.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * jsdom and happy-dom have no layout engine, so every rect there is 0x0. The
 * claims here are widths the flex row computes, and only a browser computes
 * them. Same reason as `e2e/record-header-title-width.spec.ts` (the record
 * page's title-width pin) and `e2e/dashboard-metric-tile-height.spec.ts`,
 * whose bundling this file follows.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: `StudioItemHeader` and everything it imports (its tokens, the
 * `@object-ui/components` tooltip), bundled by Vite from their source files
 * and mounted in Chromium with React's client renderer. The stylesheet is real
 * Tailwind: `packages/components/src/index.css` (its `@theme` included),
 * compiled for exactly the classes the mounted page carries. Put `shrink-0`
 * back on the chip and the widths measured here change with it.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - The props are the Data pillar's header for a draft object, as
 *     `StudioDesignSurface` passes them: an icon, the label, the api name, the
 *     "Unpublished draft" status, a field-count meta and the "Last saved"
 *     hint as the actions. The icon is a plain square, not a Lucide glyph.
 *   - The row width is set by the box around the header (the header's own
 *     24 px side padding included), not by the console's rail and aside.
 *   - Fonts are whatever Chromium falls back to (`Inter` is named by the theme
 *     and not installed in the test lane). The assertions are the card's
 *     floor (200 px) and relations (clipped or whole, inside the row), and the
 *     widths themselves go to the report. Where a CONTROL's outcome depends
 *     on the font (does the short chip fit beside 200 px of title at 560 px?),
 *     it asserts the row's rule from widths measured on the same page, then
 *     asserts "whole" at the narrowest row that holds the item: CI's fallback
 *     font draws the title about 17% wider than a local one.
 */

// The objectui tree, resolved from `scripts/ui-root.mjs`'s own location -- the
// one fact true standalone and under the objectstack monorepo's `ui/`. Walking up
// to `pnpm-workspace.yaml` found the OBJECTSTACK root there (objectstack#25723),
// and the sources this spec reads live under this tree's `packages/`.
const REPO_ROOT = uiRoot();

const source = (rel: string) => path.join(REPO_ROOT, rel);

const ITEM_HEADER = source('packages/app-shell/src/views/studio-design/StudioItemHeader.tsx');
const STUDIO_TOKENS = source('packages/app-shell/src/views/studio-design/studio-tokens.ts');
const THEME_CSS = source('packages/components/src/index.css');

/** The card's draft object label. */
const TITLE = 'Service Territory Assignment 105';
/** A 30-character api name (the card's acceptance 1). */
const LONG_API = 'service_territory_assignment_5';
/** The CONTROL: a short api name. */
const SHORT_API = 'account';

/** `px-6` on the header: the row is this much narrower than the header. */
const HEADER_SIDE_PADDING = 48;
/** The card's floor, from objectui#12611's target 2. */
const TITLE_FLOOR = 200;

interface Case {
  name: string;
  /** The title row's width, in px. */
  row: number;
  apiName: string;
  /** A kind chip in the `chips` slot (ruling: the chips stay whole). */
  kindChip?: boolean;
  /** The item label, when not the card's. */
  title?: string;
  /** objectui#12897 — draw an Interfaces view leaf's header instead of the Data one. */
  kind?: 'interfaces';
}

const CASES = {
  long560: { name: 'long560', row: 560, apiName: LONG_API },
  short560: { name: 'short560', row: 560, apiName: SHORT_API },
  // The card's 1024 px viewport: a 736 px row with the rail and the aside open.
  long736: { name: 'long736', row: 736, apiName: LONG_API },
  long1024: { name: 'long1024', row: 1024, apiName: LONG_API },
  long360: { name: 'long360', row: 360, apiName: LONG_API },
  chips736: { name: 'chips736', row: 736, apiName: LONG_API, kindChip: true },
  shortTitle560: { name: 'shortTitle560', row: 560, apiName: LONG_API, title: 'Account' },
  // objectui#12897 — the rows measured live on the card's kanban leaf, copilot
  // open: 422 px at a 1010 px window, 632 px at 1280 px.
  leaf422: { name: 'leaf422', row: 422, apiName: '', kind: 'interfaces' },
  leaf632: { name: 'leaf632', row: 632, apiName: '', kind: 'interfaces' },
  leaf1024: { name: 'leaf1024', row: 1024, apiName: '', kind: 'interfaces' },
} satisfies Record<string, Case>;

/** objectui#12897 — the Interfaces leaf's label, kind and internal id, in English. */
const LEAF_TITLE = 'Task board (kanban view)';
const LEAF_KIND = 'View';
const LEAF_INTERNAL_ID = 'Internal id: object · showcase_task';
const READ_ONLY_LINK = 'Read-only · Customize with an overlay';

const ENTRY = '\0studio-item-header-width:entry';

/**
 * `@object-ui/<pkg>` to `packages/<pkg>/src`, and a subpath into that `src/`.
 * The one subpath whose file is not named for it is `types/zod`.
 */
function workspaceSources(): Plugin {
  return {
    name: 'studio-item-header-width-workspace-src',
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
import { StudioItemHeader, useStudioTabRowFold } from ${JSON.stringify(ITEM_HEADER)};
import { STUDIO_HEADER_ICON_BUTTON, STUDIO_KIND_CHIP } from ${JSON.stringify(STUDIO_TOKENS)};

const h = React.createElement;
const Icon = (props) => h('svg', { ...props, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, h('rect', { x: 2, y: 2, width: 12, height: 12 }));
const c = window.__case;

// objectui#12897 — the read-only link as StudioDesignSurface draws it: the
// same hook, the same classes, an anchor instead of the router's Link.
function ReadOnlyLink() {
  const ref = React.useRef(null);
  const label = ${JSON.stringify(READ_ONLY_LINK)};
  const folded = useStudioTabRowFold(ref, label);
  return h('a', {
    ref, href: '#overlay', title: 'This package is read-only.', 'data-testid': 'studio-readonly-link', 'data-folded': folded || undefined,
    className: 'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-amber-400/15 text-xs font-medium text-amber-700 ' + (folded ? 'w-7 justify-center' : 'px-2.5'),
  }, h(Icon, { className: 'h-3.5 w-3.5 shrink-0' }), h('span', { className: folded ? 'sr-only' : undefined }, label));
}

// objectui#12897 — an Interfaces view leaf's header, as StudioDesignSurface
// passes it for a read-only package: the label with its kind for a reader,
// the internal id as the title's tooltip, the kind chip, and the actions.
const interfacesLeaf = () => h(StudioItemHeader, {
  testId: 'hdr',
  icon: Icon,
  title: h(React.Fragment, null, ${JSON.stringify(LEAF_TITLE)}, h('span', { className: 'sr-only' }, ${JSON.stringify(` · ${LEAF_KIND}`)})),
  titleProps: { 'data-testid': 'hdr-title', title: ${JSON.stringify(LEAF_INTERNAL_ID)} },
  chips: h('span', { className: STUDIO_KIND_CHIP, 'data-testid': 'hdr-kind-chip', title: ${JSON.stringify(LEAF_INTERNAL_ID)} }, ${JSON.stringify(LEAF_KIND)}),
  actions: h(React.Fragment, null,
    h(ReadOnlyLink),
    h('button', { type: 'button', 'data-testid': 'if-open-in-data', className: 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs text-foreground hover:bg-muted' },
      h(Icon, { className: 'h-3.5 w-3.5 text-muted-foreground' }), 'Open in Data'),
    h('button', { type: 'button', 'data-testid': 'if-item-more', 'aria-label': 'More', className: STUDIO_HEADER_ICON_BUTTON }, h(Icon, { className: 'h-4 w-4' }))),
  className: 'border-b-0 pb-3',
});

createRoot(document.getElementById('root')).render(
  h('div', { id: 'frame', className: 'bg-background' },
    c.kind === 'interfaces' ? interfacesLeaf() : h(StudioItemHeader, {
      testId: 'hdr',
      icon: Icon,
      title: c.title ?? ${JSON.stringify(TITLE)},
      titleProps: { 'data-testid': 'hdr-title' },
      apiName: c.apiName,
      chips: c.kindChip ? h('span', { className: STUDIO_KIND_CHIP, 'data-testid': 'hdr-kind-chip' }, 'Custom') : undefined,
      status: { label: 'Unpublished draft' },
      meta: h('span', { 'data-testid': 'hdr-meta' }, '12 fields'),
      actions: h('span', { className: 'text-[11px] text-muted-foreground', 'data-testid': 'hdr-saved-at' }, 'Last saved 10:42'),
    })),
);
`;
  return {
    name: 'studio-item-header-width-entry',
    resolveId: (id) => (id === 'studio-item-header-width:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

/** Bundle the page once, from source, to one ES module held in memory. */
async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-studio-item-header-width'),
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
        input: 'studio-item-header-width:entry',
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
  // A stylesheet missing the rules under test would measure an unstyled row
  // and could pass for the wrong reason: the row's container queries and the
  // chip's truncation have to be there.
  for (const needle of ['@container', 'text-overflow: ellipsis', '--color-muted']) {
    if (!css.includes(needle)) throw new Error(`Tailwind emitted nothing for ${needle}; the row would be unstyled.`);
  }
  return css;
}

interface Box {
  width: number;
  scrollWidth: number;
  /** The text is cut: its content is wider than its box. */
  clipped: boolean;
}

/** The steps the row shares out, read from the browser (`studio-tokens.ts`). */
interface Steps {
  /** The title's basis: 200 px. */
  title: number;
  /** The chip's basis: 14 characters of its own font, in px. */
  chip: number;
  /** The chip's minimum: 5 characters, in px. */
  chipMin: number;
}

interface Reading {
  row: { width: number; scrollWidth: number };
  title: Box & { text: string };
  chip: Box & { text: string; tabIndex: number };
  steps: Steps;
  kindChip: Box | null;
  status: { width: number; textShown: boolean };
  /** Every child of the row lies inside it. */
  childrenInsideRow: boolean;
  /** Title, api chip, chips: the order objectui#11665 and objectui#7254 pin. */
  identityOrder: string[];
  documentOverflowX: number;
}

/**
 * The widths the row's rule gives the title and the chip, from what this page
 * measured: the room the two share (every other slot is fixed or takes only
 * what they leave), each one's whole text, and the steps. This is what makes
 * the CONTROLs below hold under any font: they assert the rule, not one
 * font's pixels. The four steps, in order: the title to its basis (or its
 * whole text), the chip to its basis (or its whole name), the title to its
 * whole text, the chip to its whole name. On a row too narrow for both bases
 * the chip gives way first, down to its minimum.
 */
function predict(r: Reading): { room: number; title: number; chip: number } {
  const room = r.title.width + r.chip.width;
  const titleFull = r.title.scrollWidth;
  const chipFull = r.chip.scrollWidth;
  const titleStep = Math.min(r.steps.title, titleFull);
  const chipStep = Math.max(r.steps.chipMin, Math.min(r.steps.chip, chipFull));
  if (room >= titleFull + chipFull) return { room, title: titleFull, chip: chipFull };
  if (room >= titleFull + chipStep) return { room, title: titleFull, chip: room - titleFull };
  if (room >= titleStep + chipStep) return { room, title: room - chipStep, chip: chipStep };
  const chip = Math.max(r.steps.chipMin, room - titleStep);
  return { room, title: room - chip, chip };
}

/** The reading matches the rule, to a pixel (scroll widths are whole pixels). */
function expectRule(r: Reading): void {
  const want = predict(r);
  const got = `title ${r.title.width}px (text ${r.title.scrollWidth}px), chip ${r.chip.width}px (name ${r.chip.scrollWidth}px), steps ${JSON.stringify(r.steps)}`;
  expect(Math.abs(r.title.width - want.title), `title should be ${want.title}px: ${got}`).toBeLessThanOrEqual(1);
  expect(Math.abs(r.chip.width - want.chip), `chip should be ${want.chip}px: ${got}`).toBeLessThanOrEqual(1);
}

let bundle = '';

async function mount(page: Page, c: Case): Promise<void> {
  await page.setViewportSize({ width: c.row + HEADER_SIDE_PADDING, height: 400 });
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div id="root"></div></body></html>');
  await page.evaluate((value) => {
    (window as unknown as { __case: Case }).__case = value;
  }, c);
  await page.addScriptTag({ content: bundle, type: 'module' });
  // Attached, not visible: a starved title is 0 px wide, and that is the reading.
  await page.waitForSelector('[data-testid="hdr-title"]', { state: 'attached', timeout: 30_000 });
  // The stylesheet is compiled for the classes on the page; compile until the
  // class set stops growing.
  const classesOnPage = () =>
    page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('[class]')].flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)).filter(Boolean),
      ),
    ]);
  const compiled = new Set<string>();
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
  if (c.kind === 'interfaces') {
    // objectui#12897 — the read-only link keeps the width it read while it
    // showed whole, as it does in the console, where the stylesheet is there
    // before the header mounts. So mount it again on a page styled from the
    // start (the classes of both its forms are compiled by now).
    const css = await tailwindFor([...compiled]);
    await page.setContent('<!doctype html><html><head><style>html,body{margin:0}</style><style id="tailwind"></style></head><body><div id="root"></div></body></html>');
    await page.evaluate(
      ({ value, text }) => {
        (window as unknown as { __case: Case }).__case = value;
        document.getElementById('tailwind')!.textContent = text;
      },
      { value: c, text: css },
    );
    await page.addScriptTag({ content: bundle, type: 'module' });
    await page.waitForSelector('[data-testid="hdr-title"]', { state: 'attached', timeout: 30_000 });
  }
  await page.evaluate(() => document.fonts?.ready);
  // Settle: two consecutive frames with the same title, chip and actions
  // widths (the Interfaces leaf has no api chip; its actions fold).
  // ⛔ Not `title width > 0`: a starved title can be 0 wide, and that reading
  // is the finding, not a reason to time out.
  await page.waitForFunction(
    () => {
      const title = document.querySelector('[data-testid="hdr-title"]');
      const chip = document.querySelector('[data-testid="studio-item-api-name"]');
      const actions = title?.parentElement?.lastElementChild;
      if (!title || !actions) return false;
      const sig = `${title.getBoundingClientRect().width},${chip?.getBoundingClientRect().width},${actions.getBoundingClientRect().width}`;
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
    const boxOf = (el: HTMLElement): { width: number; scrollWidth: number; clipped: boolean } => {
      const width = el.getBoundingClientRect().width;
      return { width: round(width), scrollWidth: el.scrollWidth, clipped: el.scrollWidth > el.clientWidth };
    };
    const title = document.querySelector<HTMLElement>('[data-testid="hdr-title"]')!;
    const chip = document.querySelector<HTMLElement>('[data-testid="studio-item-api-name"]')!;
    const kind = document.querySelector<HTMLElement>('[data-testid="hdr-kind-chip"]');
    const status = document.querySelector<HTMLElement>('[data-testid="studio-item-status"]')!;
    const statusText = status.querySelector<HTMLElement>('[data-slot="status-text"]')!;
    const row = title.parentElement!;
    const rowRect = row.getBoundingClientRect();
    // Computed lengths are absolute, so `14ch` and `5ch` come back in px, in
    // the chip's own font.
    const px = (v: string) => parseFloat(v) || 0;
    const steps = {
      title: px(getComputedStyle(title).flexBasis),
      chip: px(getComputedStyle(chip).flexBasis),
      chipMin: px(getComputedStyle(chip).minWidth),
    };
    // The row's boxes: its children, and the children of a `contents` wrapper
    // (the identity chips), which draws no box of its own.
    const boxes = Array.from(row.children).flatMap((el) =>
      getComputedStyle(el).display === 'contents' ? Array.from(el.children) : [el],
    );
    const shown = boxes.filter((el) => getComputedStyle(el).display !== 'none');
    return {
      row: { width: round(rowRect.width), scrollWidth: row.scrollWidth },
      title: { ...boxOf(title), text: title.textContent ?? '' },
      chip: { ...boxOf(chip), text: chip.textContent ?? '', tabIndex: chip.tabIndex },
      steps,
      kindChip: kind ? boxOf(kind) : null,
      status: { width: round(status.getBoundingClientRect().width), textShown: statusText.getBoundingClientRect().width > 1 },
      childrenInsideRow: shown.every((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= rowRect.left - 0.5 && r.right <= rowRect.right + 0.5;
      }),
      identityOrder: boxes.flatMap((el) =>
        el === title ? ['title'] : el === chip ? ['api-chip'] : el === kind ? ['kind-chip'] : [],
      ),
      documentOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });
}

async function read(page: Page, c: Case, testInfo: import('@playwright/test').TestInfo): Promise<Reading> {
  await mount(page, c);
  const r = await measure(page);
  // The readings go to the report: the numbers depend on the font.
  testInfo.annotations.push({ type: `studio-item-header@${c.name}`, description: JSON.stringify(r) });
  process.stdout.write(`[studio-item-header ${c.name}] ${JSON.stringify(r)}\n`);
  return r;
}

test.beforeAll(async () => {
  // Bundling the header's module graph is the slow part; once per worker.
  test.setTimeout(240_000);
  bundle = await bundlePage();
});

test.describe('the Studio item title keeps its room beside a long api name (objectui#12791)', () => {
  test('at a 560 px row with a 30-character api name: the title keeps 200 px, the chip truncates, its name in its tooltip', async ({
    page,
  }, testInfo) => {
    const r = await read(page, CASES.long560, testInfo);
    expect(LONG_API).toHaveLength(30);
    expect(r.row.width).toBe(560);

    // THE assertion: the card's floor, measured, not a class.
    expect(r.title.width, `title ${r.title.width}px; api chip ${r.chip.width}px of ${r.chip.scrollWidth}px`).toBeGreaterThanOrEqual(
      TITLE_FLOOR,
    );
    // The chip gave the room: it is cut, and still says the whole name.
    expect(r.chip.clipped, `chip ${r.chip.width}px for ${r.chip.scrollWidth}px of name`).toBe(true);
    expect(r.chip.text).toBe(LONG_API);
    // The chip keeps its place: right after the title.
    expect(r.identityOrder).toEqual(['title', 'api-chip']);
    // Nothing was bought by pushing a slot out of the row.
    expect(r.childrenInsideRow).toBe(true);
    expect(r.row.scrollWidth).toBeLessThanOrEqual(Math.ceil(r.row.width));

    // The whole name is the chip's tooltip, as the status chip's folded text is.
    expect(r.chip.tabIndex).toBe(0);
    await page.getByTestId('studio-item-api-name').hover();
    await expect(page.getByRole('tooltip')).toHaveText(LONG_API);
  });

  test('CONTROL: with a short api name the chip is whole wherever the row holds it beside the 200 px title', async ({
    page,
  }, testInfo) => {
    // At 560 px: the rule, from this page's own widths. Whether the short
    // chip fits there beside 200 px of title depends on the font (the status
    // chip and the actions are text too), so it is not asserted as a pixel.
    const r = await read(page, CASES.short560, testInfo);
    expect(r.chip.text).toBe(SHORT_API);
    expect(r.title.width).toBeGreaterThanOrEqual(TITLE_FLOOR);
    expect(r.childrenInsideRow).toBe(true);
    expectRule(r);
    // Then at the narrowest row that holds 200 px of title and the whole
    // short name (560 px when this font leaves room there): the chip is whole.
    const shortfall = Math.max(0, r.steps.title + r.chip.scrollWidth - predict(r).room);
    const fits = shortfall > 0 ? await read(page, { ...CASES.short560, name: 'short-fits', row: Math.ceil(560 + shortfall) + 1 }, testInfo) : r;
    expect(fits.chip.clipped, `chip ${fits.chip.width}px for ${fits.chip.scrollWidth}px of name at a ${fits.row.width}px row`).toBe(false);
    expect(fits.title.width).toBeGreaterThanOrEqual(TITLE_FLOOR);
    expectRule(fits);
  });

  test("CONTROL: the title is whole wherever the row holds it beside the chip's 14 characters (736 px, the card's 1024 px viewport)", async ({
    page,
  }, testInfo) => {
    // At 736 px: the rule, from this page's own widths. Whether the whole
    // title fits there beside the chip's 14 characters depends on the font.
    const r = await read(page, CASES.long736, testInfo);
    expect(r.title.text).toBe(TITLE);
    expect(r.childrenInsideRow).toBe(true);
    expectRule(r);
    // Then at the narrowest row that holds the whole title and the chip's
    // 14 characters (736 px when this font leaves room there): the title is
    // whole, and the long chip is what is cut.
    const chipStep = Math.min(r.steps.chip, r.chip.scrollWidth);
    const shortfall = Math.max(0, r.title.scrollWidth + chipStep - predict(r).room);
    const fits = shortfall > 0 ? await read(page, { ...CASES.long736, name: 'long-fits', row: Math.ceil(736 + shortfall) + 1 }, testInfo) : r;
    expect(fits.title.clipped, `title ${fits.title.width}px for ${fits.title.scrollWidth}px of text at a ${fits.row.width}px row`).toBe(false);
    expect(fits.chip.clipped).toBe(true);
    expectRule(fits);
  });

  test('CONTROL: at a 1024 px row with the long api name, neither the title nor the chip is cut', async ({ page }, testInfo) => {
    const r = await read(page, CASES.long1024, testInfo);
    expect(r.title.clipped, `title ${r.title.width}px for ${r.title.scrollWidth}px of text`).toBe(false);
    expect(r.chip.clipped, `chip ${r.chip.width}px for ${r.chip.scrollWidth}px of name`).toBe(false);
    expect(r.childrenInsideRow).toBe(true);
  });

  test('CONTROL: a short title is not padded to 200 px; the chip takes the room it leaves', async ({ page }, testInfo) => {
    const r = await read(page, CASES.shortTitle560, testInfo);
    expect(r.title.text).toBe('Account');
    expect(r.title.clipped).toBe(false);
    // The title's box is its text, not the 200 px step: no gap before the chip.
    expect(r.title.width).toBeLessThanOrEqual(r.title.scrollWidth + 0.5);
    expect(r.title.width).toBeLessThan(TITLE_FLOOR);
    expect(r.childrenInsideRow).toBe(true);
  });

  test('the chips after the api name stay whole: only the api chip gives way', async ({ page }, testInfo) => {
    const r = await read(page, CASES.chips736, testInfo);
    expect(r.identityOrder).toEqual(['title', 'api-chip', 'kind-chip']);
    expect(r.kindChip?.clipped, `kind chip ${JSON.stringify(r.kindChip)}`).toBe(false);
    expect(r.chip.clipped).toBe(true);
    expect(r.title.width).toBeGreaterThanOrEqual(TITLE_FLOOR);
  });

  test('at a 360 px row nothing overflows: below the floor the title gives way last, inside the row', async ({
    page,
  }, testInfo) => {
    const r = await read(page, CASES.long360, testInfo);
    expect(r.row.width).toBe(360);
    expect(r.documentOverflowX, 'the header pushed the page sideways').toBe(0);
    expect(r.row.scrollWidth, `row ${r.row.width}px holds ${r.row.scrollWidth}px`).toBeLessThanOrEqual(Math.ceil(r.row.width));
    expect(r.childrenInsideRow).toBe(true);
    // The status chip's text has folded (below 480 px of row), and the chip
    // has truncated before the title did.
    expect(r.status.textShown).toBe(false);
    expect(r.chip.clipped).toBe(true);
  });
});

/** objectui#12897 — what the Interfaces leaf's title row gives each piece. */
interface LeafReading {
  row: { width: number; scrollWidth: number };
  title: Box & { tooltip: string | null };
  /** The room the row leaves the title: its width less every other box and the gaps. */
  titleRoom: number;
  link: { width: number; folded: boolean; name: string; title: string | null };
  /** Each action's box, and whether it lies inside the row. */
  actions: Array<{ testid: string | null; width: number; inside: boolean }>;
  documentOverflowX: number;
}

async function readLeaf(page: Page, c: Case, testInfo: import('@playwright/test').TestInfo): Promise<LeafReading> {
  await mount(page, c);
  const r = await page.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const title = document.querySelector<HTMLElement>('[data-testid="hdr-title"]')!;
    const link = document.querySelector<HTMLElement>('[data-testid="studio-readonly-link"]')!;
    const row = title.parentElement!;
    const rowRect = row.getBoundingClientRect();
    const boxes = Array.from(row.children)
      .flatMap((el) => (getComputedStyle(el).display === 'contents' ? Array.from(el.children) : [el]))
      .filter((el) => getComputedStyle(el).display !== 'none');
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const others = boxes.filter((el) => el !== title).reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
    const actionsSlot = row.lastElementChild!;
    return {
      row: { width: round(rowRect.width), scrollWidth: row.scrollWidth },
      title: {
        width: round(title.getBoundingClientRect().width),
        scrollWidth: title.scrollWidth,
        clipped: title.scrollWidth > title.clientWidth,
        tooltip: title.getAttribute('title'),
      },
      titleRoom: round(row.clientWidth - others - gap * (boxes.length - 1)),
      link: {
        width: round(link.getBoundingClientRect().width),
        folded: link.hasAttribute('data-folded'),
        name: (link.textContent ?? '').trim(),
        title: link.getAttribute('title'),
      },
      actions: Array.from(actionsSlot.children).map((el) => {
        const b = el.getBoundingClientRect();
        return {
          testid: el.getAttribute('data-testid'),
          width: round(b.width),
          inside: b.width > 0 && b.left >= rowRect.left - 0.5 && b.right <= rowRect.right + 0.5,
        };
      }),
      documentOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });
  testInfo.annotations.push({ type: `studio-item-header@${c.name}`, description: JSON.stringify(r) });
  process.stdout.write(`[studio-item-header ${c.name}] ${JSON.stringify(r)}\n`);
  return r;
}

/** The leaf's whole title, as the title's text reads it (its kind is for a reader). */
const LEAF_TITLE_TEXT = `${LEAF_TITLE} · ${LEAF_KIND}`;
/**
 * The least the title shows when it is cut: four characters of an 18 px
 * label and the ellipsis. Live, at the card's 1010 px window, the zh-CN
 * title got 104 px here (0 px before the fix); the fallback font of the
 * test lane moves that number, so the pin asserts this floor and the rule.
 */
const LEAF_TITLE_FLOOR = 64;

test.describe('an Interfaces view leaf keeps its title beside the actions (objectui#12897)', () => {
  test('at the 422 px row of a 1010 px window: the title shows, cut, its whole text in its tooltip; the read-only link folds; every action stays in the row', async ({
    page,
  }, testInfo) => {
    const r = await readLeaf(page, CASES.leaf422, testInfo);
    expect(r.row.width).toBe(422);

    // THE assertion: the title's visible width, measured. Before the fix the
    // actions slot (`shrink-0`) took the whole row and this read 0.
    expect(r.title.width, `title ${r.title.width}px; actions ${JSON.stringify(r.actions)}`).toBeGreaterThanOrEqual(LEAF_TITLE_FLOOR);
    // It has all the room the row leaves it, and no more is to be had: the
    // read-only link gave way first, folded to its glyph.
    expect(Math.abs(r.title.width - r.titleRoom), `title ${r.title.width}px, room ${r.titleRoom}px`).toBeLessThanOrEqual(1);
    expect(r.link.folded).toBe(true);
    expect(r.link.name).toBe(READ_ONLY_LINK);
    expect(r.link.title).not.toBeNull();

    // Cut, the title says its whole text in its tooltip, before the internal id.
    expect(r.title.clipped).toBe(true);
    expect(r.title.tooltip).toBe(`${LEAF_TITLE_TEXT}\n${LEAF_INTERNAL_ID}`);

    // The actions stay reachable: each one drawn, inside the row; nothing overflows.
    expect(r.actions.map((a) => a.testid)).toEqual(['studio-readonly-link', 'if-open-in-data', 'if-item-more']);
    for (const a of r.actions) expect(a.inside, `action ${a.testid} ${a.width}px`).toBe(true);
    expect(r.row.scrollWidth, `row ${r.row.width}px holds ${r.row.scrollWidth}px`).toBeLessThanOrEqual(Math.ceil(r.row.width));
    expect(r.documentOverflowX).toBe(0);
  });

  test('CONTROL: on a wide row (1024 px) the title is whole, the link shows its text, and the tooltip is the internal id alone', async ({
    page,
  }, testInfo) => {
    const r = await readLeaf(page, CASES.leaf1024, testInfo);
    expect(r.title.clipped, `title ${r.title.width}px for ${r.title.scrollWidth}px of text`).toBe(false);
    expect(r.link.folded).toBe(false);
    expect(r.title.tooltip).toBe(LEAF_INTERNAL_ID);
    for (const a of r.actions) expect(a.inside, `action ${a.testid} ${a.width}px`).toBe(true);
  });

  test('CONTROL: at the 632 px row of a 1280 px window the title is whole, and the link folds only if the title would not fit beside it whole', async ({
    page,
  }, testInfo) => {
    // The link's whole width, read where it shows whole.
    const wide = await readLeaf(page, CASES.leaf1024, testInfo);
    expect(wide.link.folded).toBe(false);
    const r = await readLeaf(page, CASES.leaf632, testInfo);
    expect(r.title.clipped, `title ${r.title.width}px for ${r.title.scrollWidth}px of text`).toBe(false);
    expect(r.title.tooltip).toBe(LEAF_INTERNAL_ID);
    // The rule, from this page's own widths: whether the whole link fits
    // beside the whole title at 632 px depends on the font and the language
    // (live, in zh-CN, it does).
    const roomWithLinkWhole = r.titleRoom - (wide.link.width - r.link.width);
    expect(r.link.folded, `room ${roomWithLinkWhole}px with the link whole, title ${r.title.scrollWidth}px`).toBe(
      roomWithLinkWhole + 0.5 < r.title.scrollWidth,
    );
    for (const a of r.actions) expect(a.inside, `action ${a.testid} ${a.width}px`).toBe(true);
  });

  test('CONTROL: the link follows the row, folding when it narrows and unfolding when it widens again', async ({ page }, testInfo) => {
    await readLeaf(page, CASES.leaf1024, testInfo);
    await expect(page.getByTestId('studio-readonly-link')).not.toHaveAttribute('data-folded');
    await page.setViewportSize({ width: CASES.leaf422.row + HEADER_SIDE_PADDING, height: 400 });
    await expect(page.getByTestId('studio-readonly-link')).toHaveAttribute('data-folded', 'true');
    await page.setViewportSize({ width: CASES.leaf1024.row + HEADER_SIDE_PADDING, height: 400 });
    await expect(page.getByTestId('studio-readonly-link')).not.toHaveAttribute('data-folded');
  });
});
