// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10862, slice 3 — the object / data previews under zh-CN.
 *
 * `ObjectPreview`, `DatasetPreview`, `ViewPreview`, `ReportPreview`,
 * `PagePreview`, `PageBlockCanvas` (with its add-block picker),
 * `SourcePageEditor`, `ValidationPreview` and the view column manager
 * (`FieldsListEditor`, `FieldListRow`) rendered their own words in English
 * beside a Chinese designer, the error-boundary hints among them. Each now
 * reads its `engine.*` rows in the designer locale: the previews in the
 * `locale` their hosts hand them (`ResourceEditPage`, `EmbeddedItemEditor`,
 * `StudioDesignSurface` pass `useMetadataLocale()`), `PageBlockCanvas` and
 * `SourcePageEditor` in the one `PagePreview` threads to them, the column
 * manager through `useMetadataLocale()` as its add-field popover already did.
 *
 * ── How each site is read ────────────────────────────────────────────────────
 * The slice-1 / slice-2 harness: every case mounts the REAL component under the
 * i18n provider in its language and reads what it rendered. A site is one
 * designer word on the mount: an element's whole text, a `title`, an
 * `aria-label` or an input's `placeholder`. Each zh expectation is read back
 * from the catalogue and guarded by `zhRow`, so no case passes on a missing row
 * and none restates a translation. Each en case reads the en row through `t` /
 * `tFormat` for `en-US` rather than pin the wording, so it is the control that
 * the en row renders what the literal rendered. A row with a code span in it is
 * read with the hole filled by the code span's text. `PageBlockCanvas` and
 * `SourcePageEditor` are mounted through `PagePreview`, their host, so the
 * cases also read that the locale is threaded to them.
 *
 * ── Stand-ins ────────────────────────────────────────────────────────────────
 * An error-boundary hint shows only when the child throws, so the children
 * that throw here are stand-ins that draw, suspend or throw on demand:
 * `SchemaRenderer`, the chart and report renderers, `ObjectFormCanvas` and
 * `InterfaceListPage`. Each mock spreads the real module. Monaco is a stand-in
 * whose loader fails, which is how the source editor's textarea shows.
 *
 * ── Left as written on purpose ───────────────────────────────────────────────
 * Author data (names, labels, messages, tags, events, severities, rule and
 * block types, region and slot names, field names, CEL and regex sources), the
 * error a renderer threw, and a bare `JSON Schema` (the standard's name) read
 * the same in every locale; the cases check a sample on the same mount. So does
 * the add-block picker's `AI` heading, whose zh row is `AI` as the metadata
 * domain table's is.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

const state = vi.hoisted(() => ({
  schema: 'draw' as 'draw' | 'throw',
  chart: 'draw' as 'draw' | 'throw',
  report: 'draw' as 'draw' | 'suspend' | 'throw',
  formCanvas: 'draw' as 'draw' | 'throw',
  interfacePage: 'draw' as 'draw' | 'throw',
  queryDataset: undefined as undefined | ((...args: unknown[]) => Promise<unknown>),
  metadataClient: { get: async () => undefined, list: async (): Promise<unknown[]> => [] },
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: () => {
    if (state.schema === 'throw') throw new Error('component "x_widget" is not registered');
    return <div data-testid="schema-renderer" />;
  },
  RecordContextProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@object-ui/plugin-charts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChartRenderer: () => {
    if (state.chart === 'throw') throw new Error('series "rate" has no data key');
    return <div data-testid="chart-renderer" />;
  },
}));

vi.mock('@object-ui/plugin-report', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ReportRenderer: () => {
    if (state.report === 'suspend') throw new Promise<never>(() => {});
    if (state.report === 'throw') throw new Error('measure "arr" is not on dataset "sales"');
    return <div data-testid="report-renderer" />;
  },
}));
// Module-scope imports of the two lazily loaded renderers, so each preview's
// `React.lazy` factory resolves at once instead of racing the test's wait
// window (AGENTS.md, flaky-test discipline).
import '@object-ui/plugin-charts';
import '@object-ui/plugin-report';

vi.mock('./ObjectFormCanvas', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectFormCanvas: () => {
    if (state.formCanvas === 'throw') throw new Error('field "amount" has no type');
    return <div data-testid="object-form-canvas" />;
  },
}));

