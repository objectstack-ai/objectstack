// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7696 — WHICH of the five starvation paths produces the REPORTED
 * symptom. A measurement, not a fix: no production file changes.
 *
 * ## Why this file exists
 *
 * The card's original claim — that a LOCAL select dimension on a CHART widget
 * was a 2x2 cell nobody covered — was falsified and the card was deliberately
 * kept OPEN, because the SYMPTOM was not falsified: a console really does paint
 * `One-off / Recurring / Standing` in a pie legend under a Chinese title,
 * description and axis labels, with the neighbouring LIST VIEW of the same
 * field rendering the translation correctly. Nothing in the relabel path
 * explains that, so the English has to come from one of the five ways this
 * best-effort net starves. Triage re-scoped the card to: decide which one.
 *
 * Every path below is driven. The two that were nominated as likely are NOT
 * driven alone — a reading that only ever exercises its own hypothesis cannot
 * fail, so the other three are driven too, as negative controls.
 *
 * ## The instrument: a FINGERPRINT, not a verdict
 *
 * The reporter could observe four things at once, and it is the COMBINATION
 * that discriminates — every one of the five paths turns the chart English, so
 * the chart alone distinguishes nothing:
 *
 * | axis           | what it reads                                            |
 * |----------------|----------------------------------------------------------|
 * | `chart`        | the pie categories the chart renderer receives            |
 * | `list`         | the neighbouring list view's cell for the same field      |
 * | `serverChrome` | chrome the SERVER resolved: a series label off `fields[]` |
 * | `bundleChrome` | an app-bundle-scoped string (the widget title's channel)  |
 * | `metaReads`    | what the chart's metadata channel asked for, and got      |
 *
 * `serverChrome` and `bundleChrome` are separated deliberately: the reporter
 * saw Chinese chrome, and the chrome has TWO independent sources. The axis and
 * series labels come off the analytics response (the card measured
 * `fields[].label` switching with `accept-language` while `rows[]` did not, so
 * the locale reaches the endpoint). The title and description come out of the
 * app's i18n bundle. A path that kills the bundle kills the second and not the
 * first, and that is precisely what excludes it from the report.
 *
 * `bundleChrome` is read through `fieldLabel` rather than through a dashboard
 * title. Same channel, one resolver over: EVERY resolver in `useObjectLabel`
 * funnels through the same `resolve` helper, which is gated on
 * `getAppNamespaces()`. So `fieldLabel` stands in for the whole app-bundle
 * surface of the page — when it degrades, the widget title degrades with it,
 * and when it holds, the title holds.
 *
 * ## The fixture is the card's own, verbatim
 *
 * `duly_duty_register` on `duly_duty`, one LOCAL `form` dimension (a select
 * with three options), a pie with `showLegend: true`, and rows arriving
 * SERVER-RESOLVED to the object's authored ENGLISH labels (ADR-0021) — the
 * exact bytes the card measured off `POST /api/v1/analytics/dataset/query`,
 * with `fields[].label` already Chinese in the same payload.
 *
 * ## The neighbouring LIST leg, and why it is built this way
 *
 * The list is modelled as the two steps `ObjectGrid` takes, in order, with the
 * same inputs: it reads the object document through the DataSource
 * (`getObjectSchema`), runs that field's `options` through
 * `useSafeFieldLabel().translateOptions`, and renders the value through
 * `SelectCellRenderer` — which is the renderer the field registry resolves
 * `select` to, and which reads `option.label` and nothing else.
 *
 * Two properties of that wiring are load-bearing here and both are real:
 *
 * 1. **The list's metadata read is a DIFFERENT CHANNEL from the chart's.** The
 *    list asks the DataSource, which carries the session credential in its own
 *    authenticated fetch wrapper; the analytics net asks
 *    `SchemaRendererContext.apiFetch ?? fetch` — falling back to the GLOBAL
 *    fetch when no host installed one. That asymmetry is objectui#4121's
 *    reported shape and it is what path (2) is.
 * 2. **Both channels terminate on the SAME document**, `GET
 *    /api/v1/meta/object/<name>`. So a document that carries no inline
 *    `options` starves BOTH — unless the list's own column declares options,
 *    which the grid prefers over the object document. Path (3) is measured in
 *    both of those sub-cases below, because they do not give the same answer.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider, useSafeFieldLabel } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import { SelectCellRenderer } from '@object-ui/fields';
import { DatasetWidget } from '../DatasetWidget';

