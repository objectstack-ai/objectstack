// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4330, the report half — a dataset-bound REPORT renders a local
 * select dimension's authored ENGLISH option label under a zh-CN console.
 *
 * `DatasetReportRenderer` is the same shape as the dashboard's table/pivot
 * widget and for the same reason: it renders SERVER-RESOLVED rows (ADR-0021)
 * and, before this change, loaded no object schema at all. PR #4324 therefore
 * carried no change to this package — it measured the gap and wrote it up as
 * "what this does NOT close". With no option list on the client there is
 * nothing for the locale bundle (keyed by the option's stored VALUE) to
 * translate against.
 *
 * The fix is the SAME channel the dashboard uses, reached through
 * `useDatasetDimensionLabels` (`resolveDimensionFieldMeta` →
 * `buildDimensionLabelMap` → `relabelDimensions`, translator
 * `useSafeFieldLabel().fieldOptionLabel`). No report-side resolution dialect.
 *
 * DIRECTIONS, written before the reverse verification was run:
 *  - the zh-CN cases (tabular cells, matrix down-axis, matrix across headers,
 *    matrix totals, the embedded chart's categories) are RED before the change;
 *  - the two drill pins are red too, for a SEQUENCING reason rather than an
 *    assertion one: they wait for the translated cell so the click lands after
 *    the metadata read settles, and that wait is what fails without the seam.
 *    Their assertion — `groupKey` / `objectFilter` carrying the values the
 *    SERVER sent (objectui#4263 / #4273's convention) — is direction-
 *    independent, and clicking before the relabel would have proved nothing
 *    about a drill after it;
 *  - the `en` case is GREEN on both sides: a console with no translation keeps
 *    the exact label it renders today.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer, type DatasetDrillArgs } from '../DatasetReportRenderer';

const CHANNEL_OPTIONS = [
  { value: 'domestic', label: 'Domestic' },
  { value: 'export', label: 'Export' },
];
const COMPETITOR_OPTIONS = [
  { value: 'cabot', label: 'Cabot' },
  { value: 'orion', label: 'Orion Engineered Carbons' },
];

const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    sales_channel: { type: 'select', options: CHANNEL_OPTIONS },
    competitor_name: { type: 'select', options: COMPETITOR_OPTIONS },
  },
};