vi.mock('../../InterfaceListPage', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  InterfaceListPage: () => {
    if (state.interfacePage === 'throw') throw new Error('view "all_accounts" not found');
    return <div data-testid="interface-list-page" />;
  },
}));

vi.mock('../../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ({ queryDataset: (...args: unknown[]) => state.queryDataset!(...args) }),
}));

// `useObjectFields` short-circuits the fetch when handed a catalog, but still
// constructs the shared metadata client.
vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => state.metadataClient,
}));

// Monaco's loader fails (offline), so the source editor falls back to its textarea.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});

import { t, tFormat } from '../i18n';
import { BLOCK_TYPE_META, CATEGORY_LABEL_KEY, TYPES_BY_CATEGORY } from './block-types';

/**
 * The picker rows, derived from the type id and the category name rather than
 * read off the table, so a case reads the rendered picker and nothing else:
 * `page:header` → `engine.pageBlockCanvas.type.pageHeader`.
 */
const typeKey = (id: string) =>
  'engine.pageBlockCanvas.type.' +
  id.split(/[:_-]/).map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');
const categoryKey = (c: string) => `engine.pageBlockCanvas.category.${c}`;
import { ObjectPreview } from './ObjectPreview';
import { DatasetPreview } from './DatasetPreview';
import { ViewPreview } from './ViewPreview';
import { ReportPreview } from './ReportPreview';
import { PagePreview } from './PagePreview';
import { ValidationPreview } from './ValidationPreview';
import { FieldsListEditor } from './FieldsListEditor';
import type { ObjectFieldInfo } from './useObjectFields';

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  state.schema = 'draw';
  state.chart = 'draw';
  state.report = 'draw';
  state.formCanvas = 'draw';
  state.interfacePage = 'draw';
  state.queryDataset = undefined;
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

type Lang = 'en' | 'zh';
const LANGS = ['zh', 'en'] as const;
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;
type Vars = Record<string, string | number>;

/** The console mounts every designer surface under the i18n provider in its language. */
function inLang(lang: Lang, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>{ui}</I18nProvider>,
  );
}

/** Let mount-time effects, resolved fetches and lazy chunks settle. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** The row `key` in `lang`, formatted with `vars`. */
function row(lang: Lang, key: string, vars?: Vars): string {
  return vars ? tFormat(key, LOCALE[lang], vars) : t(key, LOCALE[lang]);
}

/** A zh catalogue row that is really there: not the echoed key, not the en row. */
function zhRow(key: string): string {
  const zh = t(key, 'zh-CN');
  expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
  expect(zh, `${key}: the zh row must not be the English one`).not.toBe(t(key, 'en-US'));
  return zh;
}

/** One designer word on the mount, and the row it reads. */
interface Site {
  key: string;
  vars?: Vars;
  /** Where the row lands: an element's whole text (default), a `title`, an `aria-label` or a `placeholder`. */
  in?: 'text' | 'title' | 'aria-label' | 'placeholder';
  /** The element's whole text around the row, when the row is not all of it. */
  around?: (row: string) => string;
}

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Whether some element on the page renders `text` in `where`. */
function rendered(where: NonNullable<Site['in']>, text: string): boolean {
  const els = Array.from(document.body.querySelectorAll<Element>('*'));
  if (where === 'text') return els.some((el) => norm(el.textContent) === text);
  return els.some((el) => el.getAttribute(where) === text);
}

/** The sites the mount does NOT render in `lang`, each with the text it was expected to show. */
function unrendered(lang: Lang, sites: Site[]): string[] {
  return sites
    .map((s) => {
      const r = row(lang, s.key, s.vars);
      const text = norm(s.around ? s.around(r) : r);
      return rendered(s.in ?? 'text', text) ? null : `${s.key} (${s.in ?? 'text'}): ${JSON.stringify(text)}`;
    })
    .filter((x): x is string => x !== null);
}

/**
 * What a case did not find. Every site on every mount of a case is read before
 * the case judges, so a failing case lists each missing site rather than the
 * first one.
 */
let misses: string[] = [];

/** A case: reads every site it names, then fails once, listing each miss. */
function pin(name: string, body: () => void | Promise<void>) {
  it(name, async () => {
    misses = [];
    await body();
    expect(misses).toEqual([]);
  });
}