/* ───────────────────────── the card's fixture, verbatim ──────────────────── */

const FORM_OPTIONS = [
  { value: 'one_off', label: 'One-off' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'standing', label: 'Standing' },
];

/** The object document as a healthy install serves it. */
const DUTY = { name: 'duly_duty', fields: { form: { type: 'select', options: FORM_OPTIONS } } };
/** The SAME document with the option LIST absent — path (3)'s whole change. */
const DUTY_NO_OPTIONS = { name: 'duly_duty', fields: { form: { type: 'select' } } };

/**
 * The app bundle. `duly.fields` is what makes `duly` DISCOVERABLE — see
 * `getAppNamespaces`, which keeps a top-level key only when it carries one of
 * `objects` / `fields` / `apps` / `dashboards` / `pages` / `reports` /
 * `globalActions`. `fieldOptions` is NOT in that list, which is the whole of
 * path (4): a bundle can carry every option translation and still be invisible.
 */
const ZH_BUNDLE = {
  zh: {
    duly: {
      fields: { duly_duty: { form: '形式' } },
      fieldOptions: {
        duly_duty: { form: { one_off: '一次性', recurring: '周期性', standing: '常设' } },
      },
    },
  },
};

/** Path (4): the SAME translations with the discoverable key removed. */
const ZH_BUNDLE_UNDISCOVERABLE = {
  zh: {
    duly: {
      fieldOptions: {
        duly_duty: { form: { one_off: '一次性', recurring: '周期性', standing: '常设' } },
      },
    },
  },
};

const PIE_WIDGET = {
  type: 'pie',
  dataset: 'duly_duty_register',
  dimensions: ['form'],
  values: ['duty_count'],
  chartConfig: { showLegend: true },
};

/**
 * The analytics payload the card measured: `rows[].form` carries the AUTHORED
 * ENGLISH label (server-resolved, ADR-0021) while `fields[].label` is already
 * Chinese in the same response — the two facts the card pinned.
 *
 * @param omitObject drop `object` from the result — path (1).
 */
const datasetResult = (omitObject = false) => ({
  rows: [
    { form: 'One-off', duty_count: 5 },
    { form: 'Recurring', duty_count: 3 },
    { form: 'Standing', duty_count: 2 },
  ],
  fields: [
    // `type: 'string'` — what a select dimension is on the wire.
    { name: 'form', type: 'string', label: '形式' },
    { name: 'duty_count', type: 'number', label: '数量' },
  ],
  ...(omitObject ? {} : { object: 'duly_duty' }),
  dimensionFields: { form: 'form' },
  drillRawRows: [{ form: 'one_off' }, { form: 'recurring' }, { form: 'standing' }],
});

/* ───────────────────────────── the two channels ──────────────────────────── */

/** What the chart's metadata read did, recorded per render. */
interface MetaChannel {
  /** Object names the chart's channel asked for. */
  requested: string[];
  /** How each of those resolved, in order. */
  outcomes: string[];
}

/**
 * Install the CHART's channel: the global `fetch`, which is what the analytics
 * net falls back to when the host installed no `apiFetch` (objectui#4121).
 *
 * @param doc the document this channel serves, or `null` to serve `401`.
 */
function installChartChannel(doc: unknown | null): MetaChannel {
  const channel: MetaChannel = { requested: [], outcomes: [] };
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    const m = /\/api\/v1\/meta\/object\/(.+)$/.exec(url);
    channel.requested.push(m ? decodeURIComponent(m[1]) : url);
    if (doc === null) {
      channel.outcomes.push('401');
      // An unauthorized read is a RESPONSE, not a throw — the body is not JSON,
      // so the net's `.catch(() => null)` yields a null schema and the walk
      // resolves nothing. Best-effort by construction: no error surfaces.
      return { ok: false, status: 401, json: async () => { throw new Error('not json'); } };
    }
    channel.outcomes.push('200');
    return { ok: true, status: 200, json: async () => ({ item: doc }) };
  }) as any;
  return channel;
}

/**
 * The LIST's channel: the DataSource's own authenticated metadata read. Kept
 * separate from the chart's on purpose — that separation IS path (2).
 */
const listChannel = (doc: unknown) => ({
  queryDataset: vi.fn(async () => datasetResult()),
  getObjectSchema: vi.fn(async () => doc),
});

/* ──────────────────────────── the page under test ────────────────────────── */

/** The value the neighbouring list view renders — the card's `recurring` row. */
const LIST_ROW_VALUE = 'recurring';

