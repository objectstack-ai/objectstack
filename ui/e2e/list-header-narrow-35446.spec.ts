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
 * GEOMETRY pin for objectstack#35446, the header half: an app list whose main
 * area narrows (the AI panel docked, a small window, the record drawer open)
 * draws a short header row: the title, New, and the 「⋯」 menu holding Import;
 * the description is not drawn. A full-width list keeps its full face. Since
 * objectstack#35548 that face, too, holds the description and Import in its
 * ⋮ rather than in the row (the list's 44px page bar).
 *
 * ## The rule
 *
 * The list page opts into `PageHeader`'s compact form (`compactBelow` in
 * `ObjectViewPageHeader`): below that width of the header itself, the header
 * drops the description and draws the folded actions. Other `PageHeader` pages
 * pass nothing and are unchanged.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * The rule reads the header's own width; happy-dom lays nothing out. The
 * vitest harness (`PageHeader.actionsFold-12705.test.tsx`) pins the logic
 * against a width model; this spec pins it against Chromium's layout, through
 * the list page's own header component. The bundling follows
 * `e2e/list-narrow-pinned-columns-35446.spec.ts`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: app-shell's `ObjectViewPageHeader` and the actions its page builds
 * for it (`useObjectViewHeaderChrome`: New, Import, the folded 「⋯」 menu as an
 * `action:bar`), `PageHeader`, and the `action:bar` renderer, bundled by Vite
 * from their source files and mounted in Chromium with React's client
 * renderer; the stylesheet is real Tailwind, compiled for the classes on the
 * page. The 「⋯」 menu is opened and Import run with real pointer clicks.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - The object, its description, the view title and the translator are
 *     literals (English keys answered by a small map); Import is recorded on
 *     the page, not run.
 *   - The width is set by a frame around the header, not by the AI panel: the
 *     rule reads the header's own box. 699 px is the main area the card
 *     measured with the AI panel docked in a 1167 px window; 1184 px is the
 *     list page's width at a 1440 px window with the sidebar open.
 *   - Fonts are Chromium's fallbacks. The assertions are which controls and
 *     text are drawn and that nothing in the row is clipped, not pixels.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const THEME_CSS = source('packages/components/src/index.css');
// The entry names workspace sources by path, never by package name: the e2e
// type-check program must import no workspace package (it builds nothing first).
const COMPONENTS = source('packages/components/src/index.ts');
const REACT_BINDINGS = source('packages/react/src/index.ts');
const PAGE_HEADER = source('packages/app-shell/src/views/objectViewPageHeader.tsx');
const HEADER_CHROME = source('packages/app-shell/src/views/objectViewHeaderChrome.tsx');

/** The main area with the AI panel docked in a 1167 px window (the card's case). */
const AI_PANEL_MAIN = 699;
/** The list page's width at a 1440 px window (see the header). */
const FULL_PAGE = 1184;

/** Short enough that the full-width header keeps every action labelled beside it. */
const DESCRIPTION = 'Open deals and their expected close dates';

/**
 * The view's label in the title 「Opportunities / VIEW」. Long enough that the
 * title is wider than 60 % of the narrow row in any font, the share the full
 * row keeps for its title beside the description.
 */
const VIEW_LABEL = 'Open opportunities this quarter';

interface Case {
  name: string;
  viewport: number;
  frame: number;
}

const ENTRY = '\0list-header-narrow:entry';