/** Every site renders its row in `lang`; under zh, every row is a real zh row. */
function expectSites(lang: Lang, sites: Site[]) {
  misses.push(...unrendered(lang, sites));
  if (lang === 'zh') for (const s of sites) zhRow(s.key);
}

/** Author data, identifiers and notation: the same bytes in every locale. */
function expectAsWritten(texts: string[]) {
  misses.push(...texts.filter((x) => !rendered('text', x)).map((x) => `as written: ${JSON.stringify(x)}`));
}

/** One more reading the case must find. */
function expectEqual(what: string, got: string | null | undefined, want: string) {
  if (got !== want) misses.push(`${what}: ${JSON.stringify(want)}, read ${JSON.stringify(got)}`);
}

/** A thrown render error is logged by React; keep the run's output readable. */
function quietBoundary() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

/** The error-boundary box's hint line. */
function boundaryHint(): string | null {
  return document.body.querySelector('div.m-4 div.flex-1 div.mt-2')?.textContent ?? null;
}

/** The error boundary's hint reads the row `key` in `lang`. */
function expectHint(lang: Lang, key: string, vars?: Vars) {
  expectEqual(`${key} (boundary hint)`, boundaryHint(), row(lang, key, vars));
  if (lang === 'zh') zhRow(key);
}

/** A `fetch` answer carrying only the `json()` the previews read. */
const answer = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

// ─── ObjectPreview ───────────────────────────────────────────────────────────

describe('ObjectPreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the form designer's error-boundary hint`, async () => {
      quietBoundary();
      state.formCanvas = 'throw';
      inLang(lang, <ObjectPreview type="object" name="account" draft={{ name: 'account' }} locale={LOCALE[lang]} />);
      await flush();
      expectHint(lang, 'engine.objectPreview.renderFailed');
      expectAsWritten(['field "amount" has no type']);
    });
  }
});

// ─── DatasetPreview ──────────────────────────────────────────────────────────

const DATASET = {
  name: 'sales',
  object: 'opportunity',
  dimensions: [{ name: 'region', field: 'region' }],
  measures: [
    { name: 'revenue', aggregate: 'sum', field: 'amount' },
    { name: 'rate', derived: { op: 'ratio', of: ['revenue', 'revenue'] } },
  ],
};

function stubDimensionFetch() {
  globalThis.fetch = vi.fn(async () => answer({ item: { name: 'opportunity', fields: {} } })) as never;
}

describe('DatasetPreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the no-object and no-measure empty states`, () => {
      inLang(lang, <DatasetPreview type="dataset" name="sales" draft={{ name: 'sales' }} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.datasetPreview.pickObject' }, { key: 'engine.datasetPreview.pickObjectHint' }]);
      cleanup();
      inLang(lang, <DatasetPreview type="dataset" name="sales" draft={{ name: 'sales', object: 'opportunity' }} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.datasetPreview.addMeasure' }, { key: 'engine.datasetPreview.addMeasureHint' }]);
    });

    pin(`${lang}: the run button, the plural counts, the ratio-axis note and the chart's error-boundary hint`, async () => {
      stubDimensionFetch();
      state.queryDataset = async () => ({
        rows: [{ region: 'NA', revenue: 600000, rate: 0.7 }],
        object: 'opportunity',
        fields: [
          { name: 'region', type: 'string', label: 'Region' },
          { name: 'revenue', type: 'number', label: 'Revenue', format: '0,0' },
          { name: 'rate', type: 'number', label: 'Win rate', format: '0.0%' },
        ],
      });
      inLang(lang, <DatasetPreview type="dataset" name="sales" draft={DATASET} locale={LOCALE[lang]} />);
      await screen.findByTestId('chart-renderer');
      const dims = row(lang, 'engine.datasetPreview.dimensionOne', { count: 1 });
      expectSites(lang, [
        { key: 'engine.datasetPreview.run' },
        { key: 'engine.datasetPreview.measureOther', vars: { count: 2 }, around: (r) => `${r} · ${dims}` },
        { key: 'engine.datasetPreview.dimensionOne', vars: { count: 1 }, around: (r) => `${row(lang, 'engine.datasetPreview.measureOther', { count: 2 })} · ${r}` },
        { key: 'engine.datasetPreview.ratioAxis', vars: { measures: 'Win rate' } },
      ]);
      expectAsWritten(['Region', 'Revenue', 'Win rate', 'NA']);

      cleanup();
      quietBoundary();
      state.chart = 'throw';
      inLang(lang, <DatasetPreview type="dataset" name="sales" draft={DATASET} locale={LOCALE[lang]} />);
      await flush();
      await screen.findByText('NA');
      expectHint(lang, 'engine.datasetPreview.chartFailed');
    });

    pin(`${lang}: the singular measure count, the plural dimension count and the no-rows state`, async () => {
      stubDimensionFetch();
      state.queryDataset = async () => ({ rows: [], fields: [] });
      const draft = {
        name: 'sales',
        object: 'opportunity',
        dimensions: [{ name: 'region', field: 'region' }, { name: 'stage', field: 'stage' }],
        measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
      };
      inLang(lang, <DatasetPreview type="dataset" name="sales" draft={draft} locale={LOCALE[lang]} />);
      await flush();
      const dims = row(lang, 'engine.datasetPreview.dimensionOther', { count: 2 });
      expectSites(lang, [
        { key: 'engine.datasetPreview.measureOne', vars: { count: 1 }, around: (r) => `${r} · ${dims}` },
        { key: 'engine.datasetPreview.dimensionOther', vars: { count: 2 }, around: (r) => `${row(lang, 'engine.datasetPreview.measureOne', { count: 1 })} · ${r}` },
        { key: 'engine.datasetPreview.noRows' },
        { key: 'engine.datasetPreview.noRowsHint' },
      ]);
    });

    pin(`${lang}: the analytics-not-installed state`, async () => {
      stubDimensionFetch();
      state.queryDataset = async () => {
        throw Object.assign(new Error('analytics service not mounted'), { code: 'ANALYTICS_NOT_INSTALLED' });
      };
      inLang(lang, <DatasetPreview type="dataset" name="sales" draft={DATASET} locale={LOCALE[lang]} />);
      await flush();
      expectSites(lang, [{ key: 'engine.datasetPreview.notInstalled' }, { key: 'engine.datasetPreview.notInstalledHint' }]);
    });
  }
});

