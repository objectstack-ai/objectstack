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
 * Acceptance pin for objectstack#35554: the object list page has no Actions
 * column, a selection swaps the page bar, the row's context menu ends with a
 * separated Delete, and a list with no declared `pagination` loads as it
 * scrolls and comes back to the row it was left at.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * The page bar and the list are siblings, the selection is drawn into the bar
 * through a portal, and "the last row is fully visible", "scroll to the end
 * loads more" and "back lands near row 60" are questions about layout and
 * scrolling, which jsdom does not have. The bundling follows
 * `e2e/list-narrow-pinned-columns-35446.spec.ts`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: the Console list page header (`ObjectViewPageHeader` with its chrome
 * hook), the view bar's switcher (`ObjectViewTitleSwitcher`, handed the list's
 * own count as the console hands it), plugin-list's `ListView` (its fetch, its windows and its handoff to
 * the grid), plugin-grid's `ObjectGrid`, the `data-table`, the selection bar,
 * the menus, the zh-Hans pack through the real `I18nProvider`, all bundled by
 * Vite from their source files and mounted in Chromium; the stylesheet is real
 * Tailwind compiled for the classes the page carries.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - The page column is a flex column holding the header and the list, the
 *     shape `ObjectView` draws; the shell (top bar, sidebar) is out of scope
 *     and absent, so the column is the viewport.
 *   - The rows (120 opportunities), the fields and the actions are literals
 *     shaped like HotCRM's opportunity list; the data source pages them by
 *     `$skip` / `$top` and answers `total`. Dispatched actions are recorded
 *     on the page, not run.
 *   - "Open record 60, come back" is a remount of the page column at the same
 *     address: what the list keeps across it is session storage, which a
 *     record page round trip keeps too.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const THEME_CSS = source('packages/components/src/index.css');
// The entry names workspace sources by path, never by package name: the e2e
// type-check program must import no workspace package (it builds nothing first).
const COMPONENTS = source('packages/components/src/index.ts');
const PLUGIN_GRID = source('packages/plugin-grid/src/index.tsx');
const PLUGIN_LIST = source('packages/plugin-list/src/index.tsx');
const FIELDS = source('packages/fields/src/index.tsx');
const REACT_BINDINGS = source('packages/react/src/index.ts');
const I18N = source('packages/i18n/src/index.ts');
const PAGE_HEADER = source('packages/app-shell/src/views/objectViewPageHeader.tsx');
const HEADER_CHROME = source('packages/app-shell/src/views/objectViewHeaderChrome.tsx');
const TITLE_SWITCHER = source('packages/app-shell/src/views/objectViewTitleSwitcher.tsx');

/** The two windows the card accepts at. */
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1167, height: 762 },
] as const;

const ROW_COUNT = 120;

interface Case {
  /** Declare `pagination` on the view (the list keeps its pager). */
  paged?: boolean;
  theme?: 'light' | 'dark';
}

const ENTRY = '\0list-no-actions-column:entry';

