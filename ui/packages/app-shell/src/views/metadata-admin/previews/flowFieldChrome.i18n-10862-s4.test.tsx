// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10862, slice 4 — the flow designer's canvas, variable and run
 * chrome, the address field stub, and the catalogue hooks' not-found reason
 * under zh-CN.
 *
 * - `FlowCanvas`: an edge's hover title (an un-declared cycle, a back-edge) and
 *   a node card's one-line summary (a branch count, an approver count with the
 *   unanimous marker, `code`) now read `engine.flowCanvas.*` rows in the
 *   `locale` `FlowPreview` hands it.
 * - `FlowPreview`: the variables panel's `in` / `out` tags.
 * - `FlowRunsPanel`: an expanded run's `run …` / `· trigger …` line.
 * - `FieldStub`: the address stub's placeholder (`designer.stub.address`,
 *   beside the stub's own rows).
 * - `useObjectFields` / `useDatasetSemantics`: the not-found `error` they
 *   publish, which the add-field popover writes into its "no object fields"
 *   sentence. The hooks record THAT the document was missing and read the row
 *   where they return, in `useMetadataLocale()`, so a language switch re-reads
 *   it without a refetch. A transport error is the transport's own message.
 *
 * ── How each site is read ────────────────────────────────────────────────────
 * The slice-1 to slice-3 harness: the REAL components under the i18n provider
 * in the case's language; a site is an element's whole text or an attribute;
 * each zh expectation is read back from the catalogue and guarded by `zhRow`;
 * each en case reads the en row through `t` / `tFormat` for `en-US`, the
 * control that the en row renders what the literal rendered. The flow sites
 * mount through `FlowPreview`, the canvas's and the run panel's host; the
 * hooks' reason through `FieldsListEditor` and `DashboardWidgetInspector`, two
 * of the surfaces that render it.
 *
 * ── Stand-ins and as-written ─────────────────────────────────────────────────
 * `fetch` answers the node-palette overlay with "engine absent" and the run
 * history with one fixture; the metadata client is a stand-in whose reads each
 * case sets. Node ids, variable names, run ids, trigger types, an author's own
 * placeholder and a transport's error message read as written.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';

const state = vi.hoisted(() => ({
  get: vi.fn(async (_type: string, _name: string): Promise<unknown> => undefined),
  list: vi.fn(async (_type: string): Promise<unknown[]> => []),
  metadataClient: null as unknown,
}));
state.metadataClient = {
  get: (type: string, name: string) => state.get(type, name),
  list: (type: string) => state.list(type),
  withPreviewDrafts() { return this; },
};

vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => state.metadataClient,
}));

import { t, tFormat } from '../i18n';
import { FlowPreview } from './FlowPreview';
import { FieldStub } from './FieldStub';
import { FieldsListEditor } from './FieldsListEditor';
import { DashboardWidgetInspector } from '../inspectors/DashboardWidgetInspector';