// ─── ViewPreview ─────────────────────────────────────────────────────────────

describe('ViewPreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the no-object note names the right panel's field in the same locale`, () => {
      inLang(lang, <ViewPreview type="view" name="all" draft={{ name: 'all' }} locale={LOCALE[lang]} />);
      const field = row(lang, 'engine.inspector.view.object');
      expectSites(lang, [{ key: 'engine.viewPreview.noObject', around: (r) => r.replace('{object}', field) }]);
      expectEqual('the code span', document.body.querySelector('code')?.textContent, field);
    });

    pin(`${lang}: the three error-boundary hints (raw schema, form view, list view)`, async () => {
      quietBoundary();
      state.schema = 'throw';
      const drafts: Array<[Record<string, unknown>, string]> = [
        [{ name: 'raw', type: 'x_widget' }, 'engine.viewPreview.schemaFailed'],
        [{ name: 'intake', viewKind: 'form', config: { type: 'simple', object: 'account' } }, 'engine.viewPreview.formFailed'],
        [{ name: 'all', config: { type: 'grid', object: 'account' } }, 'engine.viewPreview.listFailed'],
      ];
      for (const [draft, key] of drafts) {
        inLang(lang, <ViewPreview type="view" name={String(draft.name)} draft={draft} locale={LOCALE[lang]} />);
        await flush();
        expectHint(lang, key);
        expectAsWritten(['component "x_widget" is not registered']);
        cleanup();
      }
    });
  }
});

// ─── ReportPreview ───────────────────────────────────────────────────────────

describe('ReportPreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the two empty states`, () => {
      inLang(lang, <ReportPreview type="report" name="r" draft={{ name: 'r' }} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.reportPreview.empty' }, { key: 'engine.reportPreview.emptyHint' }]);
      cleanup();
      inLang(lang, <ReportPreview type="report" name="r" draft={{ name: 'r', type: 'joined' }} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.reportPreview.joinedEmpty' }, { key: 'engine.reportPreview.joinedEmptyHint' }]);
    });

    pin(`${lang}: the loading text and the error-boundary hint`, async () => {
      state.report = 'suspend';
      inLang(lang, <ReportPreview type="report" name="r" draft={{ name: 'r', dataset: 'sales' }} locale={LOCALE[lang]} />);
      await flush();
      expectSites(lang, [{ key: 'engine.reportPreview.loading' }]);
      cleanup();
      quietBoundary();
      state.report = 'throw';
      inLang(lang, <ReportPreview type="report" name="r" draft={{ name: 'r', dataset: 'sales' }} locale={LOCALE[lang]} />);
      await flush();
      expectHint(lang, 'engine.reportPreview.renderFailed');
      expectAsWritten(['measure "arr" is not on dataset "sales"']);
    });
  }
});

