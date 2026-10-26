// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8187 — the metadata-admin dataset PREVIEW goes through the
 * dimension-label net, like the platform's three other analytics chart
 * producers (`plugin-dashboard`'s `DatasetWidget`, `plugin-report`'s
 * `DatasetReportRenderer`, `plugin-charts`' `ObjectChart`).
 *
 * ## The defect shape, and why a green suite proved nothing
 *
 * The preview handed `state.rows` to `ChartRenderer` exactly as they arrived,
 * so the x axis plotted whatever the analytics layer grouped by. Nothing threw
 * and nothing was red: the axis rendered a PLAUSIBLE string (`MFG`) where a
 * label (`Manufacturing`) belonged. This surface is the screen an author uses
 * to judge "is my dataset right?", so a raw enum here reads as "my dataset is
 * wrong" and invites editing a correct configuration.
 *
 * ## The two arms, which are two different defects
 *
 *  - **dotted dimension** (objectui#4053 / #4263): the server resolves NOTHING
 *    for a dotted path (`crm_account.industry`) — the options live on the
 *    relationship's TARGET — so the rows carry the stored enum and only the
 *    client net can produce a label;
 *  - **local select** (objectui#4330): a local dimension arrives
 *    server-resolved to the object's AUTHORED English label, which is what a
 *    non-English session reads until the net applies the locale bundle.
 *
 * ## Positive control, in the same run as each arm
 *
 * The failure mode this guards against is a dead channel reading as a fixed
 * defect. So each arm asserts, in the same render, something that ALREADY
 * worked before this change and travels a channel this change does not touch:
 *
 *  - arm 1 pins the preview's own measure header (`headerLabel`, the field
 *    helper the preview has always used) — if the fixture or the adapter mock
 *    were dead, `Revenue` would not render either;
 *  - arm 2 pins a zh-CN FIELD label out of the same bundle the option labels
 *    come from — if the locale channel were dead, that would be English too,
 *    and the option assertion's failure could not be read as "not relabelled".
 *
 * ## Where the axis is read
 *
 * `ChartRenderer` is recharts-backed and does not lay out in happy-dom
 * (`clientWidth` 0, no container-size effect) — the same measurement the three
 * reference producers' pins record, which is why each of them captures the
 * schema handed to the chart rather than asserting on SVG. This preview does
 * not dispatch through `ComponentRegistry`, so the equivalent capture is the
 * lazy `@object-ui/plugin-charts` module's `ChartRenderer`. The rows fed to the
 * chart and the rows fed to the table are ONE derivation in the component, so
 * the table cells below — real rendered DOM — are the second, independent
 * reading of the same fact.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
// Same pre-warm as the sibling `DatasetPreview.test.tsx`, for the same reason:
// the preview reaches its chart through `React.lazy(() => import(...))`, and
// resolving that graph is unbounded work that can outlast RTL's 1000ms window.
// Importing it here moves the cost into this file's import phase, which no test
// or hook timeout applies to. It matters MORE here than there, because the
// `vi.mock` factory below inherits the real module — so the module the lazy
// factory awaits is still the full (recharts-backed) graph. Keep the specifier
// identical to DatasetPreview.tsx's; ESM caches by resolved specifier.
import '@object-ui/plugin-charts';
import { DatasetPreview } from '../DatasetPreview';

// Capture the schema the preview hands the chart. The component reaches
// `ChartRenderer` through `React.lazy(() => import('@object-ui/plugin-charts'))`,
// so the double is installed on that module and the lazy factory resolves to it.
//
// The factory INHERITS the real module's export surface and overrides one name
// (objectui#6849): a hand-listed factory freezes the surface at whatever was
// typed today, and the next export any module in this file's import graph reads
// at module scope resolves to `undefined` — killing the file during COLLECTION,
// where it reads as flake rather than as a test failure.
const { capturedChartSchemas } = vi.hoisted(() => ({ capturedChartSchemas: [] as any[] }));
vi.mock('@object-ui/plugin-charts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChartRenderer: ({ schema }: { schema: any }) => {
    capturedChartSchemas.push(schema);
    return null;
  },
}));

// Mock the data adapter the preview pulls from AdapterProvider.
const { queryDataset } = vi.hoisted(() => ({ queryDataset: vi.fn() }));
vi.mock('../../../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ queryDataset }),
}));

