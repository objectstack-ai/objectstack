// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28206 — a report chart draws its `seriesBy` split.
 *
 * `ReportChartSchema.seriesBy` (`@objectstack/spec`) names a SECOND dataset
 * dimension that splits the chart's one `yAxis` measure into a series per value
 * of it: HotCRM's `opportunity_funnel_owner_stage` wants a bar per owner, split
 * by stage. The key was declared and checked at publish, but
 * `DatasetReportChart` queried `[xAxis]` × `[yAxis]` alone, so the split was
 * never drawn. The chart now queries `[xAxis, seriesBy]` × `[yAxis]` and hands
 * both dimensions to `buildChartSeries`, whose pivot branch is the one the
 * dashboard's two-dimension widget already takes.
 *
 * Pinned here:
 *  - the chart's own query carries the split, and the chart is handed one row
 *    per owner and one series per stage, each row carrying its stages' amounts;
 *  - the series follow the split dimension's DECLARED option order, the empty
 *    group last, as the categories do;
 *  - an authored `series[]` entry names a VALUE of the split (the spec's reading
 *    with `seriesBy` set): its presentation lands on that series, and its label
 *    resolves in the UI language;
 *  - the CONTROL, the same chart without `seriesBy`, queries and draws exactly
 *    what it did before: one dimension, one series, the measure's label.
 *
 * DIRECTIONS, written before the ablation was run. The mutation drops the split
 * from the chart's query (`queryDimensions` back to `[xAxis]` alone):
 *  - RED: the three split cases (the query has no `stage`, the chart gets one
 *    `total_amount` series and no per-stage columns);
 *  - GREEN on both sides: the control, which must not move a byte.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

// HotCRM `OPPORTUNITY_STAGE_OPTIONS`, in its declared (pipeline) order.
const STAGE_OPTIONS = [
  { label: 'Prospecting', value: 'prospecting' },
  { label: 'Qualification', value: 'qualification' },
  { label: 'Needs Analysis', value: 'needs_analysis' },
  { label: 'Proposal', value: 'proposal' },
  { label: 'Negotiation', value: 'negotiation' },
  { label: 'Closed Won', value: 'closed_won' },
  { label: 'Closed Lost', value: 'closed_lost' },
];

const META_DOCS: Record<string, unknown> = {
  crm_opportunity: {
    name: 'crm_opportunity',
    fields: {
      stage: { type: 'select', options: STAGE_OPTIONS },
      owner_id: { type: 'lookup', reference: 'sys_user' },
    },
  },
};

const META_OBJECT_ROUTE = /^\/api\/v1\/meta\/object\/(.+)$/;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const m = META_OBJECT_ROUTE.exec(String(input));
      const doc = m ? META_DOCS[decodeURIComponent(m[1])] : undefined;
      if (!doc) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ item: doc }) };
    }),
  );
});

type ChartSeries = { dataKey: string; label: string; color?: string };
type CapturedChartSchema = { xAxisKey?: string; series?: ChartSeries[]; data?: Array<Record<string, unknown>> };
let captured: { schema: CapturedChartSchema } | null = null;
beforeEach(() => {
  captured = null;
  ComponentRegistry.register('chart', (props: { schema: CapturedChartSchema }) => {
    captured = props;
    return null;
  });
});

afterEach(() => {
  // Unmount before restoring the real `fetch` (see DatasetReportRenderer.test.tsx).
  cleanup();
  vi.unstubAllGlobals();
});

type Selection = { dimensions: string[]; measures: string[] };

/** Answer each dataset selection by its dimension list, recording what was asked. */
function sourceByDimensions(byDims: Record<string, Record<string, unknown>>) {
  const calls: Selection[] = [];
  return {
    calls,
    queryDataset: vi.fn(async (_dataset: string, selection: Selection) => {
      calls.push(selection);
      return byDims[selection.dimensions.join(',')] ?? { rows: [] };
    }),
  };
}

const FIELDS = [
  { name: 'owner', type: 'lookup', label: 'Owner' },
  { name: 'stage', type: 'string', label: 'Stage' },
  { name: 'total_amount', type: 'number', label: 'Total Amount' },
];

// Server-resolved to the authored stage label (ADR-0021), in `GROUP BY` order:
// stored values alphabetically, NULL first.
const OWNER_STAGE_RESULT = {
  rows: [
    { owner: 'Zoe Admin', stage: null, total_amount: 9 },
    { owner: 'Zoe Admin', stage: 'Closed Won', total_amount: 1 },
    { owner: 'Zoe Admin', stage: 'Proposal', total_amount: 2 },
    { owner: 'Amy Chen', stage: 'Negotiation', total_amount: 5 },
    { owner: 'Amy Chen', stage: 'Prospecting', total_amount: 6 },
  ],
  fields: FIELDS,
  object: 'crm_opportunity',
  dimensionFields: { owner: 'owner_id', stage: 'stage' },
};