// ─── PagePreview ─────────────────────────────────────────────────────────────

/** Serve the record page's two reads: the object schema, then `records`. */
function stubRecordFetch(records: unknown[]) {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/meta/object/')) return answer({ item: { name: 'account', fields: { name: { type: 'text' } } } });
    if (url.startsWith('/api/v1/data/')) return answer({ records });
    return answer({});
  }) as never;
}

const RECORD_PAGE = { name: 'acct', type: 'record', object: 'account', regions: [{ name: 'main', components: [{ type: 'record:details' }] }] };

describe('PagePreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the empty page and the children-shaped outline's positional block label`, () => {
      inLang(lang, <PagePreview type="page" name="p" draft={{}} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.pagePreview.addComponents' }]);
      cleanup();
      inLang(
        lang,
        <PagePreview
          type="page"
          name="p"
          draft={{ name: 'p', children: [{}, { type: 'element:text', id: 'hero' }] }}
          editing
          onSelectionChange={() => {}}
          onPatch={() => {}}
          locale={LOCALE[lang]}
        />,
      );
      expectSites(lang, [{ key: 'engine.pagePreview.blockN', vars: { n: 1 } }]);
      expectAsWritten(['hero']);
    });

    pin(`${lang}: the sample-record picker: its label, the plural count and a record with nothing to name it`, async () => {
      stubRecordFetch([{ id: 'r1', name: 'Northwind' }, { id: 'r2', name: 'Contoso' }, { industry: 'retail' }]);
      inLang(lang, <PagePreview type="page" name="acct" draft={RECORD_PAGE} locale={LOCALE[lang]} />);
      await flush();
      // The picker is the shared `Select` (objectui#11865), so its items are on
      // the page while it is open: open it before reading them.
      const picker = screen.getAllByRole('combobox').find((el) => norm(el.textContent) === 'Northwind');
      expect(picker, 'the sample-record picker shows the first sample').toBeDefined();
      fireEvent.keyDown(picker!, { key: 'ArrowDown' });
      await screen.findByRole('listbox');
      expectSites(lang, [
        { key: 'engine.pagePreview.previewRecord' },
        { key: 'engine.pagePreview.sampleOther', vars: { count: 3 } },
        { key: 'engine.pagePreview.recordFallback' },
      ]);
      expectAsWritten(['Northwind', 'Contoso']);
    });

    pin(`${lang}: the singular sample count`, async () => {
      stubRecordFetch([{ id: 'r1', name: 'Northwind' }]);
      inLang(lang, <PagePreview type="page" name="acct" draft={RECORD_PAGE} locale={LOCALE[lang]} />);
      await flush();
      expectSites(lang, [{ key: 'engine.pagePreview.sampleOne', vars: { count: 1 } }]);
    });

    pin(`${lang}: the interface page's and the page schema's error-boundary hints`, async () => {
      quietBoundary();
      state.interfacePage = 'throw';
      inLang(lang, <PagePreview type="page" name="p" draft={{ name: 'p', interfaceConfig: { source: 'account' } }} locale={LOCALE[lang]} />);
      await flush();
      expectHint(lang, 'engine.pagePreview.interfaceFailed');
      cleanup();
      state.schema = 'throw';
      inLang(lang, <PagePreview type="page" name="p" draft={{ name: 'p', children: [{ type: 'x_widget' }] }} locale={LOCALE[lang]} />);
      await flush();
      expectHint(lang, 'engine.pagePreview.schemaFailed');
    });
  }
});

// ─── SourcePageEditor (through PagePreview) ──────────────────────────────────

describe('SourcePageEditor reads the locale PagePreview threads to it (objectui#10862)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the source textarea's label and the live preview's error-boundary hint`, async () => {
      quietBoundary();
      state.schema = 'throw';
      inLang(lang, <PagePreview type="page" name="p" draft={{ name: 'p', kind: 'html', source: '<div />' }} locale={LOCALE[lang]} />);
      await screen.findByRole('textbox');
      expectSites(lang, [{ key: 'engine.sourcePageEditor.source', in: 'aria-label' }]);
      expectHint(lang, 'engine.sourcePageEditor.renderFailed');
    });
  }
});