const RUNS = [
  { id: 'r_101', status: 'completed', startedAt: '2026-07-04T13:51:13.000Z', durationMs: 30, trigger: { type: 'record_change' }, steps: [] },
  { id: 'r_102', status: 'failed', startedAt: '2026-07-04T12:00:00.000Z', durationMs: 12, steps: [] },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/runs')) {
        return new Response(JSON.stringify({ success: true, data: { runs: RUNS } }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.get.mockReset();
  state.get.mockImplementation(async () => undefined);
  state.list.mockReset();
  state.list.mockImplementation(async () => []);
});

type Lang = 'en' | 'zh';
const LANGS = ['zh', 'en'] as const;
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;
type Vars = Record<string, string | number>;

/** The provider's own language switch, handed to the case by the probe below. */
let switchLanguage: ((lang: string) => Promise<void>) | null = null;
const keepSwitch = (fn: (lang: string) => Promise<void>) => {
  switchLanguage = fn;
};
function LanguageProbe({ onSwitch }: { onSwitch: (fn: (lang: string) => Promise<void>) => void }) {
  const { changeLanguage } = useObjectTranslation();
  React.useEffect(() => onSwitch(changeLanguage), [onSwitch, changeLanguage]);
  return null;
}

function inLang(lang: Lang, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      {ui}
      <LanguageProbe onSwitch={keepSwitch} />
    </I18nProvider>,
  );
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function row(lang: Lang, key: string, vars?: Vars): string {
  return vars ? tFormat(key, LOCALE[lang], vars) : t(key, LOCALE[lang]);
}

function zhRow(key: string): string {
  const zh = t(key, 'zh-CN');
  expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
  expect(zh, `${key}: the zh row must not be the English one`).not.toBe(t(key, 'en-US'));
  return zh;
}

interface Site {
  key: string;
  vars?: Vars;
  /** Where the row lands: an element's whole text (default) or an attribute, read byte for byte. */
  in?: 'text' | 'title' | 'placeholder';
  /** The element's whole text around the row, when the row is not all of it. */
  around?: (row: string) => string;
}

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function rendered(where: NonNullable<Site['in']>, text: string): boolean {
  const els = Array.from(document.body.querySelectorAll<Element>('*'));
  if (where === 'text') return els.some((el) => norm(el.textContent) === norm(text));
  return els.some((el) => el.getAttribute(where) === text);
}

let misses: string[] = [];

function pin(name: string, body: () => void | Promise<void>) {
  it(name, async () => {
    misses = [];
    await body();
    expect(misses).toEqual([]);
  });
}

function expectSites(lang: Lang, sites: Site[]) {
  for (const s of sites) {
    const r = row(lang, s.key, s.vars);
    const text = s.around ? s.around(r) : r;
    if (!rendered(s.in ?? 'text', text)) misses.push(`${s.key} (${s.in ?? 'text'}): ${JSON.stringify(text)}`);
    if (lang === 'zh') zhRow(s.key);
  }
}

function expectAsWritten(texts: string[], where: NonNullable<Site['in']> = 'text') {
  misses.push(...texts.filter((x) => !rendered(where, x)).map((x) => `as written (${where}): ${JSON.stringify(x)}`));
}

/**
 * A button found by being one: its whole text is the row in either language,
 * so a case still reaches the sites behind it when the button itself is the
 * miss (the case's own `expectSites` judges the button's words).
 */
function buttonReading(_lang: Lang, key: string): HTMLElement {
  const words = [norm(row('en', key)), norm(row('zh', key))];
  const button = screen.getAllByRole('button').find((b) => words.includes(norm(b.textContent)));
  expect(button, `the ${key} button`).toBeTruthy();
  return button!;
}

// ─── The flow designer ───────────────────────────────────────────────────────

const FLOW = {
  name: 'approve_order',
  type: 'record_change',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'route', type: 'decision', label: 'Route', config: { conditions: [{ expression: 'a > 1' }, { expression: 'a > 2' }] } },
    { id: 'board', type: 'approval', label: 'Board', config: { approvers: [{ type: 'user', value: 'u1' }, { type: 'user', value: 'u2' }], behavior: 'unanimous' } },
    { id: 'lead', type: 'approval', label: 'Lead', config: { approvers: [{ type: 'manager' }], behavior: 'first_response' } },
    { id: 'legacy', type: 'script', label: 'Legacy', config: { script: 'return 1;' } },
    { id: 'hold', type: 'wait', label: 'Hold' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'route' },
    { id: 'e2', source: 'route', target: 'board', condition: 'a > 1' },
    { id: 'e3', source: 'route', target: 'lead', isDefault: true },
    { id: 'e4', source: 'lead', target: 'route', type: 'back' },
    { id: 'e5', source: 'board', target: 'hold' },
    { id: 'e6', source: 'hold', target: 'board' },
    { id: 'e7', source: 'route', target: 'legacy', condition: 'a > 2' },
  ],
  variables: [
    { name: 'amount', type: 'number', isInput: true },
    { name: 'verdict', type: 'text', isOutput: true },
  ],
};

async function mountFlow(lang: Lang) {
  const view = inLang(
    lang,
    <FlowPreview
      type="flow"
      name="approve_order"
      draft={FLOW}
      editing
      selection={null}
      onSelectionChange={() => {}}
      onPatch={() => {}}
      locale={LOCALE[lang]}
    />,
  );
  await flush();
  return view;
}

