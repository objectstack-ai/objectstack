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
 * GEOMETRY and INTERACTION pin for objectstack#35595 (the record page's tab
 * row) and objectstack#35596 (the 概览 tab's right rail), zh-CN.
 *
 *   - The tab row folds by WIDTH only: a row sized from its own measured
 *     tabs to hold the first eight draws exactly those and folds the tail
 *     into 「更多 N ▾」, whose items keep their counts; CONTROL, the same page
 *     at the 1184 px a 1440 window leaves draws every tab.
 *   - On 概览 the stage path and the key fields are at the top across the
 *     whole width — both columns; CONTROL, the details column beside the rail
 *     is narrower than they are. Since objectstack#35891 the default page
 *     draws no strip, so the fixture places one in the `highlights` slot, as
 *     an authored page does.
 *   - The rail is the 概览 tab's: another tab open draws no rail and no
 *     strip; CONTROL, back on 概览 both are drawn again.
 *   - A rail card's title opens its tab; CONTROL, the 概览 tab returns.
 *   - A card measures radius 8, a 13 px title with a grey count, 26 px rows.
 *   - objectstack#35783: an open list's tab is its menu — 「左移」 / 「右移」
 *     move it, 「隐藏」 sends it to 「更多」 — and 「更多」's 「恢复默认顺序」
 *     brings the default back. Order only: no width is read.
 *
 * ⚠️ A Playwright spec and not a vitest test: jsdom lays nothing out, so a
 * width read there is 0 and the row's fold — which reads the row's own width
 * — never runs. The vitest pins (`RecordTabRow.widthOnly-35595`,
 * `RecordPageColumns.test.tsx`) hold the same rules against a width model.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: plugin-detail's `RecordPageColumns`, `RecordTabRow` and
 * `RecordSummaryRail`, the page synthesizer (`buildDefaultPageSchema` →
 * `buildDefaultPageColumns`), the related-count store and the zh-Hans pack
 * through `I18nProvider`, bundled by Vite from their source files and mounted
 * in Chromium with React's client renderer; the stylesheet is real Tailwind,
 * compiled for the classes on the page. Tabs and card titles are clicked
 * with real pointer events. The bundling follows
 * `e2e/list-header-narrow-35446.spec.ts`.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - The blocks inside the page (`record:details`, `record:highlights`,
 *     `record:path`, the related lists, the 动态 stream) are boxes of a fixed
 *     height drawing their type, as the vitest pins stub them; the stream box
 *     reports a size of 4 the way the real stream does. What is measured is
 *     the page around them.
 *   - The data source is a literal: eight related lists (two of them empty),
 *     two attachments, one approval waiting on a named approver.
 *   - The record page's width is set by a frame, not by the shell: for the
 *     fold, a width computed from what the row measures its own tabs at
 *     (below); 1184 px (a 1440 window with the sidebar open) for its
 *     CONTROL; and 1024 px (a 1280 × 800 window with the sidebar open) for
 *     the 概览 placement and the rail.
 *   - Fonts are whatever the machine has, and the fold does not depend on
 *     them. A CJK label is about 13 px a glyph where a CJK font is installed
 *     and about 8 px where none is (measured: 概览 26 px against 16 px), so
 *     on a runner without one the whole row is ~580 px and fits a page any
 *     fixed width could fold elsewhere. The fold case therefore sizes the
 *     row from the row's own measurer: room for the first eight tabs and
 *     「更多」, and half a tab short of the ninth. The assertions are which
 *     tabs are drawn, edges and sizes, not pixels of glyphs.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const THEME_CSS = source('packages/components/src/index.css');
// The entry names workspace sources by path, never by package name: the e2e
// type-check program must import no workspace package (it builds nothing first).
const REACT_BINDINGS = source('packages/react/src/index.ts');
const I18N = source('packages/i18n/src/index.ts');
const PAGE_COLUMNS = source('packages/plugin-detail/src/RecordPageColumns.tsx');
const SYNTH_COLUMNS = source('packages/plugin-detail/src/synth/recordPageColumns.ts');
const SYNTH_PAGE = source('packages/plugin-detail/src/synth/buildDefaultPageSchema.ts');
const TIMELINE_STREAM = source('packages/plugin-detail/src/recordTimelineStream.ts');
// The store module `@object-ui/components` re-exports: one module, one store, in the bundle.
const COUNT_STORE = source('packages/components/src/hooks/related-count-store.ts');

