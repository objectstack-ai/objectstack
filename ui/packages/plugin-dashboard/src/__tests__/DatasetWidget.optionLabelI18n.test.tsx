/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4030 (source thread objectstack#5076) — a dashboard widget resolves
 * a `select` dimension's option label and then renders the object's authored
 * ENGLISH label, while the related list on the same page renders the zh-CN
 * translation. One screen, one value, two spellings.
 *
 * The reporter's own fixture is used verbatim, because its decisive row is
 * `orion`: the chart showed `Orion Engineered Carbons`, a string with no
 * resemblance to the stored value, matching the object's `label` exactly. So
 * the label WAS resolved — it just never went through the locale bundle. (The
 * `domestic → Domestic` row differs from its value by case alone, which is why
 * this was first mis-diagnosed as "the report groups by stored value"; it is
 * kept here as the second dimension of the pivot case for that reason.)
 *
 * WHICH CHANNEL. There is exactly one, and it is not new: `fieldOptionLabel`
 * from `useObjectLabel` — `{ns}.fieldOptions.<object>.<field>.<value>`, the
 * convention `@objectstack/spec` names objectui as the reader of, and the one
 * list and form surfaces already translate select options through
 * (`translateOptions` → `SelectCellRenderer`; objectui#3336 pinned the same
 * "one source, two faces" property for the record picker). Analytics reuses it
 * at the label net's output rather than growing a chart-side dialect.
 *
 * DIRECTIONS, written before the reverse verification was run:
 *  - the three zh-CN cases are RED before the change (they render the authored
 *    English label — that IS the bug);
 *  - the `en` case, the no-bundle-entry case and the drill-identity case are
 *    GREEN on both sides. They are the acceptance boundary: an app with no
 *    translation must keep the exact label it renders today (the card's
 *    "downstream impact" is precisely about not losing it), and the STORED
 *    value must keep addressing the data (display translates, identity keys do
 *    not — objectui#4263's convention).
 *
 * ⚠️ AMENDED BY objectui#4330. The last pin in this file was #4263's
 * no-metadata-read boundary restated under a mounted bundle, and it was the
 * measured record of what #4324 did NOT close: a LOCAL select on a table
 * rendered `Orion Engineered Carbons` under `zh` because the client had no
 * option list to translate against. The PM amended that boundary deliberately
 * (see the pin's own comment); the widened behaviour has its own suite in
 * `DatasetWidget.localSelectI18n.test.tsx`. Everything else here is untouched.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetWidget } from '../DatasetWidget';

/** Capture what the widget hands the chart renderer (jsdom lays out no SVG). */
let capturedChartProps: any = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: any) => {
    capturedChartProps = props;
    return null;
  });
});

/** Observe the drill filter without rendering the real drawer. */
const drillFilters: Array<Record<string, unknown>> = [];
vi.mock('../DrillDownDrawer', () => ({
  DrillDownDrawer: ({ filter }: { filter: Record<string, unknown> }) => {
    drillFilters.push(filter);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  capturedChartProps = null;
  drillFilters.length = 0;
  vi.restoreAllMocks();
});

/** The card's field, on the card's object. */
const COMPETITOR_OPTIONS = [
  { value: 'cabot', label: 'Cabot' },
  { value: 'orion', label: 'Orion Engineered Carbons' },
  // No bundle entry — the untranslated-option boundary.
  { value: 'birla', label: 'Birla Carbon' },
];
const CHANNEL_OPTIONS = [
  { value: 'domestic', label: 'Domestic' },
  { value: 'export', label: 'Export' },
];

const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    competitor_name: { type: 'select', options: COMPETITOR_OPTIONS },
    sales_channel: { type: 'select', options: CHANNEL_OPTIONS },
    crm_account: { type: 'lookup', reference: 'crm_account' },
  },
};
/** The relationship target — where a DOTTED dimension's options really live. */
const ACCOUNT = {
  name: 'crm_account',
  fields: { industry: { type: 'select', options: [{ value: 'education', label: 'Education' }] } },
};

/**
 * The reporter's zh-CN bundle. `fields` is present alongside `fieldOptions`
 * because that is what makes `crm` discoverable as an app namespace (a real
 * bundle carries both) — see `getAppNamespaces`.
 */