const ZH_BUNDLE = {
  zh: {
    crm: {
      fields: { crm_opportunity: { sales_channel: '销售渠道', competitor_name: '竞争对手' } },
      fieldOptions: {
        crm_opportunity: {
          sales_channel: { domestic: '国内', export: '出口' },
          competitor_name: { cabot: '卡博特', orion: '欧励隆' },
        },
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

function renderIn(language: string, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: ZH_BUNDLE }}>
      {ui}
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** One grouped row per channel, server-resolved to the AUTHORED label. */
const tabularResult = {
  rows: [
    { sales_channel: 'Domestic', deals: 7 },
    { sales_channel: 'Export', deals: 3 },
  ],
  fields: [
    { name: 'sales_channel', type: 'string', label: 'Sales Channel' },
    { name: 'deals', type: 'number', label: 'Deals' },
  ],
  object: 'crm_opportunity',
  dimensionFields: { sales_channel: 'sales_channel' },
  drillRawRows: [{ sales_channel: 'domestic' }, { sales_channel: 'export' }],
};

const cellsOf = (row: Element) => Array.from(row.querySelectorAll('td')).map((td) => td.textContent);

describe('DatasetReportRenderer tabular — local select dimensions localize (objectui#4330)', () => {
  it('renders the zh-CN option label in the report cells', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetReportRenderer
        report={{ name: 'r', type: 'tabular', dataset: 'd', rows: ['sales_channel'], values: ['deals'] }}
        dataSource={sourceOf(tabularResult)}
      />,
    );

    await waitFor(() => expect(screen.getByText('国内')).toBeTruthy());
    expect(screen.getByText('出口')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Domestic');
  });

  it('pins the read: ONE metadata fetch, on the dataset base object', async () => {
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetReportRenderer
        report={{ name: 'r', type: 'tabular', dataset: 'd', rows: ['sales_channel'], values: ['deals'] }}
        dataSource={sourceOf(tabularResult)}
      />,
    );
    await waitFor(() => expect(screen.getByText('国内')).toBeTruthy());
    expect(requested).toEqual(['crm_opportunity']);
  });

  it('BOUNDARY — under `en` the report reads exactly what it reads today', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'en',
      <DatasetReportRenderer
        report={{ name: 'r', type: 'tabular', dataset: 'd', rows: ['sales_channel'], values: ['deals'] }}
        dataSource={sourceOf(tabularResult)}
      />,
    );

    await waitFor(() => expect(screen.getByText('Domestic')).toBeTruthy());
    expect(document.body.textContent).not.toContain('国内');
  });

  it('a drilled row carries the values the SERVER sent, AFTER the relabel', async () => {
    // `groupKey` and `objectFilter` are what the host filters records with; the
    // display translating must not move them.
    //
    // Sequenced on the translated cell deliberately, which is why this pin is
    // in the RED set rather than a both-directions boundary: clicking as soon
    // as the rows exist races the metadata read, and a drill asserted before
    // the relabel lands proves nothing about a drill after it. There is no
    // direction-independent "the read settled" signal on this fixture — the
    // rows arrive server-resolved, so the translation IS the signal. The
    // ASSERTION below is direction-independent; only the sequencing is not.
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    const drills: DatasetDrillArgs[] = [];
    renderIn(
      'zh',
      <DatasetReportRenderer
        report={{ name: 'r', type: 'tabular', dataset: 'd', rows: ['sales_channel'], values: ['deals'] }}
        dataSource={sourceOf(tabularResult)}
        onDrill={(a) => drills.push(a)}
      />,
    );

    await screen.findByText('国内');
    const row = (await screen.findAllByTestId('dataset-drill-row'))[0];
    expect(cellsOf(row)[0]).toBe('国内');
    fireEvent.click(row);
    await waitFor(() => expect(drills.length).toBe(1));
    // The server-sent bucket value, never the localized one.
    expect(drills[0].groupKey).toEqual({ sales_channel: 'Domestic' });
    // …and the exact record filter still uses the RAW stored value.
    expect(drills[0].objectFilter).toMatchObject({ sales_channel: 'domestic' });
  });
});