// ─── PageBlockCanvas (through PagePreview) ───────────────────────────────────

/** Mount `draft` in `PagePreview`'s design mode, where a region-shaped page is the block canvas. */
function designPage(lang: Lang, draft: Record<string, unknown>) {
  return inLang(
    lang,
    <PagePreview type="page" name="p" draft={draft} editing onSelectionChange={() => {}} onPatch={() => {}} locale={LOCALE[lang]} />,
  );
}

const CANVAS_PAGE = {
  name: 'p',
  regions: [
    { name: '', components: [] },
    {
      name: 'main',
      components: [
        { type: 'page:card', properties: { children: [] } },
        { type: 'page:tabs', properties: { items: [{ children: [] }] } },
        { type: 'grid', properties: { children: [{ type: 'element:text', id: 'inner_note' }] } },
        { type: 'element:text', id: 'hero' },
      ],
    },
  ],
};

describe('PageBlockCanvas reads the locale PagePreview threads to it (objectui#10862)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the no-regions state`, () => {
      designPage(lang, { name: 'p', regions: [] });
      expectSites(lang, [
        { key: 'engine.pageBlockCanvas.noRegions' },
        { key: 'engine.pageBlockCanvas.noRegionsHint' },
        { key: 'engine.pageBlockCanvas.addRegion' },
      ]);
    });

    pin(`${lang}: regions, container groups, block rows and the drop target`, () => {
      designPage(lang, CANVAS_PAGE);
      expectSites(lang, [
        { key: 'engine.pageBlockCanvas.regionN', vars: { n: 1 } },
        { key: 'engine.pageBlockCanvas.regionEmpty' },
        { key: 'engine.pageBlockCanvas.addRegion' },
        { key: 'engine.pageBlockCanvas.body' },
        { key: 'engine.pageBlockCanvas.itemN', vars: { n: 1 } },
        { key: 'engine.pageBlockCanvas.content' },
        { key: 'engine.pageBlockCanvas.groupEmpty' },
        { key: 'engine.pageBlockCanvas.select', vars: { label: 'hero' }, in: 'aria-label' },
        { key: 'engine.pageBlockCanvas.select', vars: { label: 'inner_note' }, in: 'aria-label' },
        // Rows the designer already carried, reused with the same meaning.
        { key: 'designer.canvas.renameHint', in: 'title' },
        { key: 'engine.inspector.add.block' },
      ]);
      expectAsWritten(['main', 'page:card', 'element:text']);

      const main = Array.from(document.body.querySelectorAll('section'))[1]!;
      fireEvent.dragOver(main, { dataTransfer: { types: ['text/x-objectui-pageblock'], dropEffect: 'none' } });
      expectSites(lang, [{ key: 'engine.pageBlockCanvas.dropHere' }]);
    });

    pin(`${lang}: a slotted page's inherited slots`, () => {
      designPage(lang, { name: 'p', kind: 'slotted', regions: [], slots: {} });
      expectSites(lang, [{ key: 'engine.pageBlockCanvas.slotInherited' }]);
      expectAsWritten(['header', 'details']);
    });

    pin(`${lang}: a block's error-boundary hint names its type as written`, async () => {
      quietBoundary();
      state.schema = 'throw';
      designPage(lang, { name: 'p', regions: [{ name: 'main', components: [{ type: 'x_widget', id: 'hero' }] }] });
      await flush();
      expectHint(lang, 'engine.pageBlockCanvas.renderFailed', { type: 'x_widget' });
    });

    pin(`${lang}: the add-block picker: its search box, category headings, block names and no-match note`, async () => {
      designPage(lang, { name: 'p', regions: [{ name: 'main', components: [] }] });
      // Found by what it is (the popover trigger), not by the words under test.
      const trigger = screen.getAllByRole('button').find((b) => b.getAttribute('aria-haspopup') === 'dialog');
      fireEvent.click(trigger!);
      const search = await screen.findByRole('textbox');
      const categories = TYPES_BY_CATEGORY.map((g) => g.category);
      const types = TYPES_BY_CATEGORY.flatMap((g) => g.types);
      expectSites(lang, [
        { key: 'engine.pageBlockCanvas.searchTypes', in: 'placeholder' },
        ...categories.filter((c) => c !== 'ai').map((c) => ({ key: categoryKey(c) })),
        ...types.map((id) => ({ key: typeKey(id) })),
      ]);
      // The `AI` heading reads the same in every locale.
      expectAsWritten(['AI']);
      expect(t(categoryKey('ai'), 'zh-CN')).toBe('AI');

      fireEvent.change(search, { target: { value: 'zzz_no_such_block' } });
      expectSites(lang, [{ key: 'engine.pageBlockCanvas.noMatch' }]);
    });
  }

  it('each block name and category heading reads, in en, the English its table carried', () => {
    for (const [id, meta] of Object.entries(BLOCK_TYPE_META)) {
      expect(t(typeKey(id), 'en-US'), id).toBe(meta.label);
    }
    const categories = ['data', 'layout', 'record', 'navigation', 'element', 'ai', 'misc'];
    expect(Object.fromEntries(categories.map((c) => [c, t(categoryKey(c), 'en-US')]))).toEqual({
      data: 'Data',
      layout: 'Layout',
      record: 'Record context',
      navigation: 'Navigation',
      element: 'Elements',
      ai: 'AI',
      misc: 'Other',
    });
  });

  it('the table names each type and category by the row the picker reads', () => {
    for (const [id, meta] of Object.entries(BLOCK_TYPE_META)) expect(meta.labelKey, id).toBe(typeKey(id));
    expect(Object.entries(CATEGORY_LABEL_KEY).filter(([c, k]) => k !== categoryKey(c))).toEqual([]);
    expect(Object.keys(CATEGORY_LABEL_KEY).sort()).toEqual(['ai', 'data', 'element', 'layout', 'misc', 'navigation', 'record']);
  });
});