const ZH_BUNDLE = {
  zh: {
    crm: {
      fields: {
        crm_opportunity: { competitor_name: '竞争对手', sales_channel: '销售渠道' },
        crm_account: { industry: '行业' },
      },
      fieldOptions: {
        crm_opportunity: {
          competitor_name: { cabot: '卡博特', orion: '欧励隆' },
          sales_channel: { domestic: '国内', export: '出口' },
        },
        // Keyed by the object that OWNS the field, which for the dotted
        // dimension below is the relationship TARGET, not the dataset's base.
        crm_account: { industry: { education: '教育' } },
      },
    },
  },
};

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

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

/** A value-keyed chart result — the server did NOT resolve the dimension. */
const valueKeyedChart = () =>
  sourceOf({
    rows: [
      { competitor_name: 'orion', deals: 7 },
      { competitor_name: 'cabot', deals: 3 },
      { competitor_name: 'birla', deals: 1 },
    ],
    fields: [
      { name: 'competitor_name', type: 'select', label: 'Competitor' },
      { name: 'deals', type: 'number', label: 'Deals' },
    ],
    object: 'crm_opportunity',
    dimensionFields: { competitor_name: 'competitor_name' },
    drillRawRows: [
      { competitor_name: 'orion' },
      { competitor_name: 'cabot' },
      { competitor_name: 'birla' },
    ],
  });

/** The same result AFTER the server resolved the dimension (ADR-0021). */
const serverResolvedChart = () =>
  sourceOf({
    rows: [
      { competitor_name: 'Orion Engineered Carbons', deals: 7 },
      { competitor_name: 'Cabot', deals: 3 },
    ],
    fields: [
      { name: 'competitor_name', type: 'select', label: 'Competitor' },
      { name: 'deals', type: 'number', label: 'Deals' },
    ],
    object: 'crm_opportunity',
    dimensionFields: { competitor_name: 'competitor_name' },
    drillRawRows: [{ competitor_name: 'orion' }, { competitor_name: 'cabot' }],
  });

function renderIn(language: string, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: ZH_BUNDLE }}>
      {ui}
    </I18nProvider>,
  );
}

const categories = () => (capturedChartProps?.schema?.data ?? []).map((r: any) => r.competitor_name);

describe('DatasetWidget chart — select-option labels run through the i18n bundle (objectui#4030)', () => {
  it('renders the zh-CN option label on a VALUE-keyed chart', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'd', dimensions: ['competitor_name'], values: ['deals'] }}
        dataSource={valueKeyedChart()}
      />,
    );
    await waitFor(() => expect(categories()).toContain('欧励隆'));
    expect(categories()).toContain('卡博特');
    // The authored English label must not survive beside the translation.
    expect(categories()).not.toContain('Orion Engineered Carbons');
  });

  it('re-translates a chart the SERVER already resolved to the English label', async () => {
    // This is the reported screen: the rows arrive carrying the object's
    // authored label verbatim. A value-keyed map alone cannot touch them, so a
    // fix that only handles the un-resolved case would leave the issue open.
    installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'd', dimensions: ['competitor_name'], values: ['deals'] }}
        dataSource={serverResolvedChart()}
      />,
    );
    await waitFor(() => expect(categories()).toContain('欧励隆'));
    expect(categories()).not.toContain('Orion Engineered Carbons');
  });

  it('keeps the measure attached to its (now translated) category', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'd', dimensions: ['competitor_name'], values: ['deals'] }}
        dataSource={valueKeyedChart()}
      />,
    );
    await waitFor(() => expect(categories()).toContain('欧励隆'));
    const byCategory = Object.fromEntries(
      capturedChartProps.schema.data.map((r: any) => [r.competitor_name, r.deals]),
    );
    expect(byCategory).toMatchObject({ 欧励隆: 7, 卡博特: 3 });
  });

  it('BOUNDARY — an option the bundle does not carry keeps its authored label', async () => {
    // Green on both sides. The card's downstream-impact section is exactly
    // about not trading the English label away for the locales that have none.
    installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'd', dimensions: ['competitor_name'], values: ['deals'] }}
        dataSource={valueKeyedChart()}
      />,
    );
    // Deliberately NOT sequenced on the translated category: waiting for `欧励隆`
    // here would make this pin fail with the others when the seam is removed,
    // and a boundary that cannot stay green through the reverse verification is
    // not pinning a boundary. `Birla Carbon` is itself the resolved-label
    // signal — the raw rows carry `birla`.
    await waitFor(() => expect(categories()).toContain('Birla Carbon'));
    expect(categories()).not.toContain('birla');
  });

  it('BOUNDARY — under `en` the chart reads exactly what it reads today', async () => {
    // Green on both sides: the same bundle is mounted, and an `en` console must
    // still see the object's authored labels.
    installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    renderIn(
      'en',
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'd', dimensions: ['competitor_name'], values: ['deals'] }}
        dataSource={valueKeyedChart()}
      />,
    );
    await waitFor(() => expect(categories()).toContain('Orion Engineered Carbons'));
    expect(categories()).not.toContain('欧励隆');
  });

  it('BOUNDARY — a segment click still drills by the STORED value, whatever it displays', async () => {
    // Display translates; identity keys do not (objectui#4263's convention).
    // The click is made with WHATEVER the `orion` bar reads — `欧励隆` with
    // the seam in place, `Orion Engineered Carbons` without it — so this pin
    // holds green in both directions and is about the filter alone. The bar is
    // found by what it reads, not by its position: the chart lists the field's
    // options in their declared order (objectui#11809), which puts `cabot`
    // first.
    installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{
          type: 'bar',
          dataset: 'd',
          dimensions: ['competitor_name'],
          values: ['deals'],
          drillDown: { enabled: true },
        }}
        dataSource={valueKeyedChart()}
      />,
    );
    await waitFor(() => expect(categories()).toContain('Birla Carbon'));
    // The click arrives with the DISPLAYED category — the chart knows no other.
    const displayed = categories().find((c: unknown) => c === '欧励隆' || c === 'Orion Engineered Carbons');
    expect(displayed).toBeDefined();
    expect(displayed).not.toBe('orion');
    capturedChartProps.onSegmentClick({ category: displayed });
    await waitFor(() => expect(drillFilters.length).toBeGreaterThan(0));
    expect(drillFilters[drillFilters.length - 1]).toMatchObject({ competitor_name: 'orion' });
  });
});