/**
 * The neighbouring list view's cell, as `ObjectGrid` builds it: the field's
 * `options` (its COLUMN's, when the column declares them, else the object
 * document's) run through `translateOptions`, then `SelectCellRenderer`.
 */
function NeighbouringListCell({
  doc,
  columnOptions,
}: {
  doc: unknown;
  columnOptions?: Array<{ value: string; label: string }>;
}) {
  const { translateOptions } = useSafeFieldLabel();
  const objectOptions = (doc as any)?.fields?.form?.options;
  const rawOptions = columnOptions || objectOptions;
  const options = Array.isArray(rawOptions) && rawOptions.length > 0
    ? translateOptions('duly_duty', 'form', rawOptions as any)
    : [];
  return (
    <div data-testid="list-cell">
      <SelectCellRenderer value={LIST_ROW_VALUE} field={{ type: 'select', options } as any} />
    </div>
  );
}

/** An app-bundle-scoped string — the channel the widget title resolves through. */
function BundleChromeProbe() {
  const { fieldLabel } = useSafeFieldLabel();
  return <span data-testid="bundle-chrome">{fieldLabel('duly_duty', 'form', 'Form')}</span>;
}

/** Capture what the widget hands the chart renderer (jsdom lays out no SVG). */
let capturedChartProps: any = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: any) => {
    capturedChartProps = props;
    return null;
  });
});

afterEach(() => {
  cleanup();
  capturedChartProps = null;
  vi.restoreAllMocks();
});

interface PageOptions {
  /** The document the CHART's channel serves; `null` serves 401 — path (2). */
  chartDoc?: unknown | null;
  /** The document the LIST's channel serves. */
  listDoc?: unknown;
  /** Options declared on the list's COLUMN, which the grid prefers. */
  listColumnOptions?: Array<{ value: string; label: string }>;
  /** Drop `object` from the analytics response — path (1). */
  omitObject?: boolean;
  /** The bundle to mount; omit `provider` to mount none — path (5). */
  resources?: Record<string, unknown>;
  /** Mount an `I18nProvider` at all. */
  provider?: boolean;
}

function renderPage(opts: PageOptions) {
  const {
    chartDoc = DUTY,
    listDoc = DUTY,
    listColumnOptions,
    omitObject = false,
    resources = ZH_BUNDLE,
    provider = true,
  } = opts;

  const channel = installChartChannel(chartDoc);
  const ds: any = listChannel(listDoc);
  ds.queryDataset = vi.fn(async () => datasetResult(omitObject));

  // Since objectui#13039 the net reads through the CONTEXT data source's
  // `getObjectSchema` when it has one, which puts the chart on the list's
  // channel and so closes path (2) in any host that provides one. This file
  // measures the route the objectui#7696 report rode, the raw fallback, so the
  // context source answers `queryDataset` only. The widget takes `ds` itself
  // through its prop, as before.
  const contextSource: any = { queryDataset: ds.queryDataset };

  const page = (
    // No `apiFetch` on the provider — the host of objectui#4121's report had
    // none either, which is exactly why the net fell back to global `fetch`.
    <SchemaRendererProvider dataSource={contextSource}>
      <DatasetWidget widget={PIE_WIDGET} dataSource={ds} />
      <NeighbouringListCell doc={listDoc} columnOptions={listColumnOptions} />
      <BundleChromeProbe />
    </SchemaRendererProvider>
  );

  const view = render(
    provider ? (
      <I18nProvider
        config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: resources as any }}
      >
        {page}
      </I18nProvider>
    ) : (
      page
    ),
  );
  return { view, channel };
}

/* ─────────────────────────────── the fingerprint ─────────────────────────── */

interface Fingerprint {
  chart: string[];
  list: string;
  serverChrome: string;
  bundleChrome: string;
  metaReads: string[];
  metaOutcomes: string[];
}

/**
 * The pie's categories, as the chart renderer receives them. A pie legend is
 * painted from exactly this: the pie branch keys its per-slice config off the
 * x-axis field and hands it to the legend, so the legend text IS this string.
 */
const categories = () => (capturedChartProps?.schema?.data ?? []).map((r: any) => r.form);

/**
 * The SERVER-resolved chrome on the chart itself: the measure's series label,
 * which is `fields[].label` off the analytics response verbatim. That is the
 * field the card measured switching with `accept-language` while `rows[].form`
 * stayed byte-identical — i.e. the proof the locale reaches the endpoint, and
 * the same class of string as the Chinese axis labels the reporter saw.
 */