/** `@object-ui/<pkg>` to `packages/<pkg>/src`, and a subpath into that `src/`. */
function workspaceSources(): Plugin {
  return {
    name: 'list-no-actions-column-workspace-src',
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
import { MemoryRouter } from 'react-router-dom';
import ${JSON.stringify(COMPONENTS)};
import ${JSON.stringify(PLUGIN_GRID)};
import { ListView } from ${JSON.stringify(PLUGIN_LIST)};
import { registerAllFields } from ${JSON.stringify(FIELDS)};
import { ActionProvider, SchemaRendererProvider } from ${JSON.stringify(REACT_BINDINGS)};
import { I18nProvider, useObjectTranslation } from ${JSON.stringify(I18N)};
import { ObjectViewPageHeader } from ${JSON.stringify(PAGE_HEADER)};
import { useObjectViewHeaderChrome } from ${JSON.stringify(HEADER_CHROME)};
import { ObjectViewTitleSwitcher, ListRecordCountContext } from ${JSON.stringify(TITLE_SWITCHER)};

registerAllFields();
const h = React.createElement;
const c = window.__case;
window.__dispatched = [];
window.__finds = [];
if (c.theme === 'dark') document.documentElement.classList.add('dark');

const FIELDS = {
  id: { name: 'id', type: 'text' },
  name: { name: 'name', label: '商机名称', type: 'text' },
  account: { name: 'account', label: '客户', type: 'text' },
  stage: { name: 'stage', label: '阶段', type: 'text' },
  amount: { name: 'amount', label: '金额', type: 'currency' },
  probability: { name: 'probability', label: '赢率', type: 'percent' },
  owner: { name: 'owner', label: '负责人', type: 'text' },
  close_date: { name: 'close_date', label: '预计成交日期', type: 'date' },
};
const STAGES = ['资格审查', '需求分析', '方案报价', '商务谈判'];
const ROWS = Array.from({ length: ${ROW_COUNT} }, (_, i) => ({
  id: 'o' + String(i + 1).padStart(3, '0'),
  name: '商机 ' + (i + 1),
  account: '客户 ' + ((i % 17) + 1),
  stage: STAGES[i % STAGES.length],
  amount: 10000 + i * 1000,
  probability: (20 + (i % 4) * 20) / 100,
  owner: '销售 ' + ((i % 5) + 1),
  close_date: '2027-01-' + String((i % 28) + 1).padStart(2, '0'),
}));
const dataSource = {
  find: async (_object, params = {}) => {
    window.__finds.push({ skip: params.$skip ?? 0, top: params.$top });
    const skip = params.$skip ?? 0;
    const top = params.$top ?? ROWS.length;
    return { data: ROWS.slice(skip, skip + top), total: ROWS.length };
  },
  getObjectSchema: async (name) => ({ name, label: '商机', fields: FIELDS }),
};
const record = (name) => async () => { window.__dispatched.push(name); return { success: true }; };
const rowActionDefs = [
  { name: 'submit_approval', label: '提交审批', locations: ['list_item'] },
  { name: 'make_quote', label: '生成报价单', locations: ['list_item'] },
  { name: 'clone_opportunity', label: '复制', locations: ['list_item'] },
];
const bulkActionDefs = [
  { name: 'mass_update', label: '批量更新' },
  { name: 'mass_assign', label: '批量分配' },
  { name: 'mass_tag', label: '批量打标签' },
];
const handlers = Object.fromEntries([...rowActionDefs, ...bulkActionDefs].map((d) => [d.name, record(d.name)]));

const schema = {
  type: 'list-view',
  objectName: 'opportunity',
  viewType: 'grid',
  columns: ['name', 'account', 'stage', 'amount', 'probability', 'owner', 'close_date'],
  selection: { type: 'multiple' },
  rowActionDefs,
  bulkActionDefs,
  ...(c.paged ? { pagination: { pageSize: 50 } } : {}),
};

function Header() {
  const { t } = useObjectTranslation();
  const chrome = useObjectViewHeaderChrome({
    objectCanCreate: true, createVisible: true, createDisabled: false,
    actions: { create: () => {} }, t, listActions: [], toolbarActionsWithDeepLink: [],
    identityImportEnabled: false, objectCanImport: false, importVisible: false, importDisabled: false,
    setShowImport: () => {}, listFavorite: null, isEnvironmentList: false,
    toolbarBar: { type: 'action:bar', location: 'list_toolbar', actions: [], maxVisible: 3, mobileMaxVisible: 0 },
    viewAccess: { refusal: null },
  });
  return h(ObjectViewPageHeader, {
    objectDef: { name: 'opportunity', label: '商机', pluralLabel: '商机', icon: 'briefcase' },
    objectPluralLabel: () => '商机',
    objectDesc: () => undefined,
    createButton: chrome.createButton,
    importShown: false,
    setShowImport: () => {},
    importDisabled: false,
    t,
    listActions: [],
    isEnvironmentList: false,
    headerToolbarActions: [],
    environmentEntitlements: undefined,
    toolbarBar: { type: 'action:bar', location: 'list_toolbar', actions: [], maxVisible: 3, mobileMaxVisible: 0 },
    listFavorite: null,
    foldedHeaderActions: chrome.foldedHeaderActions,
  });
}

// The view bar's lead, as the console draws it (objectstack#35548): the real
// switcher, fed the list's own count through ListRecordCountContext.
function ViewBarLead({ recordCount, layout }) {
  const { t } = useObjectTranslation();
  return h(ListRecordCountContext.Provider, { value: { count: recordCount, layout } },
    h(ObjectViewTitleSwitcher, {
      views: [{ id: 'open', label: '进行中商机', type: 'grid', authored: true }],
      activeViewId: 'open',
      activeLabel: '进行中商机',
      onViewChange: () => {},
      t,
    }));
}

const root = createRoot(document.getElementById('root'));
let mounts = 0;
window.__remount = () => root.render(
  h(I18nProvider, { key: ++mounts, config: { defaultLanguage: 'zh-CN', fallbackLanguage: 'en', detectBrowserLanguage: false } },
    h(MemoryRouter, { initialEntries: ['/apps/sales/opportunity/view/open'] },
      h(ActionProvider, { handlers },
        h(SchemaRendererProvider, { dataSource },
          h('div', { id: 'page-column', className: 'h-screen flex flex-col bg-background min-w-0 overflow-hidden' },
            h(Header),
            h('div', { className: 'flex-1 min-h-0 flex flex-col' },
              h(ListView, { schema, dataSource, toolbarLeading: (state) => h(ViewBarLead, state), onEdit: () => window.__dispatched.push('edit'), onDelete: () => window.__dispatched.push('delete') }))))))),
);
window.__unmount = () => root.render(null);
window.__remount();
`;
  return {
    name: 'list-no-actions-column-entry',
    resolveId: (id) => (id === 'list-no-actions-column:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    cacheDir: path.join(os.tmpdir(), 'objectui-list-no-actions-column'),
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
        input: 'list-no-actions-column:entry',
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
const compiled = new Set<string>();
/** The last stylesheet compiled: a mount starts from it (see `mount`). */
let stylesheet = '';

/** Compile the stylesheet until the page's class set stops growing. */
async function styleUntilStable(page: Page): Promise<void> {
  const classesOnPage = () =>
    page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('[class]')].flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)).filter(Boolean),
      ),
    ]);
  for (let round = 0; ; round++) {
    const candidates = await classesOnPage();
    if (round > 0 && candidates.every((cls) => compiled.has(cls))) break;
    if (round === 6) throw new Error('the page kept adding classes; the stylesheet never caught up');
    candidates.forEach((cls) => compiled.add(cls));
    const css = await tailwindFor([...compiled]);
    stylesheet = css;
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

/**
 * The fixture page at a real origin: the list keeps its scroll position in
 * session storage, which an `about:blank` page (an opaque origin) refuses.
 */
const FIXTURE_URL = 'http://list-fixture.test/apps/sales/opportunity/view/open';
async function openFixturePage(page: Page, html: string): Promise<void> {
  await page.route(FIXTURE_URL, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto(FIXTURE_URL);
  await page.unroute(FIXTURE_URL);
}

async function mount(page: Page, viewport: { width: number; height: number }, c: Case = {}): Promise<void> {
  await page.setViewportSize(viewport);
  // The list asks for its next window while its scroll box is near its end,
  // which an unstyled box (no height bound) always is: a page mounted before
  // its stylesheet would load every row at once, which the console, whose
  // stylesheet is there first, never does. So the page is styled BEFORE the
  // list mounts: the first mount of a worker is a throwaway that collects the
  // page's classes, and every mount then starts from the compiled sheet.
  if (!stylesheet) {
    await page.setContent('<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div id="root"></div></body></html>');
    await page.evaluate((value) => {
      (window as unknown as { __case: Case }).__case = value;
    }, c);
    await page.addScriptTag({ content: bundle, type: 'module' });
    await page.getByText('商机 1', { exact: true }).waitFor({ timeout: 30_000 });
    await styleUntilStable(page);
  }
  await openFixturePage(page, '<!doctype html><html><head><style>html,body{margin:0}</style><style id="tailwind"></style></head><body><div id="root"></div></body></html>');
  await page.evaluate(({ value, css }) => {
    (window as unknown as { __case: Case }).__case = value;
    document.getElementById('tailwind')!.textContent = css;
    try { window.sessionStorage.clear(); } catch { /* a fresh page holds nothing */ }
  }, { value: c, css: stylesheet });
  await page.addScriptTag({ content: bundle, type: 'module' });
  await page.getByText('商机 1', { exact: true }).waitFor({ timeout: 30_000 });
  await styleUntilStable(page);
}

/** A screenshot kept in the test's output folder and attached to its report. */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(name);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

const rowCheckbox = (page: Page, name: string) =>
  page.locator('tr', { has: page.getByText(name, { exact: true }) }).getByRole('checkbox');

const loadedRows = (page: Page) => page.locator('tbody tr:has([data-slot="row-leading-cell"])').count();

for (const viewport of VIEWPORTS) {
  test.describe(`list page without an Actions column at ${viewport.width}×${viewport.height} (objectstack#35554)`, () => {
    test.beforeAll(async () => {
      test.setTimeout(240_000);
      if (!bundle) bundle = await bundlePage();
    });

    test('no Actions column, no row-end control on hover; the last column reads in full', async ({ page }) => {
      await mount(page, viewport);
      await expect(page.locator('th[data-column-key="_actions"]')).toHaveCount(0);
      await page.getByText('商机 3', { exact: true }).hover();
      await expect(page.getByTestId('row-action-trigger')).toHaveCount(0);
      const fits = await page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
        const last = [...document.querySelectorAll<HTMLElement>('thead th')].pop()!;
        const boxRect = box.getBoundingClientRect();
        const rect = last.getBoundingClientRect();
        return { lastRight: rect.right, boxRight: boxRect.left + box.clientWidth, key: last.getAttribute('data-column-key') };
      });
      expect(fits.key).toBe('close_date');
      expect(fits.lastRight).toBeLessThanOrEqual(fits.boxRight + 0.5);
    });

    test('two rows selected: the page bar reads 「已选 2 条」 with the bulk actions, nothing floats over the rows; Cancel restores it', async ({ page }, testInfo) => {
      await mount(page, viewport);
      await rowCheckbox(page, '商机 1').click();
      await rowCheckbox(page, '商机 2').click();
      const bar = page.getByTestId('list-selection-page-bar');
      await expect(bar).toBeVisible();
      await expect(bar.getByTestId('list-selection-count')).toHaveText('已选 2 条');
      await expect(bar.getByTestId('bulk-action-mass_update')).toBeVisible();
      await expect(bar.getByTestId('bulk-action-mass_assign')).toBeVisible();
      await expect(bar.getByTestId('bulk-action-mass_tag')).toHaveCount(0);
      await expect(page.getByTestId('bulk-actions-bar')).toHaveCount(0);
      await expect(page.getByTestId('page-header')).toBeHidden();
      // Nothing is drawn over the bottom of the list: the point just inside
      // the scroll box's bottom edge answers the table.
      const bottomHit = await page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
        const r = box.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + 40, Math.min(r.bottom, window.innerHeight) - 4);
        return !!hit && box.contains(hit);
      });
      expect(bottomHit).toBe(true);
      await shoot(page, testInfo, `selected-2-${viewport.width}.png`);
      await bar.getByTestId('list-selection-cancel').click();
      await expect(bar).toBeHidden();
      await expect(page.getByTestId('page-header')).toBeVisible();
    });

    test('one row and two rows expose different actions', async ({ page }) => {
      await mount(page, viewport);
      await rowCheckbox(page, '商机 1').click();
      const bar = page.getByTestId('list-selection-page-bar');
      await expect(bar.getByTestId('list-selection-count')).toHaveText('已选 1 条');
      await expect(bar.getByTestId('row-action-inline-submit_approval')).toBeVisible();
      await expect(bar.getByTestId('row-action-inline-make_quote')).toBeVisible();
      await expect(bar.getByTestId('bulk-action-mass_update')).toHaveCount(0);
      await bar.getByTestId('row-action-inline-make_quote').click();
      await expect.poll(() => page.evaluate(() => (window as any).__dispatched)).toContain('make_quote');
      await rowCheckbox(page, '商机 2').click();
      await expect(bar.getByTestId('row-action-inline-submit_approval')).toHaveCount(0);
      await expect(bar.getByTestId('bulk-action-mass_update')).toBeVisible();
    });

    test('right-click on a row: its actions, 「删除」 last after a separator', async ({ page }) => {
      await mount(page, viewport);
      await page.getByText('商机 4', { exact: true }).click({ button: 'right' });
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      const items = menu.getByRole('menuitem');
      await expect(items.last()).toHaveAttribute('data-testid', 'row-action-builtin-delete');
      await expect(items.last()).toHaveText(/删除/);
      await expect(menu.getByTestId('row-action-delete-separator')).toHaveCount(1);
      const order = await menu.evaluate((el) =>
        [...el.querySelectorAll('[role="menuitem"], [role="separator"]')].map((n) => n.getAttribute('data-testid') ?? n.getAttribute('role')),
      );
      expect(order.slice(-2)).toEqual(['row-action-delete-separator', 'row-action-builtin-delete']);
    });

    test('no pager; scrolling to the end loads more; header select-all offers 「选择全部 120 条」', async ({ page }) => {
      await mount(page, viewport);
      await expect(page.getByRole('button', { name: /下一页|Next page/ })).toHaveCount(0);
      await expect(page.getByTestId('list-view-switcher-count')).toHaveText('120');
      expect(await loadedRows(page)).toBe(50);
      await page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
        box.scrollTop = box.scrollHeight;
      });
      await expect.poll(() => loadedRows(page)).toBe(100);
      await page.locator('thead').getByRole('checkbox').click();
      await styleUntilStable(page);
      const bar = page.getByTestId('list-selection-page-bar');
      await expect(bar.getByTestId('list-selection-count')).toHaveText('已选 100 条');
      await expect(bar.getByTestId('list-selection-select-all')).toHaveText('选择全部 120 条');
      await bar.getByTestId('list-selection-select-all').click();
      await expect(bar.getByTestId('list-selection-count')).toContainText('120');
    });

    test('opening row 60 and coming back lands near row 60', async ({ page }) => {
      await mount(page, viewport);
      await page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
        box.scrollTop = box.scrollHeight;
      });
      await expect.poll(() => loadedRows(page)).toBe(100);
      await page.getByText('商机 60', { exact: true }).scrollIntoViewIfNeeded();
      // Let the kept position settle (it is written on the next frame).
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.evaluate(() => (window as any).__unmount());
      await page.evaluate(() => (window as any).__remount());
      await page.getByText('商机 1', { exact: true }).waitFor();
      await expect(page.getByText('商机 60', { exact: true })).toBeInViewport();
    });

    test('a view that declares `pagination` still pages', async ({ page }) => {
      await mount(page, viewport, { paged: true });
      await expect(page.getByRole('button', { name: /下一页|Next page/ })).toBeVisible();
      expect(await loadedRows(page)).toBe(50);
      await page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('[data-table-scroll-box]')!;
        box.scrollTop = box.scrollHeight;
      });
      await page.waitForTimeout(500);
      expect(await loadedRows(page)).toBe(50);
    });
  });
}

test.describe('visual acceptance at 1280×800, zh-CN (objectstack#35554)', () => {
  test.use({ deviceScaleFactor: 2 });
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    if (!bundle) bundle = await bundlePage();
  });
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: at rest, one selected, two selected`, async ({ page }, testInfo) => {
      await mount(page, VIEWPORTS[0], { theme });
      await shoot(page, testInfo, `rest-${theme}.png`);
      await rowCheckbox(page, '商机 1').click();
      await styleUntilStable(page);
      await shoot(page, testInfo, `selected-1-${theme}.png`);
      await rowCheckbox(page, '商机 2').click();
      await styleUntilStable(page);
      await shoot(page, testInfo, `selected-2-${theme}.png`);
      await page.getByText('商机 5', { exact: true }).click({ button: 'right' });
      await styleUntilStable(page);
      await shoot(page, testInfo, `context-menu-${theme}.png`);
    });
  }
});