describe('DatasetWidget table/pivot — the dotted gap-fill translates too (objectui#4030 × #4263)', () => {
  it('renders the zh-CN label for a DOTTED dimension, keyed by the RELATIONSHIP TARGET', async () => {
    // The bundle entry lives under `crm_account.industry`, not
    // `crm_opportunity.<the dotted path>`. Keying it against the dataset's base
    // object — or against the path as though it were a field name — resolves to
    // nothing, so this case is what pins the owner the walk resolved.
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{ type: 'table', dataset: 'd', dimensions: ['acct_industry'], values: ['total'] }}
        dataSource={sourceOf({
          rows: [{ acct_industry: 'education', total: 10 }],
          fields: [
            { name: 'acct_industry', type: 'select', label: 'Industry' },
            { name: 'total', type: 'number', label: 'Total' },
          ],
          object: 'crm_opportunity',
          dimensionFields: { acct_industry: 'crm_account.industry' },
        })}
      />,
    );
    await waitFor(() => expect(screen.getByText('教育')).toBeTruthy());
    // It got there through the walk #4261 already performs — no second channel.
    expect(requested).toEqual(['crm_opportunity', 'crm_account']);
  });

  it('AMENDED (#4330) — a LOCAL select on a table now reads the bundle too', async () => {
    // ⚠️ This pin is the one objectui#4330 amended, and it is where #4324's
    // measured gap was recorded. It used to read "a LOCAL-only table still
    // resolves nothing and fetches nothing": `expect(requested).toEqual([])`
    // and the cell asserted as `Orion Engineered Carbons` UNDER A MOUNTED zh
    // BUNDLE — i.e. this test's own green was the bug's pin. #4324's summary
    // said so out loud ("what this does NOT close"): the server resolves that
    // label in English, the bundle is keyed by the stored VALUE, and #4263's
    // boundary forbade the one read that could connect the two.
    //
    // Amended by PM ruling on #4330: the read is issued, the same seam applies,
    // and the cell reads the translation the related list beside it reads.
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{ type: 'table', dataset: 'd', dimensions: ['competitor_name'], values: ['total'] }}
        dataSource={sourceOf({
          rows: [{ competitor_name: 'Orion Engineered Carbons', total: 10 }],
          fields: [
            { name: 'competitor_name', type: 'select', label: 'Competitor' },
            { name: 'total', type: 'number', label: 'Total' },
          ],
          object: 'crm_opportunity',
          dimensionFields: { competitor_name: 'competitor_name' },
        })}
      />,
    );
    await waitFor(() => expect(screen.getByText('欧励隆')).toBeTruthy());
    expect(screen.queryByText('Orion Engineered Carbons')).toBeNull();
    // ONE read, on the dataset's base object — a local path walks no
    // relationship, so `crm_account` is never fetched.
    expect(requested).toEqual(['crm_opportunity']);
  });
});