/**
 * Route `GET /api/v1/meta/object/<name>` to a per-object document, recording the
 * object names asked for. A name with no document 404s the way a real server
 * would. Installing it also keeps this file off a real socket — the preview's
 * metadata read would otherwise resolve `/api/v1/...` against happy-dom's
 * default `localhost:3000` origin and trip the network-escape guard.
 */
function installMetaRouter(docs: Record<string, unknown>) {
  const requested: string[] = [];
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    const m = /\/api\/v1\/meta\/object\/(.+)$/.exec(url);
    const name = m ? decodeURIComponent(m[1]) : '';
    requested.push(name);
    const doc = docs[name];
    if (!doc) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ item: doc }) };
  }) as any;
  return { requested };
}

const realFetch = global.fetch;
afterEach(() => {
  cleanup();
  queryDataset.mockReset();
  capturedChartSchemas.length = 0;
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

const baseProps = { type: 'dataset', name: 'sales', locale: 'en-US' as const };

/** The x-axis categories the chart received, in row order. */
function axisCategories(): unknown[] {
  const schema = capturedChartSchemas[capturedChartSchemas.length - 1];
  const key = schema?.xAxisKey;
  return ((schema?.data ?? []) as Array<Record<string, unknown>>).map((r) => r[key]);
}

/** Cell texts of the result table's rows, in column order. */
const rowCells = (i: number): string[] =>
  Array.from(document.querySelectorAll('tbody tr')[i]?.querySelectorAll('td') ?? []).map(
    (td) => td.textContent ?? '',
  );

// ── Arm 1 — a DOTTED dimension (objectui#4053 / #4263) ──────────────────────

const INDUSTRY_OPTIONS = [
  { value: 'MFG', label: 'Manufacturing' },
  { value: 'FIN', label: 'Financial Services' },
];

/** Base object: the `crm_account` relationship the dotted path walks. */
const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: { crm_account: { type: 'lookup', reference: 'crm_account' } },
};
/** The relationship's TARGET, where the dotted path's options actually live. */
const ACCOUNT = {
  name: 'crm_account',
  fields: { industry: { type: 'select', options: INDUSTRY_OPTIONS } },
};

const dottedDraft = {
  name: 'sales',
  label: 'Sales',
  object: 'crm_opportunity',
  include: ['crm_account'],
  dimensions: [{ name: 'account_industry', field: 'crm_account.industry' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};

/** Rows as analytics returns them for a dotted path: the STORED enum. */
const DOTTED_RESULT = {
  rows: [
    { account_industry: 'MFG', revenue: 100 },
    { account_industry: 'FIN', revenue: 50 },
  ],
  object: 'crm_opportunity',
  fields: [
    { name: 'account_industry', type: 'string', label: 'Account Industry' },
    { name: 'revenue', type: 'number', label: 'Revenue' },
  ],
};

describe('DatasetPreview relabels a DOTTED dimension (objectui#8187, #4053 shape)', () => {
  it('puts the resolved label on the chart axis, not the raw stored value', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    queryDataset.mockResolvedValue(DOTTED_RESULT);
    render(<DatasetPreview {...baseProps} draft={dottedDraft} />);

    // POSITIVE CONTROL, same run: the measure header the preview already
    // resolved through `headerLabel` before this change. A dead fixture or a
    // dead adapter mock takes this down too, so its green is what makes the
    // axis assertion below readable as "not relabelled" rather than "nothing
    // rendered at all".
    expect(await screen.findByRole('columnheader', { name: 'Revenue' })).toBeInTheDocument();

    await waitFor(() => expect(axisCategories()).toEqual(['Manufacturing', 'Financial Services']));
    // The raw enum must not survive anywhere on the surface — the table below
    // the chart is fed from the SAME derivation and is real rendered DOM.
    expect(rowCells(0)[0]).toBe('Manufacturing');
    expect(rowCells(1)[0]).toBe('Financial Services');
    expect(document.body.textContent).not.toContain('MFG');
  });

  it('walks the RELATIONSHIP TARGET for the options, not the base object', async () => {
    // The mechanism pin: `crm_account.industry`'s options are on `crm_account`,
    // and a base-object-only lookup is exactly how this defect class
    // (objectui#4053) reads a plausible wrong value instead of erroring.
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    queryDataset.mockResolvedValue(DOTTED_RESULT);
    render(<DatasetPreview {...baseProps} draft={dottedDraft} />);

    await waitFor(() => expect(axisCategories()).toEqual(['Manufacturing', 'Financial Services']));
    expect(requested).toContain('crm_account');
  });

  it('BOUNDARY — an unresolvable path leaves the rows exactly as the server sent them', async () => {
    // Best-effort by construction: the relationship target 404s, so nothing
    // resolves and the preview renders what it rendered before this card. This
    // is green on BOTH sides of the change and is labelled as such — it pins
    // the degradation, not the defect.
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    queryDataset.mockResolvedValue(DOTTED_RESULT);
    render(<DatasetPreview {...baseProps} draft={dottedDraft} />);

    expect(await screen.findByRole('columnheader', { name: 'Revenue' })).toBeInTheDocument();
    await waitFor(() => expect(axisCategories()).toEqual(['MFG', 'FIN']));
  });
});

// ── Arm 2 — a LOCAL select on a non-English locale (objectui#4330) ───────────

const CHANNEL_OPTIONS = [
  { value: 'domestic', label: 'Domestic' },
  { value: 'export', label: 'Export' },
];

const LOCAL_OBJECT = {
  name: 'crm_opportunity',
  fields: { sales_channel: { type: 'select', options: CHANNEL_OPTIONS } },
};

const ZH_BUNDLE = {
  zh: {
    crm: {
      fields: { crm_opportunity: { sales_channel: '销售渠道' } },
      fieldOptions: { crm_opportunity: { sales_channel: { domestic: '国内', export: '出口' } } },
    },
  },
};

const localDraft = {
  name: 'sales',
  label: 'Sales',
  object: 'crm_opportunity',
  dimensions: [{ name: 'sales_channel', field: 'sales_channel' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};

/**
 * A LOCAL dimension arrives server-resolved (ADR-0021): the rows already carry
 * the object's AUTHORED English label. That is precisely why the screen reads
 * English on a zh session, and why the label map is keyed by the authored label
 * as well as by the stored value.
 */
const LOCAL_RESULT = {
  rows: [
    { sales_channel: 'Domestic', revenue: 100 },
    { sales_channel: 'Export', revenue: 50 },
  ],
  object: 'crm_opportunity',
  fields: [
    { name: 'sales_channel', type: 'string', label: 'Sales Channel' },
    { name: 'revenue', type: 'number', label: 'Revenue' },
  ],
};

function renderIn(language: string, ui: React.ReactElement) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: ZH_BUNDLE }}
      persistLanguage={false}
    >
      {ui}
    </I18nProvider>,
  );
}