const serverChromeLabel = () => String(capturedChartProps?.schema?.series?.[0]?.label ?? '');

/**
 * Drain every pending microtask and timer round, inside `act`, so the metadata
 * effect's `setMeta` and the memo below it have both landed before anything is
 * read.
 *
 * ⚠ This is NOT a `waitFor` on the expected value, and the difference is the
 * whole reason it exists. The widget paints TWICE: once with the rows exactly
 * as the server sent them, then again once the metadata read resolves. A
 * `waitFor` on "three categories exist" is satisfied by the FIRST paint, so a
 * starved path and a healthy one are indistinguishable at that moment and the
 * green is a coin flip under load — measured, as a BASELINE that reddened once
 * inside a batch while passing in isolation. A `waitFor` on the expected value
 * would fix the race by telling the instrument the answer, which is the other
 * thing this file must not do. Nothing here is unbounded — `fetch` is a mock
 * resolving an already-settled promise — so a fixed number of flush rounds is
 * deterministic rather than a timeout in disguise.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function fingerprint(container: HTMLElement, channel: MetaChannel): Promise<Fingerprint> {
  await waitFor(() => expect(capturedChartProps).not.toBeNull());
  await settle();
  return {
    chart: categories(),
    list: (container.querySelector('[data-testid="list-cell"]')?.textContent ?? '').trim(),
    serverChrome: serverChromeLabel(),
    bundleChrome: (container.querySelector('[data-testid="bundle-chrome"]')?.textContent ?? '').trim(),
    metaReads: [...channel.requested],
    metaOutcomes: [...channel.outcomes],
  };
}

const CHINESE = /[一-鿿]/;
const isChinese = (s: string) => CHINESE.test(s);

/* ────────────────────────────────── the runs ─────────────────────────────── */