describe('DatasetReportRenderer matrix — both axes and the totals (objectui#4330)', () => {
  const matrixResult = {
    rows: [
      { sales_channel: 'Domestic', competitor_name: 'Orion Engineered Carbons', deals: 5 },
      { sales_channel: 'Export', competitor_name: 'Cabot', deals: 7 },
    ],
    fields: [
      { name: 'sales_channel', type: 'string', label: 'Sales Channel' },
      { name: 'competitor_name', type: 'string', label: 'Competitor' },
      { name: 'deals', type: 'number', label: 'Deals' },
    ],
    object: 'crm_opportunity',
    dimensionFields: { sales_channel: 'sales_channel', competitor_name: 'competitor_name' },
    drillRawRows: [
      { sales_channel: 'domestic', competitor_name: 'orion' },
      { sales_channel: 'export', competitor_name: 'cabot' },
    ],
    // Server-resolved on the same ADR-0021 pass as the rows.
    totals: [
      {
        dimensions: ['sales_channel'],
        rows: [
          { sales_channel: 'Domestic', deals: 5 },
          { sales_channel: 'Export', deals: 7 },
        ],
      },
      {
        dimensions: ['competitor_name'],
        rows: [
          { competitor_name: 'Orion Engineered Carbons', deals: 5 },
          { competitor_name: 'Cabot', deals: 7 },
        ],
      },
      { dimensions: [], rows: [{ deals: 12 }] },
    ],
  };

  it('localizes the down axis and the across headers, keeping server totals aligned', async () => {
    // The subtotal lookup is keyed by the same bucket ids the headers are built
    // from, so relabeling one side only would blank every total cell. That is
    // what the totals assertions pin.
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetReportRenderer
        report={{
          name: 'r',
          type: 'matrix',
          dataset: 'd',
          rows: ['sales_channel'],
          columns: ['competitor_name'],
          values: ['deals'],
        }}
        dataSource={sourceOf(matrixResult)}
      />,
    );

    const matrix = await screen.findByTestId('dataset-matrix');
    await waitFor(() => {
      const down = Array.from(matrix.querySelectorAll('tbody tr td')).map((td) => td.textContent);
      expect(down).toContain('国内');
      expect(down).toContain('出口');
    });
    const headers = Array.from(matrix.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toContain('欧励隆');
    expect(headers).toContain('卡博特');
    expect(headers).not.toContain('Orion Engineered Carbons');

    const rowTotals = within(matrix).getAllByTestId('matrix-row-total').map((td) => td.textContent);
    expect(rowTotals).toEqual(['5', '7']);
    expect(within(matrix).getByTestId('matrix-grand-total').textContent).toBe('12');
  });

  it('a drilled CELL carries the values the SERVER sent, AFTER the relabel', async () => {
    // Same shape as the tabular pin above, and in the RED set for the same
    // sequencing reason. The matrix is where it matters most: the header a user
    // clicks under is built from the DISPLAY row while `key` comes from the RAW
    // one, and those are two different objects in this renderer.
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    const drills: DatasetDrillArgs[] = [];
    renderIn(
      'zh',
      <DatasetReportRenderer
        report={{
          name: 'r',
          type: 'matrix',
          dataset: 'd',
          rows: ['sales_channel'],
          columns: ['competitor_name'],
          values: ['deals'],
        }}
        dataSource={sourceOf(matrixResult)}
        onDrill={(a) => drills.push(a)}
      />,
    );

    // Wait for the relabel to land before clicking (see the pin above).
    await screen.findByText('国内');
    const cell = (await screen.findAllByTestId('dataset-drill-cell'))[0];
    // Guard on the click landing on the row it looks like it lands on.
    expect(cellsOf(cell.closest('tr')!)[0]).toBe('国内');
    fireEvent.click(cell);
    await waitFor(() => expect(drills.length).toBe(1));
    expect(drills[0].groupKey).toEqual({
      sales_channel: 'Domestic',
      competitor_name: 'Orion Engineered Carbons',
    });
    expect(drills[0].objectFilter).toMatchObject({
      sales_channel: 'domestic',
      competitor_name: 'orion',
    });
  });
});

describe("DatasetReportRenderer embedded chart — one screen, one spelling (objectui#4330)", () => {
  it('plots the localized category, matching the table beneath it', async () => {
    // The report's chart groups by the SAME dimension the table does. Leaving
    // it out would put 国内 in the table and `Domestic` on the axis of the very
    // same report.
    let captured: any = null;
    ComponentRegistry.register('chart', (props: any) => {
      captured = props;
      return null;
    });
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetReportRenderer
        report={{
          name: 'r',
          type: 'tabular',
          dataset: 'd',
          rows: ['sales_channel'],
          values: ['deals'],
          chart: { type: 'bar', xAxis: 'sales_channel', yAxis: 'deals' },
        }}
        dataSource={sourceOf(tabularResult)}
      />,
    );

    await waitFor(() => {
      const categories = (captured?.schema?.data ?? []).map((r: any) => r.sales_channel);
      expect(categories).toContain('国内');
    });
    const categories = (captured.schema.data ?? []).map((r: any) => r.sales_channel);
    expect(categories).not.toContain('Domestic');
  });
});