/** A 1280 × 800 window with the 256 px sidebar open. */
const PAGE_1280 = 1024;
/** A 1440 window with the sidebar open (the list specs' full page). */
const PAGE_1440 = 1184;
/** The fold case's first draw (a 900 px window with the 256 px sidebar open): it is measured, then resized. */
const PAGE_900 = 644;
/** The space between two tabs (`RecordTabRow`'s `gap-4`). */
const TAB_GAP = 16;
/** How many tabs the fold case sizes its row to hold. */
const FOLD_KEEPS = 8;

interface Case {
  name: string;
  viewport: number;
  frame: number;
}

const ENTRY = '\0record-tabs-rail:entry';
const REACT_SHIM = '\0record-tabs-rail:react';
const STUB = '\0record-tabs-rail:stub';

/** `@object-ui/<pkg>` to `packages/<pkg>/src`; the page's `@object-ui/react` to the shim. */
function workspaceSources(): Plugin {
  return {
    name: 'record-tabs-rail-workspace-src',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (id === 'record-tabs-rail:react-real') {
        return this.resolve(REACT_BINDINGS, importer, { skipSelf: true });
      }
      const m = /^@object-ui\/([a-z0-9-]+)(?:\/(.+))?$/.exec(id);
      if (!m) return null;
      const [, pkg, sub] = m;
      // The page's blocks are fixture boxes: plugin-detail's own modules read
      // `SchemaRenderer` from the shim, everything else from the real module.
      if (pkg === 'react' && !sub && importer && importer.includes(`${path.sep}plugin-detail${path.sep}src${path.sep}`)) {
        return REACT_SHIM;
      }
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

/** The fixture block: a box of a fixed height naming its type; the stream reports a size. */
const STUB_CODE = `
import * as React from 'react';
import { RecordTimelinePanelContext, RecordTimelineCountContext } from ${JSON.stringify(TIMELINE_STREAM)};
const HEIGHT = { 'record:details': 360, 'record:highlights': 56, 'record:path': 40, 'record:related_list': 240, 'record:activity': 96, 'record:attachments': 120, 'record:approvals': 120 };
export function SchemaRenderer({ schema }) {
  const panel = React.useContext(RecordTimelinePanelContext);
  const reporter = React.useContext(RecordTimelineCountContext);
  const type = schema && schema.type;
  React.useEffect(() => {
    if (type !== 'record:activity') return;
    if (panel) panel.onCount(4);
    else if (reporter) reporter(4);
  }, [type, panel, reporter]);
  return React.createElement('div', {
    'data-node': type,
    className: 'rounded-md border border-dashed border-border text-xs text-muted-foreground',
    style: { height: (HEIGHT[type] || 48) + 'px' },
  }, type);
}
`;

const SHIM_CODE = `
export * from 'record-tabs-rail:react-real';
export { SchemaRenderer } from ${JSON.stringify(STUB)};
`;

/** The page: the synthesized record page at the case's width, the host holding the open tab. */
function entry(): Plugin {
  const code = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { RecordContextProvider } from 'record-tabs-rail:react-real';
import { I18nProvider } from ${JSON.stringify(I18N)};
import { RelatedCountStore } from ${JSON.stringify(COUNT_STORE)};
import { RecordPageColumns } from ${JSON.stringify(PAGE_COLUMNS)};
import { buildDefaultPageColumns, recordPageTierFor } from ${JSON.stringify(SYNTH_COLUMNS)};
import { buildDefaultHighlights, buildDefaultPageSchema } from ${JSON.stringify(SYNTH_PAGE)};

const h = React.createElement;
const c = window.__case;
const RELATED = [
  ['contact', 'account_id', '联系人', 4],
  ['opportunity', 'account_id', '商机', 3],
  ['case', 'account_id', '个案', 0],
  ['contract', 'account_id', '合同', 1],
  ['quote', 'account_id', '报价单', 2],
  ['invoice', 'account_id', '发票', 0],
  ['campaign_member', 'account_id', '活动成员', 5],
  ['task', 'what_id', '任务', 6],
];
const TOTALS = Object.fromEntries(RELATED.map(([o, , , n]) => [o, n]));
TOTALS.sys_attachment = 2;
const rowsOf = (object, n) => Array.from({ length: Math.min(n, 5) }, (_, i) => ({
  id: object + '-' + i, name: object + ' ' + (i + 1), file_name: 'file-' + (i + 1) + '.pdf', size: 2048 * (i + 1),
}));
const dataSource = {
  find: async (object) => ({ data: rowsOf(object, TOTALS[object] || 0), total: TOTALS[object] || 0 }),
  getObjectSchema: async () => ({ fields: { name: { type: 'text' } } }),
};
const approvals = {
  available: true,
  requests: [{ id: 'req-1' }],
  pendingRequest: { id: 'req-1', step_label: '经理审批', pending_approvers: ['u2'], pending_approver_names: { u2: '王经理' } },
};
const ACCOUNT = { name: 'account', label: '客户', enable: { files: true }, fields: { name: { type: 'text' }, phone: { type: 'phone' }, rating: { type: 'select' } } };
const STRIP = {
  highlightFields: ['phone'],
  statusField: 'rating',
  stages: [{ value: 'cold', label: '冷' }, { value: 'warm', label: '温' }, { value: 'hot', label: '热' }],
};
// Since objectstack#35891 the default page draws no strip; the stage path and
// the key fields are placed the way an author places them, in the highlights
// slot, and the columns lay that strip out as before.
const page = buildDefaultPageSchema(ACCOUNT, {
  related: RELATED.map(([objectName, relationshipField, title]) => ({ objectName, relationshipField, title })),
  ...STRIP,
  approvals: { count: 1, node: { approvals, currentUserId: 'u1' } },
  slots: { highlights: buildDefaultHighlights(ACCOUNT, STRIP) },
});
const columns = buildDefaultPageColumns(page);

function Host() {
  const [open, setOpen] = React.useState(undefined);
  return h(RecordPageColumns, {
    tier: recordPageTierFor(c.frame),
    columns,
    enlargedRelated: open,
    onEnlargeRelated: setOpen,
    onCloseEnlargedRelated: () => setOpen(undefined),
    relatedFieldsOf: () => ({ name: { type: 'text' } }),
  });
}

const root = createRoot(document.getElementById('root'));
let mounts = 0;
// A fresh page: the row keeps what it measured on its first frame, so the
// spec mounts it again once the stylesheet is in, as a page load would.
window.__remount = () => {
  RelatedCountStore._reset();
  root.render(
    h(I18nProvider, { key: ++mounts, config: { defaultLanguage: 'zh', detectBrowserLanguage: false } },
      h(RecordContextProvider, { objectName: 'account', recordId: 'acc-1', data: { id: 'acc-1', name: '示例客户' }, dataSource },
        h('div', { id: 'frame', className: 'bg-background', style: { width: c.frame + 'px' } }, h(Host)))),
  );
};
window.__remount();
`;
  return {
    name: 'record-tabs-rail-entry',
    resolveId: (id) => (id === 'record-tabs-rail:entry' ? ENTRY : id === REACT_SHIM || id === STUB ? id : null),
    load: (id) => (id === ENTRY ? code : id === REACT_SHIM ? SHIM_CODE : id === STUB ? STUB_CODE : null),
  };
}

/** Bundle the page once, from source, to one ES module held in memory. */
async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-record-tabs-rail'),
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
        input: 'record-tabs-rail:entry',
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

/** What the row and the rail show, as one string: the page holds still when it stops changing. */
const face = (page: Page) =>
  page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent).join('|');
    const more = document.querySelector('[data-record-tab-more]')?.textContent ?? '';
    const cards = [...document.querySelectorAll('[data-record-summary-card]')]
      .filter((el) => !(el as HTMLElement).hidden)
      .map((el) => el.textContent)
      .join('|');
    return `${tabs}#${more}#${cards}`;
  });

async function settle(page: Page, compiled: Set<string>): Promise<void> {
  let last = '';
  for (let i = 0; i < 20; i++) {
    const now = await face(page);
    if (now === last) break;
    last = now;
    await page.waitForTimeout(300);
  }
  await styleUntilStable(page, compiled);
}

/** Mount the case, style it, and wait until the row and the rail hold still. */
async function mount(page: Page, c: Case): Promise<Set<string>> {
  await page.setViewportSize({ width: c.viewport, height: 800 });
  await page.setContent('<!doctype html><html lang="zh-CN"><head><style>html,body{margin:0}</style></head><body><div id="root"></div></body></html>');
  await page.evaluate((value) => {
    (window as unknown as { __case: Case }).__case = value;
  }, c);
  await page.addScriptTag({ content: bundle, type: 'module' });
  await page.locator('[data-page-type="record"]').waitFor({ state: 'attached', timeout: 30_000 });
  const compiled = new Set<string>();
  await styleUntilStable(page, compiled);
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(() => (window as unknown as { __remount: () => void }).__remount());
  await settle(page, compiled);
  return compiled;
}

interface RowReading {
  shown: string[];
  more: string | null;
  /** Tabs whose box spills past the row's right edge. */
  spill: string[];
  rowWidth: number;
  /** Each drawn tab's width, in order. */
  widths: number[];
  /** What the row measures each tab of the page at, in order (its off-screen measurer), to 0.1 px. */
  measured: number[];
  /** What the row measures its 「更多 N ▾」 trigger at, to 0.1 px. */
  moreMeasured: number;
  /** The row's width, unrounded. */
  rowExact: number;
}

const readRow = (page: Page): Promise<RowReading> =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-record-tab-row]')!;
    const rr = row.getBoundingClientRect();
    const tabs = [...row.querySelectorAll<HTMLElement>('[role="tab"]')];
    return {
      shown: tabs.map((el) => el.getAttribute('data-record-tab') ?? ''),
      more: row.querySelector('[data-record-tab-more]')?.textContent ?? null,
      spill: [...tabs, ...row.querySelectorAll<HTMLElement>('[data-record-tab-more]')]
        .filter((el) => el.getBoundingClientRect().right > rr.right + 0.5)
        .map((el) => el.getAttribute('data-record-tab') ?? 'more'),
      rowWidth: Math.round(rr.width),
      widths: tabs.map((el) => Math.round(el.getBoundingClientRect().width)),
      measured: [...document.querySelectorAll<HTMLElement>('[data-record-tab-measure]')].map(
        (el) => Math.round(el.getBoundingClientRect().width * 10) / 10,
      ),
      moreMeasured:
        Math.round((document.querySelector<HTMLElement>('[data-record-tab-measure-more]')?.getBoundingClientRect().width ?? 0) * 10) / 10,
      rowExact: rr.width,
    };
  });