/** An SVG `<title>` reading exactly `text`. */
function svgTitle(text: string): boolean {
  return Array.from(document.body.querySelectorAll('title')).some((el) => el.textContent === text);
}

describe('FlowCanvas reads the locale FlowPreview hands it (objectui#10862, slice 4)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: an un-declared cycle's and a back-edge's hover titles`, async () => {
      await mountFlow(lang);
      // Each end by its author label, the rule the canvas names nodes by (objectui#13242).
      const cycle = ['Board', 'Hold'].flatMap((a, i, ids) => {
        const b = ids[1 - i];
        return [row(lang, 'engine.flowCanvas.edge.undeclaredCycle', { source: a, target: b })];
      });
      if (!cycle.some(svgTitle)) misses.push(`engine.flowCanvas.edge.undeclaredCycle (title): one of ${JSON.stringify(cycle)}`);
      const back = row(lang, 'engine.flowCanvas.edge.backEdge', { source: 'Lead', target: 'Route' });
      if (!svgTitle(back)) misses.push(`engine.flowCanvas.edge.backEdge (title): ${JSON.stringify(back)}`);
      if (lang === 'zh') {
        zhRow('engine.flowCanvas.edge.undeclaredCycle');
        zhRow('engine.flowCanvas.edge.backEdge');
      }
      // A plain edge's title is its ends' author labels and an arrow, the same in every locale.
      if (!svgTitle('Start → Route')) misses.push('as written (title): "Start → Route"');
    });

    pin(`${lang}: a node card's branch count, approver counts with the unanimous marker, and code`, async () => {
      await mountFlow(lang);
      const approvers = (n: number) =>
        row(lang, n === 1 ? 'engine.flowCanvas.summary.approversOne' : 'engine.flowCanvas.summary.approversOther', { count: n });
      const all = row(lang, 'engine.flowCanvas.summary.unanimous');
      expectSites(lang, [
        { key: 'engine.flowCanvas.summary.branches', vars: { count: 2 } },
        { key: 'engine.flowCanvas.summary.branches', vars: { count: 2 }, in: 'title' },
        { key: 'engine.flowCanvas.summary.approversOther', vars: { count: 2 }, around: (r) => `${r} · ${all}` },
        { key: 'engine.flowCanvas.summary.unanimous', around: (r) => `${approvers(2)} · ${r}` },
        { key: 'engine.flowCanvas.summary.approversOne', vars: { count: 1 } },
        { key: 'engine.flowCanvas.summary.code' },
      ]);
      // The branch labels on the edges are code-line tokens, as the simulator prints them.
      expectAsWritten(['else', 'if a > 1']);
    });
  }
});

describe('FlowPreview and FlowRunsPanel read the designer locale (objectui#10862, slice 4)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the variables panel's in / out tags`, async () => {
      await mountFlow(lang);
      fireEvent.click(buttonReading(lang, 'engine.flowPreview.variables'));
      await flush();
      expectSites(lang, [{ key: 'engine.flowPreview.varIn' }, { key: 'engine.flowPreview.varOut' }]);
      expectAsWritten(['amount', 'verdict']);
    });

    pin(`${lang}: an expanded run's id line, with and without a trigger`, async () => {
      await mountFlow(lang);
      fireEvent.click(buttonReading(lang, 'engine.flowPreview.runs'));
      await flush();
      await flush();
      for (const b of screen.getAllByRole('button', { expanded: false })) fireEvent.click(b);
      await flush();
      const trigger = row(lang, 'engine.flowRuns.trigger', { type: 'record_change' });
      expectSites(lang, [
        { key: 'engine.flowRuns.runId', vars: { id: 'r_101' }, around: (r) => `${r} · ${trigger}` },
        { key: 'engine.flowRuns.trigger', vars: { type: 'record_change' }, around: (r) => `${row(lang, 'engine.flowRuns.runId', { id: 'r_101' })} · ${r}` },
        { key: 'engine.flowRuns.runId', vars: { id: 'r_102' } },
      ]);
    });
  }
});