describe('objectui#7696 — which starvation path produces the reported symptom', () => {
  it('BASELINE — a healthy install translates BOTH surfaces', async () => {
    const { view, channel } = renderPage({});
    const fp = await fingerprint(view.container, channel);

    expect(fp.chart).toEqual(['一次性', '周期性', '常设']);
    expect(fp.list).toBe('周期性');
    expect(fp.serverChrome).toBe('数量');
    expect(fp.bundleChrome).toBe('形式');
    expect(fp.metaReads).toEqual(['duly_duty']);
    expect(fp.metaOutcomes).toEqual(['200']);
    // Without this leg every case below would be consistent with a fixture that
    // simply cannot translate anything.
  });

  it('PATH (1) — the response omits `object`: chart English, list correct, NO read issued', async () => {
    const { view, channel } = renderPage({ omitObject: true });
    const fp = await fingerprint(view.container, channel);

    expect(fp.chart).toEqual(['One-off', 'Recurring', 'Standing']);
    // The neighbouring list never consults the analytics response.
    expect(fp.list).toBe('周期性');
    expect(fp.serverChrome).toBe('数量');
    expect(fp.bundleChrome).toBe('形式');
    // THE discriminator for this path: the net bails BEFORE reading, so the
    // metadata channel is never touched at all.
    expect(fp.metaReads).toEqual([]);
  });

  it('PATH (2) — the metadata read is unauthorized: chart English, list correct, read ATTEMPTED and refused', async () => {
    const { view, channel } = renderPage({ chartDoc: null, listDoc: DUTY });
    const fp = await fingerprint(view.container, channel);

    expect(fp.chart).toEqual(['One-off', 'Recurring', 'Standing']);
    // The list asked a DIFFERENT, authenticated channel and got the document.
    expect(fp.list).toBe('周期性');
    expect(fp.serverChrome).toBe('数量');
    expect(fp.bundleChrome).toBe('形式');
    // THE discriminator against path (1): the read WAS issued, and refused.
    expect(fp.metaReads).toEqual(['duly_duty']);
    expect(fp.metaOutcomes).toEqual(['401']);
  });

  it('PATH (3a) — no inline options, list reads the object document: BOTH surfaces go English', async () => {
    // Both channels serve the same document, because in a real install they are
    // the same endpoint. This is the default list wiring.
    const { view, channel } = renderPage({ chartDoc: DUTY_NO_OPTIONS, listDoc: DUTY_NO_OPTIONS });
    const fp = await fingerprint(view.container, channel);

    expect(fp.chart).toEqual(['One-off', 'Recurring', 'Standing']);
    // ⚠ NOT the reported symptom. With no option list to match `recurring`
    // against, the cell renderer humanizes the stored value instead.
    expect(fp.list).toBe('Recurring');
    expect(isChinese(fp.list)).toBe(false);
    expect(fp.serverChrome).toBe('数量');
    expect(fp.bundleChrome).toBe('形式');
    expect(fp.metaReads).toEqual(['duly_duty']);
    expect(fp.metaOutcomes).toEqual(['200']);
  });

  it('PATH (3b) — no inline options, but the list COLUMN declares its own: chart English, list correct', async () => {
    // The grid prefers a column-declared option list over the object document.
    // So (3) reproduces the reported symptom only in installs whose list view
    // carries that override — which is a property of the VIEW, not of the net.
    const { view, channel } = renderPage({
      chartDoc: DUTY_NO_OPTIONS,
      listDoc: DUTY_NO_OPTIONS,
      listColumnOptions: FORM_OPTIONS,
    });
    const fp = await fingerprint(view.container, channel);

    expect(fp.chart).toEqual(['One-off', 'Recurring', 'Standing']);
    expect(fp.list).toBe('周期性');
    expect(fp.serverChrome).toBe('数量');
    expect(fp.bundleChrome).toBe('形式');
    expect(fp.metaReads).toEqual(['duly_duty']);
  });

  it('NEGATIVE CONTROL (4) — the app namespace is not discoverable: the CHROME goes English too', async () => {
    const { view, channel } = renderPage({ resources: ZH_BUNDLE_UNDISCOVERABLE });
    const fp = await fingerprint(view.container, channel);

    expect(fp.chart).toEqual(['One-off', 'Recurring', 'Standing']);
    // Both surfaces starve — they share one resolver and one namespace gate.
    expect(fp.list).toBe('Recurring');
    // The axis label still arrives translated: it came off the RESPONSE, not
    // the bundle. That is why the two chrome axes are recorded separately.
    expect(fp.serverChrome).toBe('数量');
    // THE discriminator: the app-bundle chrome degrades to the authored string,
    // and the reporter's title and description were Chinese.
    expect(fp.bundleChrome).toBe('Form');
    // The bundle HAS every option translation — it is simply unreachable.
    expect(ZH_BUNDLE_UNDISCOVERABLE.zh.duly.fieldOptions.duly_duty.form.recurring).toBe('周期性');
  });

  it('NEGATIVE CONTROL (5) — no I18nProvider in scope: the CHROME goes English too', async () => {
    const { view, channel } = renderPage({ provider: false });
    const fp = await fingerprint(view.container, channel);

    expect(fp.chart).toEqual(['One-off', 'Recurring', 'Standing']);
    expect(fp.list).toBe('Recurring');
    expect(fp.serverChrome).toBe('数量');
    expect(fp.bundleChrome).toBe('Form');
  });

  /**
   * The decision. Stated as a comparison over the recorded fingerprints rather
   * than as a claim about the reporter's install, which is not reachable from
   * here: what is decided is which paths CAN produce what was reported, and
   * which are excluded by it.
   */
  it('DECISION — the reported fingerprint admits (1), (2) and (3b), and EXCLUDES (3a), (4) and (5)', async () => {
    const runs: Array<[string, PageOptions]> = [
      ['1', { omitObject: true }],
      ['2', { chartDoc: null }],
      ['3a', { chartDoc: DUTY_NO_OPTIONS, listDoc: DUTY_NO_OPTIONS }],
      ['3b', { chartDoc: DUTY_NO_OPTIONS, listDoc: DUTY_NO_OPTIONS, listColumnOptions: FORM_OPTIONS }],
      ['4', { resources: ZH_BUNDLE_UNDISCOVERABLE }],
      ['5', { provider: false }],
    ];

    const matches: string[] = [];
    for (const [name, opts] of runs) {
      const { view, channel } = renderPage(opts);
      const fp = await fingerprint(view.container, channel);
      // The reporter, in four readings: an English chart, a correct list, and
      // chrome that is Chinese from BOTH of its sources.
      const isReported =
        !fp.chart.some(isChinese) &&
        isChinese(fp.list) &&
        isChinese(fp.serverChrome) &&
        isChinese(fp.bundleChrome);
      if (isReported) matches.push(name);
      cleanup();
      capturedChartProps = null;
    }

    expect(matches).toEqual(['1', '2', '3b']);
  });
});