/** Every tab the page offers, in order: 概览, the eight lists, 附件, 审批, 动态. */
const ALL_TABS = [
  'overview',
  'contact.account_id',
  'opportunity.account_id',
  'case.account_id',
  'contract.account_id',
  'quote.account_id',
  'invoice.account_id',
  'campaign_member.account_id',
  'task.what_id',
  'attachments',
  'approvals',
  'timeline',
];

function report(testInfo: import('@playwright/test').TestInfo, name: string, reading: unknown): void {
  testInfo.annotations.push({ type: `record-tabs-rail@${name}`, description: JSON.stringify(reading) });
  process.stdout.write(`[record-tabs-rail ${name}] ${JSON.stringify(reading)}\n`);
}

const box = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), width: Math.round(r.width) };
  }, selector);

test.describe('the record page\'s tabs and 概览 rail, zh-CN (objectstack#35595, objectstack#35596)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one engine is enough for a layout pin');

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    bundle = await bundlePage();
  });

  test('a row with room for eight tabs draws those eight and folds the tail into 「更多 N ▾」, whose items keep their counts', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    // Draw once to read what the row measures each tab at, in this machine's
    // fonts, and what the page around the row takes.
    await mount(page, { name: 'foldMeasure', viewport: 1280, frame: PAGE_900 });
    const first = await readRow(page);
    report(testInfo, 'foldMeasure', first);
    expect(first.measured).toHaveLength(ALL_TABS.length);
    const sum = (widths: number[]) => widths.reduce((a, b) => a + b, 0) + TAB_GAP * Math.max(0, widths.length - 1);
    // The row the page draws: the first eight with their gaps, a gap, 「更多」 —
    // and half of the ninth tab (with its gap) to spare, so it fits no ninth.
    const kept = sum(first.measured.slice(0, FOLD_KEEPS));
    const ninth = first.measured[FOLD_KEEPS] + TAB_GAP;
    const row = kept + TAB_GAP + first.moreMeasured + ninth / 2;
    const frame = Math.round(PAGE_900 - first.rowExact + row);
    // The precondition that makes this a fold and not a no-op: every tab does not fit the row.
    expect(sum(first.measured), 'the tabs fit the row, so nothing can fold').toBeGreaterThan(row);
    await mount(page, { name: 'fold', viewport: 1280, frame });
    const r = await readRow(page);
    report(testInfo, 'fold', { frame, row, ...r });
    expect(Math.abs(r.rowExact - row), 'the row is not the width it was sized to').toBeLessThan(1);
    expect(r.more, 'no 「更多」 on a row narrower than its tabs').toMatch(/^更多 \d+$/);
    const folded = Number(r.more!.replace('更多 ', ''));
    // Width alone decides: the row keeps the FRONT of the order, empty lists
    // included — exactly the eight it has room for, no fewer and no more.
    expect(r.shown).toEqual(ALL_TABS.slice(0, FOLD_KEEPS));
    expect(folded).toBe(ALL_TABS.length - FOLD_KEEPS);
    expect(r.spill, 'a tab spills past the row').toEqual([]);
    await page.locator('[data-record-tab-more]').click();
    const items = page.getByRole('menuitem');
    await expect(items).toHaveCount(folded);
    const menu = await items.evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute('data-record-tab-menu-item'),
        count: el.querySelector('[data-record-tab-count]')?.textContent ?? null,
        dot: !!el.querySelector('[data-record-tab-dot]'),
      })),
    );
    report(testInfo, 'fold-menu', menu);
    expect(menu.map((m) => m.id)).toEqual(ALL_TABS.slice(r.shown.length));
    // The folded lists keep their numbers; 审批 its dot; 动态 its size.
    const byId = Object.fromEntries(menu.map((m) => [m.id, m]));
    expect(byId['task.what_id']?.count).toBe('6');
    expect(byId['approvals']?.dot).toBe(true);
    expect(byId['timeline']?.count).toBe('4');
  });

  test('CONTROL: the same page at 1184 px draws every tab, the empty ones muted, and no 「更多」', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await mount(page, { name: 'full1184', viewport: 1440, frame: PAGE_1440 });
    const r = await readRow(page);
    report(testInfo, 'full1184', r);
    expect(r.more).toBeNull();
    expect(r.shown).toEqual(ALL_TABS);
    expect(r.spill).toEqual([]);
    const empty = await page.locator('[data-record-tab-empty]').evaluateAll((els) => els.map((el) => el.getAttribute('data-record-tab')));
    expect(empty).toEqual(['case.account_id', 'invoice.account_id']);
    const muted = await page
      .locator('[data-record-tab="case.account_id"] [data-record-tab-label]')
      .evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(muted).toBeLessThan(1);
    expect(await page.locator('[data-record-tab="case.account_id"] [data-record-tab-count]').count()).toBe(0);
  });

  test('1280 × 800: on 概览 the stage path and the key fields span both columns, above them', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await mount(page, { name: 'overview1280', viewport: 1280, frame: PAGE_1280 });
    const strip = await box(page, '[data-record-overview-strip]');
    const details = await box(page, '[data-record-column="details"]');
    const rail = await box(page, '[data-record-column="right"]');
    const row = await box(page, '[data-record-tab-row]');
    report(testInfo, 'overview1280', { strip, details, rail, row });
    expect(strip && details && rail && row).toBeTruthy();
    // Across the whole width: from the details' left edge to the rail's right edge.
    expect(Math.abs(strip!.left - details!.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(strip!.right - rail!.right)).toBeLessThanOrEqual(1);
    // Below the tab row, above both columns.
    expect(strip!.top).toBeGreaterThanOrEqual(row!.top);
    expect(details!.top).toBeGreaterThan(strip!.top);
    expect(rail!.top).toBeGreaterThan(strip!.top);
    // CONTROL: the details column beside the rail is narrower than the strip.
    expect(details!.width).toBeLessThan(strip!.width - 200);
  });

  test('the rail and the strip are 概览\'s: another tab draws neither; CONTROL, 概览 brings both back', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const compiled = await mount(page, { name: 'otherTab1280', viewport: 1280, frame: PAGE_1280 });
    // CONTROL first: on 概览 both are drawn.
    await expect(page.locator('[data-record-column="right"]')).toHaveCount(1);
    await expect(page.locator('[data-record-overview-strip]')).toHaveCount(1);
    await page.locator('[data-record-tab="contact.account_id"]').click();
    await expect(page.locator('[data-record-tab="contact.account_id"]')).toHaveAttribute('aria-selected', 'true');
    await settle(page, compiled);
    const opened = await page.evaluate(() => ({
      rail: document.querySelectorAll('[data-record-column="right"]').length,
      cards: document.querySelectorAll('[data-record-summary-card]').length,
      strip: document.querySelectorAll('[data-record-overview-strip], [data-node="record:highlights"], [data-node="record:path"]').length,
      face: document.querySelector('[data-related-enlarged]')?.getAttribute('data-related-enlarged') ?? null,
    }));
    report(testInfo, 'otherTab1280', opened);
    expect(opened).toEqual({ rail: 0, cards: 0, strip: 0, face: 'contact.account_id' });
    await page.locator('[data-record-tab="overview"]').click();
    await expect(page.locator('[data-record-column="right"]')).toHaveCount(1);
    await expect(page.locator('[data-record-overview-strip]')).toHaveCount(1);
  });

  test('a rail card\'s title opens its tab; the rail reads 审批, 附件, 最近动态, 其他相关, sized 8 / 13 / 26', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await mount(page, { name: 'railClick1280', viewport: 1280, frame: PAGE_1280 });
    const rail = await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>('[data-record-summary-card]')].filter((el) => !el.hidden);
      const first = cards[0];
      const title = first.querySelector<HTMLElement>('[data-record-summary-card-title]')!;
      const row = document.querySelector<HTMLElement>('[data-record-summary-row]')!;
      const count = document.querySelector<HTMLElement>('[data-record-summary-card-count]')!;
      return {
        order: cards.map((el) => el.getAttribute('data-record-summary-card')),
        rows: cards.map((el) => el.querySelectorAll('[data-record-summary-row]').length),
        radius: getComputedStyle(first).borderTopLeftRadius,
        titleSize: getComputedStyle(title).fontSize,
        rowHeight: Math.round(row.getBoundingClientRect().height),
        countColor: getComputedStyle(count).color,
        titleColor: getComputedStyle(title).color,
        other: document.querySelector('[data-record-summary-other]')?.textContent ?? null,
        emptyLine: /还有\s*\d+\s*个空关联/.test(document.body.textContent ?? ''),
      };
    });
    report(testInfo, 'railClick1280', rail);
    // 审批, 附件, 最近动态, then 其他相关: the six lists with records, in their order.
    expect(rail.order).toEqual([
      'approvals',
      'attachments',
      'timeline',
      'contact.account_id',
      'opportunity.account_id',
      'contract.account_id',
      'quote.account_id',
      'campaign_member.account_id',
      'task.what_id',
    ]);
    expect(Math.max(...rail.rows)).toBeLessThanOrEqual(3);
    expect(rail.radius).toBe('8px');
    expect(rail.titleSize).toBe('13px');
    expect(rail.rowHeight).toBe(26);
    expect(rail.countColor).not.toBe(rail.titleColor);
    expect(rail.other).toBe('其他相关');
    expect(rail.emptyLine).toBe(false);
    // The whole title opens the tab.
    await page.locator('[data-record-summary-card="quote.account_id"] [data-record-summary-card-title]').click();
    await expect(page.locator('[data-record-tab="quote.account_id"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-related-enlarged="quote.account_id"]')).toHaveCount(1);
    // CONTROL: 概览 returns, and the rail with it.
    await page.locator('[data-record-tab="overview"]').click();
    await expect(page.locator('[data-record-tab="overview"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-record-summary-card="quote.account_id"]')).toHaveCount(1);
    await page.locator('[data-record-summary-card="approvals"] [data-record-summary-card-title]').click();
    await expect(page.locator('[data-record-tab="approvals"]')).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('a related tab\'s menu moves and hides it, and 「更多」 restores the default (objectstack#35783)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one engine is enough for an interaction pin');

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    if (!bundle) bundle = await bundlePage();
  });

  /** The related lists' tabs on the row, in order. */
  const listTabs = (page: Page) =>
    page.evaluate((all) => {
      const lists = new Set(all.slice(1, 9));
      return [...document.querySelectorAll('[data-record-tab-row] [role="tab"]')]
        .map((el) => el.getAttribute('data-record-tab') ?? '')
        .filter((id) => lists.has(id));
    }, ALL_TABS);
  /** Open a list's tab, then its menu (a second click), and choose an entry. */
  async function arrange(page: Page, id: string, entry: string) {
    const tab = page.locator(`[role="tab"][data-record-tab="${id}"]`);
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await tab.click();
    await page.getByRole('menuitem', { name: entry }).click();
  }

  test('左移 / 右移 move the open list, 隐藏 sends it to 「更多」, 恢复默认顺序 brings the default back', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const lists = ALL_TABS.slice(1, 9);
    await mount(page, { name: 'arrange1184', viewport: 1440, frame: PAGE_1440 });
    expect(await listTabs(page)).toEqual(lists);
    await arrange(page, 'contact.account_id', '右移');
    const moved = await listTabs(page);
    expect(moved.slice(0, 2)).toEqual(['opportunity.account_id', 'contact.account_id']);
    await arrange(page, 'contact.account_id', '左移');
    expect(await listTabs(page)).toEqual(lists);
    // CONTROL: 概览 opens no menu.
    await page.locator('[role="tab"][data-record-tab="overview"]').click();
    await page.locator('[role="tab"][data-record-tab="overview"]').click();
    await expect(page.locator('[data-record-tab-arrange-menu]')).toHaveCount(0);
    await arrange(page, 'quote.account_id', '右移');
    await arrange(page, 'opportunity.account_id', '隐藏');
    await expect(page.locator('[role="tab"][data-record-tab="overview"]')).toHaveAttribute('aria-selected', 'true');
    const arranged = await listTabs(page);
    report(testInfo, 'arranged', arranged);
    expect(arranged).not.toContain('opportunity.account_id');
    expect(arranged.indexOf('invoice.account_id')).toBeLessThan(arranged.indexOf('quote.account_id'));
    await page.locator('[data-record-tab-more]').click();
    await expect(page.locator('[data-record-tab-hidden][data-record-tab-menu-item="opportunity.account_id"]')).toHaveCount(1);
    await page.getByRole('menuitem', { name: '恢复默认顺序' }).click();
    await expect.poll(() => listTabs(page)).toEqual(lists);
    // CONTROL: the default arrangement offers nothing to restore, and the row that fits draws no 「更多」.
    await expect(page.locator('[data-record-tab-more]')).toHaveCount(0);
  });
});