/** `@object-ui/<pkg>` to `packages/<pkg>/src`, and a subpath into that `src/`. */
function workspaceSources(): Plugin {
  return {
    name: 'list-header-narrow-workspace-src',
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

/** The page: the list header of the case named by `window.__case`, mounted with the client renderer. */
function entry(): Plugin {
  const code = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ${JSON.stringify(COMPONENTS)};
import { ActionProvider } from ${JSON.stringify(REACT_BINDINGS)};
import { ObjectViewPageHeader } from ${JSON.stringify(PAGE_HEADER)};
import { useObjectViewHeaderChrome } from ${JSON.stringify(HEADER_CHROME)};

const h = React.createElement;
const c = window.__case;
window.__imports = 0;
const TEXT = {
  'console.objectView.new': 'New',
  'console.objectView.import': 'Import',
  'console.objectView.importTitle': 'Import records',
};
const t = (key, opts) => TEXT[key] ?? (opts && opts.defaultValue) ?? key;
const objectDef = { name: 'opportunity', label: 'Opportunity', pluralLabel: 'Opportunities', icon: 'briefcase', description: ${JSON.stringify(DESCRIPTION)} };
const toolbarBar = { type: 'action:bar', location: 'list_toolbar', actions: [], maxVisible: 3, mobileMaxVisible: 0 };
const listFavorite = { isFavorite: false, toggle: () => {} };
const VIEW_LABEL = ${JSON.stringify(VIEW_LABEL)};

function Header() {
  const [, setShowImport] = React.useState(false);
  const openImport = (value) => { if (value) window.__imports += 1; setShowImport(value); };
  const chrome = useObjectViewHeaderChrome({
    objectCanCreate: true, createVisible: true, createDisabled: false,
    actions: { create: () => {} }, t, listActions: [], toolbarActionsWithDeepLink: [],
    identityImportEnabled: false, objectCanImport: true, importVisible: true, importDisabled: false,
    setShowImport: openImport, listFavorite, isEnvironmentList: false, toolbarBar,
    viewAccess: { refusal: null },
  });
  return h(ObjectViewPageHeader, {
    objectDef,
    titleSwitcher: h('span', { 'data-testid': 'view-switcher' }, VIEW_LABEL),
    titleLabel: VIEW_LABEL,
    objectListHref: '/apps/sales/opportunity',
    objectPluralLabel: () => 'Opportunities',
    objectDesc: (def) => def.description,
    createButton: chrome.createButton,
    importShown: chrome.importShown,
    setShowImport: openImport,
    importDisabled: false,
    t,
    listActions: [],
    isEnvironmentList: false,
    headerToolbarActions: [],
    environmentEntitlements: undefined,
    toolbarBar,
    listFavorite,
    personalizedMarker: null,
    foldedHeaderActions: chrome.foldedHeaderActions,
  });
}

const root = createRoot(document.getElementById('root'));
let mounts = 0;
// A fresh header: its fold keeps what it read on its first frame, so the
// spec mounts it again once the stylesheet is in, as a page load would.
window.__remount = () => root.render(
  h(MemoryRouter, { key: ++mounts, initialEntries: ['/apps/sales/opportunity/view/open'] },
    h(ActionProvider, null,
      h('div', { id: 'frame', className: 'bg-background', style: { width: c.frame + 'px' } }, h(Header)))),
);
window.__remount();
`;
  return {
    name: 'list-header-narrow-entry',
    resolveId: (id) => (id === 'list-header-narrow:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

/** Bundle the page once, from source, to one ES module held in memory. */
async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-list-header-narrow'),
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
        input: 'list-header-narrow:entry',
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

/** Mount the case, style it, and wait until the header holds still. */
async function mount(page: Page, c: Case): Promise<void> {
  await page.setViewportSize({ width: c.viewport, height: 900 });
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div id="root"></div></body></html>');
  await page.evaluate((value) => {
    (window as unknown as { __case: Case }).__case = value;
  }, c);
  await page.addScriptTag({ content: bundle, type: 'module' });
  await page.locator('[data-testid="page-header"]').waitFor({ state: 'attached', timeout: 30_000 });
  const compiled = new Set<string>();
  await styleUntilStable(page, compiled);
  await page.evaluate(() => document.fonts?.ready);
  // The header first measured itself unstyled; mount it afresh under the
  // stylesheet, as a real page load draws it, and style what it draws then.
  await page.evaluate(() => (window as unknown as { __remount: () => void }).__remount());
  await styleUntilStable(page, compiled);
  await page.evaluate(() => (window as unknown as { __remount: () => void }).__remount());
  // The header decides its face from its width after layout: wait for a face
  // that holds across 300 ms, then style whatever it drew.
  let last = '';
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="page-header"]');
      const cluster = document.querySelector('[data-testid="page-header-actions"]');
      return `${header?.getAttribute('data-compact')}:${cluster?.getAttribute('data-folded')}:${header?.textContent}`;
    });
    if (now === last) break;
    last = now;
    await page.waitForTimeout(300);
  }
  await styleUntilStable(page, compiled);
}

interface Reading {
  width: number;
  compact: boolean;
  folded: string | null;
  descriptionDrawn: boolean;
  importButton: boolean;
  newButton: boolean;
  /** Controls of the row whose box spills past the header's right edge. */
  spill: string[];
  /** The title is cut (its content wider than its box). */
  titleClipped: boolean;
  /** The title's box, its content, and the row's text block it sits in, in px. */
  title: { box: number; content: number; block: number; maxWidth: string };
}

async function read(page: Page): Promise<Reading> {
  return page.evaluate((description) => {
    const header = document.querySelector<HTMLElement>('[data-testid="page-header"]')!;
    const hr = header.getBoundingClientRect();
    const visible = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null;
    const descriptionEl = [...header.querySelectorAll('p')].find((p) => (p.textContent ?? '').includes(description)) ?? null;
    const spill = [...header.querySelectorAll<HTMLElement>('[data-testid="page-header-actions"] > *')]
      .filter((el) => el.getBoundingClientRect().right > hr.right + 0.5)
      .map((el) => el.getAttribute('data-testid') ?? el.tagName.toLowerCase());
    const h1 = header.querySelector('h1')!;
    return {
      width: Math.round(hr.width),
      compact: header.getAttribute('data-compact') === 'true',
      folded: document.querySelector('[data-testid="page-header-actions"]')?.getAttribute('data-folded') ?? null,
      descriptionDrawn: visible(descriptionEl),
      importButton: visible(header.querySelector('[data-testid="object-view-import-button"]')),
      newButton: visible(header.querySelector('[data-testid="object-view-new-button"]')),
      spill,
      titleClipped: h1.scrollWidth > h1.clientWidth + 1,
      title: {
        box: h1.clientWidth,
        content: h1.scrollWidth,
        block: h1.parentElement!.clientWidth,
        maxWidth: getComputedStyle(h1).maxWidth,
      },
    };
  }, DESCRIPTION);
}

function report(testInfo: import('@playwright/test').TestInfo, c: Case, r: Reading): void {
  testInfo.annotations.push({ type: `list-header-narrow@${c.name}`, description: JSON.stringify(r) });
  process.stdout.write(`[list-header-narrow ${c.name}] ${JSON.stringify(r)}\n`);
}

test.describe('app list header in a narrowed main area — no description, Import in the 「⋯」 (objectstack#35446)', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    bundle = await bundlePage();
  });

  test(`AI panel docked (${AI_PANEL_MAIN} px main area): title, New and the 「⋯」 holding Import; no description`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const c: Case = { name: 'aiPanel', viewport: 1167, frame: AI_PANEL_MAIN };
    await mount(page, c);
    const r = await read(page);
    report(testInfo, c, r);
    expect(r.compact, 'the list header did not take its compact form').toBe(true);
    expect(r.descriptionDrawn, 'the description is still drawn').toBe(false);
    expect(r.importButton, 'Import is still a button in the row').toBe(false);
    expect(r.newButton).toBe(true);
    expect(r.folded).toBe('true');
    expect(r.spill, 'a header control spills past the header').toEqual([]);
    expect(r.titleClipped, 'the title is cut').toBe(false);
    // Import is one click into the 「⋯」.
    await page.locator('[data-testid="page-header-actions"] button:not([data-testid="object-view-new-button"])').last().click();
    await page.getByRole('menuitem', { name: 'Import' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __imports: number }).__imports)).toBe(1);
  });

  // objectstack#35548 — the list's page bar draws no description and no Import
  // button at any width: both wait in its ⋮, beside the favorites entry. So
  // the full-width CONTROL now reads the full face (not compact, not folded)
  // with the two of them one click into the ⋮.
  test('CONTROL: on the full list page the bar is not compact; the description and Import are in the ⋮', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const c: Case = { name: 'fullPage1440', viewport: 1440, frame: FULL_PAGE };
    await mount(page, c);
    const r = await read(page);
    report(testInfo, c, r);
    expect(r.compact).toBe(false);
    expect(r.descriptionDrawn).toBe(false);
    expect(r.importButton).toBe(false);
    expect(r.newButton).toBe(true);
    expect(r.folded).toBe('false');
    expect(r.spill).toEqual([]);
    await page.locator('[data-testid="object-view-more-actions"]').click();
    await expect(page.getByTestId('object-view-description')).toHaveText(DESCRIPTION);
    await page.getByRole('menuitem', { name: 'Import' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __imports: number }).__imports)).toBe(1);
  });
});