describe('DatasetPreview localizes a LOCAL select dimension (objectui#8187, #4330 shape)', () => {
  it('renders the zh-CN option labels on the axis, not the authored English', async () => {
    installMetaRouter({ crm_opportunity: LOCAL_OBJECT });
    queryDataset.mockResolvedValue(LOCAL_RESULT);
    renderIn('zh', <DatasetPreview {...baseProps} draft={localDraft} />);

    // POSITIVE CONTROL, same run: the zh FIELD label out of the SAME bundle the
    // option labels come from. If the locale channel were dead this header
    // would read `Sales Channel`, and the axis assertion's failure could not be
    // told apart from "not relabelled".
    expect(await screen.findByRole('columnheader', { name: '销售渠道' })).toBeInTheDocument();

    await waitFor(() => expect(axisCategories()).toEqual(['国内', '出口']));
    expect(rowCells(0)[0]).toBe('国内');
    expect(document.body.textContent).not.toContain('Domestic');
  });

  it('BOUNDARY — an untranslated session keeps the authored English exactly', async () => {
    // Green on both sides, labelled: an app with no bundle entry for the locale
    // must read the same as it did before this card.
    installMetaRouter({ crm_opportunity: LOCAL_OBJECT });
    queryDataset.mockResolvedValue(LOCAL_RESULT);
    renderIn('en', <DatasetPreview {...baseProps} draft={localDraft} />);

    expect(await screen.findByRole('columnheader', { name: 'Sales Channel' })).toBeInTheDocument();
    await waitFor(() => expect(axisCategories()).toEqual(['Domestic', 'Export']));
  });
});