const OWNER_RESULT = {
  rows: [
    { owner: 'Zoe Admin', total_amount: 12 },
    { owner: 'Amy Chen', total_amount: 11 },
  ],
  fields: [FIELDS[0], FIELDS[2]],
  object: 'crm_opportunity',
  dimensionFields: { owner: 'owner_id' },
};

const FUNNEL_BY_OWNER_STAGE = {
  name: 'opportunity_funnel_owner_stage',
  type: 'summary',
  dataset: 'opportunity_metrics',
  // The table groups by owner alone, so the only selection that names `stage`
  // is the chart's own.
  rows: ['owner'],
  values: ['total_amount'],
  chart: { type: 'bar', xAxis: 'owner', yAxis: 'total_amount', seriesBy: 'stage' },
};

const NONE = '(None)';

function renderReport(report: Record<string, unknown>, src: ReturnType<typeof sourceByDimensions>, language?: string) {
  const element = <DatasetReportRenderer report={report as never} dataSource={src as never} />;
  render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: {} }}>
        {element}
      </I18nProvider>
    ) : (
      element
    ),
  );
}

describe('a report chart draws its seriesBy split (objectstack#28206)', () => {
  it('queries [xAxis, seriesBy] × [yAxis] and hands the chart a row per owner, a series per stage', async () => {
    const src = sourceByDimensions({ 'owner,stage': OWNER_STAGE_RESULT, owner: OWNER_RESULT });
    renderReport(FUNNEL_BY_OWNER_STAGE, src);
    await waitFor(() => expect(captured?.schema?.series?.length).toBe(5));
    // The table asks for `owner`; the chart asks for the split and the one measure.
    expect(src.calls).toContainEqual(
      expect.objectContaining({ dimensions: ['owner', 'stage'], measures: ['total_amount'] }),
    );
    const schema = captured!.schema;
    expect(schema.xAxisKey).toBe('owner');
    expect(schema.data).toEqual([
      { owner: 'Zoe Admin', [NONE]: 9, 'Closed Won': 1, Proposal: 2 },
      { owner: 'Amy Chen', Negotiation: 5, Prospecting: 6 },
    ]);
  });

  it('lists the series in the split dimension\'s declared option order, the empty group last', async () => {
    const src = sourceByDimensions({ 'owner,stage': OWNER_STAGE_RESULT, owner: OWNER_RESULT });
    renderReport(FUNNEL_BY_OWNER_STAGE, src);
    // The order lands once the stage options are read; arrival order is
    // `(None), Closed Won, Proposal, Negotiation, Prospecting`.
    await waitFor(() =>
      expect(captured?.schema?.series?.map((s) => s.label)).toEqual([
        'Prospecting',
        'Proposal',
        'Negotiation',
        'Closed Won',
        NONE,
      ]),
    );
    // Each series keeps the column it plots.
    expect(captured!.schema.series!.map((s) => s.dataKey)).toEqual([
      'Prospecting',
      'Proposal',
      'Negotiation',
      'Closed Won',
      NONE,
    ]);
  });

  it('pairs an authored series[] entry with the split VALUE it names, its label in the UI language', async () => {
    const src = sourceByDimensions({ 'owner,stage': OWNER_STAGE_RESULT, owner: OWNER_RESULT });
    renderReport(
      {
        ...FUNNEL_BY_OWNER_STAGE,
        chart: {
          ...FUNNEL_BY_OWNER_STAGE.chart,
          series: [{ name: 'Proposal', label: { en: 'Proposals', zh: '提案阶段' }, color: '#ff0000' }],
        },
      },
      src,
      'zh',
    );
    await waitFor(() => expect(captured?.schema?.series?.length).toBe(5));
    const proposal = captured!.schema.series!.find((s) => s.dataKey === 'Proposal');
    expect(proposal).toMatchObject({ label: '提案阶段', color: '#ff0000' });
    // The entry names one value; the other series are untouched.
    const won = captured!.schema.series!.find((s) => s.dataKey === 'Closed Won');
    expect(won?.label).toBe('Closed Won');
    expect(won?.color).toBeUndefined();
  });

  it('the control — the same chart without seriesBy — queries one dimension and draws one series', async () => {
    const src = sourceByDimensions({ 'owner,stage': OWNER_STAGE_RESULT, owner: OWNER_RESULT });
    const { seriesBy: _split, ...chart } = FUNNEL_BY_OWNER_STAGE.chart;
    renderReport({ ...FUNNEL_BY_OWNER_STAGE, chart }, src);
    await waitFor(() => expect(captured?.schema?.data?.length).toBe(2));
    // Table and chart both ask for `owner` alone: nothing asks for the split.
    expect(src.calls.length).toBeGreaterThan(0);
    expect(src.calls.every((c) => c.dimensions.join(',') === 'owner')).toBe(true);
    const schema = captured!.schema;
    expect(schema.xAxisKey).toBe('owner');
    expect(schema.series).toEqual([expect.objectContaining({ dataKey: 'total_amount', label: 'Total Amount' })]);
    expect(schema.data).toEqual(OWNER_RESULT.rows);
  });
});