// ─── ValidationPreview ───────────────────────────────────────────────────────

function mountRule(lang: Lang, draft: Record<string, unknown>) {
  return inLang(lang, <ValidationPreview type="validation" name={String(draft.name ?? '')} draft={draft} locale={LOCALE[lang]} />);
}

describe('ValidationPreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the no-name state`, () => {
      mountRule(lang, {});
      expectSites(lang, [{ key: 'engine.validationPreview.empty' }]);
    });

    pin(`${lang}: the envelope (pills, message, tags) and a script rule with no condition`, () => {
      mountRule(lang, {
        name: 'amount_positive',
        type: 'script',
        severity: 'warning',
        active: false,
        priority: 5,
        events: ['insert', 'update'],
        tags: ['finance'],
      });
      expectSites(lang, [
        { key: 'engine.validationPreview.disabled' },
        { key: 'engine.validationPreview.priority', vars: { priority: 5 } },
        { key: 'engine.validationPreview.on', vars: { events: 'insert, update' } },
        { key: 'engine.validationPreview.noMessage' },
        { key: 'engine.validationPreview.tags' },
        { key: 'engine.validationPreview.condition' },
        { key: 'engine.validationPreview.noExpression' },
      ]);
      expectAsWritten(['amount_positive', 'script', 'warning', 'finance']);
      cleanup();
      mountRule(lang, { name: 'amount_positive', type: 'script', message: 'Amount must be positive', condition: 'amount <= 0' });
      expectSites(lang, [{ key: 'engine.validationPreview.active' }]);
      expectAsWritten(['Amount must be positive', 'amount <= 0']);
    });

    pin(`${lang}: the three removed rule types redirect in the designer's words`, () => {
      for (const type of ['unique', 'async', 'custom']) {
        mountRule(lang, { name: 'r', type });
        expectSites(lang, [
          { key: 'engine.validationPreview.notARule' },
          { key: 'engine.validationPreview.removedType', around: (r) => r.replace('{type}', type) },
          { key: `engine.validationPreview.removed.${type}` },
        ]);
        expectEqual('the code span', document.body.querySelector('code')?.textContent, type);
        cleanup();
      }
    });

    pin(`${lang}: a conditional rule with an empty predicate, no nested rule and an untyped otherwise`, () => {
      mountRule(lang, { name: 'c', type: 'conditional', when: '', otherwise: { name: 'fallback_rule' } });
      expectSites(lang, [
        { key: 'engine.validationPreview.when' },
        { key: 'engine.validationPreview.noExpression' },
        { key: 'engine.validationPreview.thenApply' },
        { key: 'engine.validationPreview.noNested' },
        { key: 'engine.validationPreview.otherwiseApply' },
        { key: 'engine.validationPreview.noType' },
      ]);
      expectAsWritten(['fallback_rule']);
    });

    pin(`${lang}: state machine, format, cross-field and JSON Schema bodies`, () => {
      const cases: Array<[Record<string, unknown>, Site[], string[]]> = [
        [{ type: 'state_machine' }, [{ key: 'engine.validationPreview.transitions' }, { key: 'engine.validationPreview.noTransitions' }], []],
        [
          { type: 'state_machine', field: 'status', transitions: { draft: ['open'], closed: [] }, initialStates: ['draft'] },
          [
            { key: 'engine.validationPreview.transitionsOn', vars: { field: 'status' } },
            { key: 'engine.validationPreview.deadEnd' },
            { key: 'engine.validationPreview.createdIn' },
          ],
          ['open', 'closed'],
        ],
        [{ type: 'format' }, [{ key: 'engine.validationPreview.format' }, { key: 'engine.validationPreview.noFormat' }], []],
        [
          { type: 'format', field: 'email', format: 'email', regex: '^.+@.+$' },
          [
            { key: 'engine.validationPreview.formatOn', vars: { field: 'email' } },
            { key: 'engine.validationPreview.builtIn' },
            { key: 'engine.validationPreview.regex' },
          ],
          ['^.+@.+$'],
        ],
        [
          { type: 'cross_field' },
          [
            { key: 'engine.validationPreview.fieldsInvolved' },
            { key: 'engine.validationPreview.none' },
            { key: 'engine.validationPreview.crossFieldCondition' },
            { key: 'engine.validationPreview.noExpression' },
          ],
          [],
        ],
        [
          { type: 'json_schema', field: 'payload' },
          [{ key: 'engine.validationPreview.jsonSchemaOn', vars: { field: 'payload' } }, { key: 'engine.validationPreview.noJsonSchema' }],
          [],
        ],
        [{ type: 'json_schema' }, [{ key: 'engine.validationPreview.noJsonSchema' }], ['JSON Schema']],
        [{ type: 'weird_rule' }, [{ key: 'engine.validationPreview.rule' }, { key: 'engine.validationPreview.unknownType', vars: { type: 'weird_rule' } }], []],
      ];
      for (const [body, sites, asWritten] of cases) {
        mountRule(lang, { name: 'r', ...body });
        expectSites(lang, sites);
        expectAsWritten(asWritten);
        cleanup();
      }
    });
  }
});