// ─── The address field stub ──────────────────────────────────────────────────

describe('FieldStub reads the designer locale (objectui#10862, slice 4)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the address stub's placeholder; an author's own placeholder as written`, () => {
      inLang(lang, <FieldStub type="address" locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'designer.stub.address', in: 'placeholder' }]);
      cleanup();
      inLang(lang, <FieldStub type="address" placeholder="Ship-to address" locale={LOCALE[lang]} />);
      expectAsWritten(['Ship-to address'], 'placeholder');
    });
  }
});

// ─── The catalogue hooks' not-found reason ───────────────────────────────────

function mountColumns(lang: Lang) {
  return inLang(
    lang,
    <FieldsListEditor
      variantKey="config"
      schema={{ type: 'grid', columns: [] }}
      columns={[]}
      allStrings={false}
      objectName="gone_object"
      selectedIndex={null}
      onPatch={() => {}}
    />,
  );
}

function mountWidget(lang: Lang) {
  return inLang(
    lang,
    <DashboardWidgetInspector
      type="dashboard"
      name="sales"
      locale={LOCALE[lang]}
      draft={{ widgets: [{ id: 'w1', type: 'bar', title: 'Revenue', dataset: 'gone_dataset' }] }}
      selection={{ kind: 'widget', id: 'w1' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
    />,
  );
}

/** Open the (first) add-field popover and let it settle. */
async function openAddField(lang: Lang) {
  const want = norm(row(lang, 'engine.form.addFieldPlain'));
  const trigger = screen.getAllByRole('button').find((b) => norm(b.textContent) === want);
  // The trigger's words predate this slice; it is found in the case's language.
  expect(trigger, 'the add-field trigger').toBeTruthy();
  fireEvent.click(trigger!);
  await flush();
}

/** The add-field popover's sentence around the hook's `error`. */
const noFields = (lang: Lang, error: string) => row(lang, 'engine.form.noObjectFields', { error });

describe('useObjectFields and useDatasetSemantics read their not-found reason in the designer locale (objectui#10862, slice 4)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: a missing object, read through the view column manager's add-field popover`, async () => {
      await act(async () => {
        mountColumns(lang);
      });
      await flush();
      await openAddField(lang);
      expectSites(lang, [
        { key: 'engine.form.objectNotFound', around: (r) => noFields(lang, r) },
      ]);
      expect(state.get).toHaveBeenCalledWith('object', 'gone_object');
    });

    pin(`${lang}: a missing dataset, read through the dashboard widget inspector's add-field popover`, async () => {
      await act(async () => {
        mountWidget(lang);
      });
      await flush();
      await flush();
      await openAddField(lang);
      expectSites(lang, [
        { key: 'engine.form.datasetNotFound', around: (r) => noFields(lang, r) },
      ]);
      expect(state.get).toHaveBeenCalledWith('dataset', 'gone_dataset');
    });

    pin(`${lang}: a transport failure is the transport's own message, as written`, async () => {
      state.get.mockImplementation(async () => {
        throw new Error('upstream 502 from /meta');
      });
      await act(async () => {
        mountColumns(lang);
      });
      await flush();
      await openAddField(lang);
      expectAsWritten([norm(noFields(lang, 'upstream 502 from /meta'))]);
      cleanup();

      await act(async () => {
        mountWidget(lang);
      });
      await flush();
      await flush();
      await openAddField(lang);
      expectAsWritten([norm(noFields(lang, 'upstream 502 from /meta'))]);
    });
  }

  pin('the not-found reason follows a language switch without a refetch', async () => {
    await act(async () => {
      mountColumns('en');
    });
    await flush();
    await openAddField('en');
    expectSites('en', [{ key: 'engine.form.objectNotFound', around: (r) => noFields('en', r) }]);
    await act(async () => {
      await switchLanguage!('zh');
    });
    await flush();
    expectSites('zh', [{ key: 'engine.form.objectNotFound', around: (r) => noFields('zh', r) }]);
    expect(state.get, 'one read of the object, not one per language').toHaveBeenCalledTimes(1);
  });
});