// ─── The view column manager ─────────────────────────────────────────────────

const CATALOG: ObjectFieldInfo[] = [{ name: 'name', label: 'Name', type: 'text', hidden: false }];

function mountColumns(lang: Lang, columns: unknown[]) {
  return inLang(
    lang,
    <FieldsListEditor
      variantKey="config"
      schema={{ type: 'grid', columns }}
      columns={columns}
      allStrings={false}
      objectName="account"
      objectFieldsOverride={CATALOG}
      selectedIndex={null}
      onPatch={() => {}}
    />,
  );
}

describe('FieldsListEditor and FieldListRow read the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the heading and the no-columns note`, () => {
      mountColumns(lang, []);
      expectSites(lang, [{ key: 'engine.fieldsListEditor.columns' }, { key: 'engine.fieldsListEditor.empty' }]);
    });

    pin(`${lang}: a column's remove control, and the positional label of a column the canonical keys cannot name`, () => {
      mountColumns(lang, [{ field: 'name', label: 'Name' }, { header: 'Legacy' }]);
      const positional = row(lang, 'engine.fieldsListEditor.colN', { n: 2 });
      expectSites(lang, [
        { key: 'engine.fieldsListEditor.colN', vars: { n: 2 } },
        { key: 'engine.viewColumnPanes.remove', vars: { label: 'Name' }, in: 'aria-label' },
        { key: 'engine.viewColumnPanes.remove', vars: { label: positional }, in: 'aria-label' },
      ]);
      expectAsWritten(['Name']);
    });
  }
});
