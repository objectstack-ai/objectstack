// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12243 — a dataset-bound report laid out a select dimension in the
 * dataset's `GROUP BY` order, i.e. alphabetically by STORED value, so the
 * HotCRM reports read Closed Won, Needs Analysis, Negotiation, Proposal,
 * Prospecting, Qualification (zh-CN: 成交, 需求分析, 谈判, 提案, 寻找客户,
 * 资格审查), and a bar chart beside the table drew the same order.
 *
 * The ruling (the card's Acceptance): report table rows, and their charts,
 * follow the field's DECLARED option order. The reading is objectui#11809's:
 * declared options first, values the options do not declare next, the empty
 * bucket last; a dimension with no options keeps its order; an explicit author
 * order is the author's and is left alone.
 *
 * The fixtures mirror the three reports the card names, as HotCRM declares them
 * (`opportunity.report.ts`, `case.report.ts`; the options are
 * `OPPORTUNITY_STAGE_OPTIONS` and `crm_case`'s `status` / `priority`): all three
 * are `type: 'summary'` dataset reports with no `order`, so they render through
 * `DatasetReportTable` and `DatasetReportChart`.
 *
 * DIRECTIONS, written before the ablation was run. The mutation hands
 * `arrangeByDeclaredOptions` no ranks (every caller keeps the dataset's order),
 * with every test file kept:
 *  - RED: every case under "lays out" (table rows, chart categories, the
 *    two-dimension tables, the matrix axes, the zh-CN case, the drill on a moved
 *    row: its click waits for the row to move);
 *  - GREEN on both sides, on purpose: the three CONTROLs (a text dimension, an
 *    explicit `order` on the table and chart, the funnel's own `categoryOrder`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer, type DatasetDrillArgs } from '../DatasetReportRenderer';

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
// HotCRM `crm_case.status` / `crm_case.priority`, in their declared order.
const STATUS_OPTIONS = [
  { label: 'New', value: 'new' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Waiting on Customer', value: 'waiting_customer' },
  { label: 'Waiting on Support', value: 'waiting_support' },
  { label: 'Escalated', value: 'escalated' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Closed', value: 'closed' },
];
const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
];

const META_DOCS: Record<string, unknown> = {
  crm_opportunity: {
    name: 'crm_opportunity',
    fields: {
      stage: { type: 'select', options: STAGE_OPTIONS },
      owner_id: { type: 'lookup', reference: 'sys_user' },
      region: { type: 'text' },
    },
  },
  crm_case: {
    name: 'crm_case',
    fields: {
      status: { type: 'select', options: STATUS_OPTIONS },
      priority: { type: 'select', options: PRIORITY_OPTIONS },
    },
  },
};

const ZH_BUNDLE = {
  zh: {
    crm: {
      // A namespace is read only when it carries an app-metadata key such as
      // `fields` (`useObjectLabel`'s namespace discovery).
      fields: { crm_opportunity: { stage: '阶段' } },
      fieldOptions: {
        crm_opportunity: {
          stage: {
            prospecting: '寻找客户',
            qualification: '资格审查',
            needs_analysis: '需求分析',
            proposal: '提案',
            negotiation: '谈判',
            closed_won: '成交',
          },
        },
      },
    },
  },
};

const META_OBJECT_ROUTE = /^\/api\/v1\/meta\/object\/(.+)$/;
let metaCalls: string[] = [];

beforeEach(() => {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      metaCalls.push(url);
      const m = META_OBJECT_ROUTE.exec(url);
      const doc = m ? META_DOCS[decodeURIComponent(m[1])] : undefined;
      if (!doc) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ item: doc }) };
    }),
  );
});

/** The keys of the schema the registered `chart` component is handed that these pins read. */
type CapturedChartSchema = { chartType?: string; categoryOrder?: string[]; data?: Array<Record<string, unknown>> };
let captured: { schema: CapturedChartSchema } | null = null;
beforeEach(() => {
  captured = null;
  ComponentRegistry.register('chart', (props: { schema: CapturedChartSchema }) => {
    captured = props;
    return null;
  });
});

afterEach(() => {
  // Only the metadata route is answered; anything else is an escape.
  expect(metaCalls.filter((u) => !META_OBJECT_ROUTE.test(u))).toEqual([]);
  // Unmount before restoring the real `fetch` (see DatasetReportRenderer.test.tsx).
  cleanup();
  vi.unstubAllGlobals();
});

type Result = Record<string, unknown>;
type Selection = { dimensions: string[]; measures: string[]; order?: Record<string, string> };

/** Answer each dataset selection by its dimension list, recording what was asked. */
function sourceByDimensions(byDims: Record<string, Result>) {
  const calls: Selection[] = [];
  return {
    calls,
    queryDataset: vi.fn(async (_dataset: string, selection: Selection) => {
      calls.push(selection);
      return byDims[selection.dimensions.join(',')] ?? { rows: [] };
    }),
  };
}

/** The first cell of every body row of the report's (one) table. */
const firstCells = (table: HTMLElement) =>
  Array.from(table.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('td')?.textContent);
const rowCells = (table: HTMLElement) =>
  Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td')).map((td) => td.textContent),
  );
const chartCategories = (key: string) => (captured?.schema?.data ?? []).map((r) => r[key]);

// ── Opportunities by Stage ─────────────────────────────────────────────────
// Server-resolved to the AUTHORED label (ADR-0021), in `GROUP BY` order: the
// stored values alphabetically, NULL first. `legacy_stage` is a stored value
// the options do not declare (it arrives unresolved); the null row is the
// empty bucket.
const STAGE_RESULT = {
  rows: [
    { stage: null, total_amount: 5, avg_probability: 0 },
    { stage: 'Closed Won', total_amount: 600, avg_probability: 100 },
    { stage: 'legacy_stage', total_amount: 7, avg_probability: 0 },
    { stage: 'Needs Analysis', total_amount: 300, avg_probability: 40 },
    { stage: 'Negotiation', total_amount: 500, avg_probability: 80 },
    { stage: 'Proposal', total_amount: 400, avg_probability: 60 },
    { stage: 'Prospecting', total_amount: 100, avg_probability: 10 },
    { stage: 'Qualification', total_amount: 200, avg_probability: 20 },
  ],
  fields: [
    { name: 'stage', type: 'string', label: 'Stage' },
    { name: 'total_amount', type: 'number', label: 'Total Amount' },
    { name: 'avg_probability', type: 'number', label: 'Avg Probability' },
  ],
  object: 'crm_opportunity',
  dimensionFields: { stage: 'stage' },
  drillRawRows: [
    { stage: null },
    { stage: 'closed_won' },
    { stage: 'legacy_stage' },
    { stage: 'needs_analysis' },
    { stage: 'negotiation' },
    { stage: 'proposal' },
    { stage: 'prospecting' },
    { stage: 'qualification' },
  ],
};
const DECLARED_STAGE_ROWS = [
  'Prospecting',
  'Qualification',
  'Needs Analysis',
  'Proposal',
  'Negotiation',
  'Closed Won',
  'legacy_stage',
  '—',
];

const OPPORTUNITIES_BY_STAGE = {
  name: 'opportunities_by_stage',
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['stage'],
  values: ['total_amount', 'avg_probability'],
  chart: { type: 'bar', title: 'Pipeline by Stage', showLegend: true, xAxis: 'stage', yAxis: 'total_amount' },
};

// ── Opportunity Funnel by Owner → Stage ────────────────────────────────────
// `owner` is a lookup (no options); its users arrive in stored-id order, which
// is deliberately NOT their display-name order.
const OWNER_STAGE_RESULT = {
  rows: [
    { owner: 'Zoe Admin', stage: 'Closed Won', total_amount: 1 },
    { owner: 'Zoe Admin', stage: 'Proposal', total_amount: 2 },
    { owner: 'Zoe Admin', stage: 'Qualification', total_amount: 3 },
    { owner: 'Amy Chen', stage: 'Needs Analysis', total_amount: 4 },
    { owner: 'Amy Chen', stage: 'Negotiation', total_amount: 5 },
    { owner: 'Amy Chen', stage: 'Prospecting', total_amount: 6 },
  ],
  fields: [
    { name: 'owner', type: 'lookup', label: 'Owner' },
    { name: 'stage', type: 'string', label: 'Stage' },
    { name: 'total_amount', type: 'number', label: 'Total Amount' },
  ],
  object: 'crm_opportunity',
  dimensionFields: { owner: 'owner_id', stage: 'stage' },
};
const FUNNEL_CHART_RESULT = {
  rows: [
    { stage: 'Closed Won', total_amount: 1 },
    { stage: 'Needs Analysis', total_amount: 4 },
    { stage: 'Negotiation', total_amount: 5 },
    { stage: 'Proposal', total_amount: 2 },
    { stage: 'Prospecting', total_amount: 6 },
    { stage: 'Qualification', total_amount: 3 },
  ],
  fields: [
    { name: 'stage', type: 'string', label: 'Stage' },
    { name: 'total_amount', type: 'number', label: 'Total Amount' },
  ],
  object: 'crm_opportunity',
  dimensionFields: { stage: 'stage' },
};

// ── Cases by Status and Priority ───────────────────────────────────────────
const STATUS_PRIORITY_RESULT = {
  rows: [
    { status: 'Closed', priority: 'High', case_count: 1 },
    { status: 'Closed', priority: 'Low', case_count: 2 },
    { status: 'Escalated', priority: 'Critical', case_count: 3 },
    { status: 'In Progress', priority: 'High', case_count: 4 },
    { status: 'In Progress', priority: 'Medium', case_count: 5 },
    { status: 'New', priority: 'Low', case_count: 6 },
    { status: 'New', priority: 'Medium', case_count: 7 },
  ],
  fields: [
    { name: 'status', type: 'string', label: 'Status' },
    { name: 'priority', type: 'string', label: 'Priority' },
    { name: 'case_count', type: 'number', label: 'Cases' },
  ],
  object: 'crm_case',
  dimensionFields: { status: 'status', priority: 'priority' },
};
const STATUS_CHART_RESULT = {
  rows: [
    { status: 'Closed', case_count: 3 },
    { status: 'Escalated', case_count: 3 },
    { status: 'In Progress', case_count: 9 },
    { status: 'New', case_count: 13 },
  ],
  fields: [
    { name: 'status', type: 'string', label: 'Status' },
    { name: 'case_count', type: 'number', label: 'Cases' },
  ],
  object: 'crm_case',
  dimensionFields: { status: 'status' },
};

describe('a report lays out a select dimension in its declared option order (objectui#12243)', () => {
  it('Opportunities by Stage: the table rows, with an undeclared value next and the empty bucket last', async () => {
    const src = sourceByDimensions({ stage: STAGE_RESULT });
    render(<DatasetReportRenderer report={OPPORTUNITIES_BY_STAGE} dataSource={src} />);
    const table = await screen.findByRole('table');
    await waitFor(() => expect(firstCells(table)).toEqual(DECLARED_STAGE_ROWS));
    // Each row still carries its own measures: the row moved, not its cells.
    expect(rowCells(table)[0]).toEqual(['Prospecting', '100', '10']);
    expect(rowCells(table)[5]).toEqual(['Closed Won', '600', '100']);
  });

  it('Opportunities by Stage: the bar chart draws its categories in the same order', async () => {
    const src = sourceByDimensions({ stage: STAGE_RESULT });
    render(<DatasetReportRenderer report={OPPORTUNITIES_BY_STAGE} dataSource={src} />);
    await waitFor(() =>
      expect(chartCategories('stage')).toEqual([
        'Prospecting',
        'Qualification',
        'Needs Analysis',
        'Proposal',
        'Negotiation',
        'Closed Won',
        'legacy_stage',
        '(None)',
      ]),
    );
    expect(captured!.schema.chartType).toBe('bar');
  });

  it('zh-CN, as measured on hosted HotCRM: the localized rows read in pipeline order', async () => {
    const src = sourceByDimensions({ stage: STAGE_RESULT });
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: ZH_BUNDLE }}>
        <DatasetReportRenderer report={OPPORTUNITIES_BY_STAGE} dataSource={src} />
      </I18nProvider>,
    );
    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(firstCells(table)).toEqual(['寻找客户', '资格审查', '需求分析', '提案', '谈判', '成交', 'legacy_stage', '—']),
    );
    await waitFor(() =>
      expect(chartCategories('stage').slice(0, 6)).toEqual(['寻找客户', '资格审查', '需求分析', '提案', '谈判', '成交']),
    );
  });

  it('a drill on a moved row opens THAT row’s records', async () => {
    const src = sourceByDimensions({ stage: STAGE_RESULT });
    const drills: DatasetDrillArgs[] = [];
    render(
      <DatasetReportRenderer
        report={{ ...OPPORTUNITIES_BY_STAGE, chart: undefined }}
        dataSource={src}
        onDrill={(a) => drills.push(a)}
      />,
    );
    const table = await screen.findByRole('table');
    // Click only once the rows have moved: Prospecting arrived seventh.
    await waitFor(() => expect(firstCells(table)[0]).toBe('Prospecting'));
    fireEvent.click(within(table).getAllByTestId('dataset-drill-row')[0]);
    await waitFor(() => expect(drills.length).toBe(1));
    expect(drills[0].groupKey).toEqual({ stage: 'Prospecting' });
    expect(drills[0].objectFilter).toMatchObject({ stage: 'prospecting' });
  });

  it('Opportunity Funnel by Owner → Stage: owners keep their order, stages follow theirs within each owner', async () => {
    const src = sourceByDimensions({ 'owner,stage': OWNER_STAGE_RESULT, stage: FUNNEL_CHART_RESULT });
    render(
      <DatasetReportRenderer
        report={{
          name: 'opportunity_funnel_owner_stage',
          type: 'summary',
          dataset: 'opportunity_metrics',
          rows: ['owner', 'stage'],
          values: ['total_amount'],
          chart: { type: 'funnel', title: 'Pipeline Funnel', showLegend: false, xAxis: 'stage', yAxis: 'total_amount' },
        }}
        dataSource={src}
      />,
    );
    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(rowCells(table)).toEqual([
        ['Zoe Admin', 'Qualification', '3'],
        ['Zoe Admin', 'Proposal', '2'],
        ['Zoe Admin', 'Closed Won', '1'],
        ['Amy Chen', 'Prospecting', '6'],
        ['Amy Chen', 'Needs Analysis', '4'],
        ['Amy Chen', 'Negotiation', '5'],
      ]),
    );
  });

  it('Cases by Status and Priority: status in its order, priority in its own within each status; the bar chart follows status', async () => {
    const src = sourceByDimensions({ 'status,priority': STATUS_PRIORITY_RESULT, status: STATUS_CHART_RESULT });
    render(
      <DatasetReportRenderer
        report={{
          name: 'cases_by_status_priority',
          type: 'summary',
          dataset: 'case_metrics',
          rows: ['status', 'priority'],
          values: ['case_count'],
          chart: { type: 'bar', title: 'Cases by Status', showLegend: true, xAxis: 'status', yAxis: 'case_count' },
        }}
        dataSource={src}
      />,
    );
    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(rowCells(table)).toEqual([
        ['New', 'Low', '6'],
        ['New', 'Medium', '7'],
        ['In Progress', 'Medium', '5'],
        ['In Progress', 'High', '4'],
        ['Escalated', 'Critical', '3'],
        ['Closed', 'Low', '2'],
        ['Closed', 'High', '1'],
      ]),
    );
    await waitFor(() => expect(chartCategories('status')).toEqual(['New', 'In Progress', 'Escalated', 'Closed']));
  });

  it('a matrix lays out both axes in their declared order, and every cell stays under its own headers', async () => {
    const src = sourceByDimensions({
      'status,priority': {
        rows: [
          { status: 'Closed', priority: 'High', case_count: 1 },
          { status: 'Closed', priority: 'Low', case_count: 2 },
          { status: 'Escalated', priority: 'Critical', case_count: 3 },
          { status: 'New', priority: 'Low', case_count: 6 },
          { status: 'New', priority: 'Medium', case_count: 7 },
        ],
        fields: STATUS_PRIORITY_RESULT.fields,
        object: 'crm_case',
        dimensionFields: { status: 'status', priority: 'priority' },
      },
    });
    render(
      <DatasetReportRenderer
        report={{
          name: 'status_priority_matrix',
          type: 'matrix',
          dataset: 'case_metrics',
          rows: ['status'],
          columns: ['priority'],
          values: ['case_count'],
        }}
        dataSource={src}
      />,
    );
    const matrix = await screen.findByTestId('dataset-matrix');
    await waitFor(() =>
      expect(Array.from(matrix.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([
        'Status',
        'Low',
        'Medium',
        'High',
        'Critical',
      ]),
    );
    await waitFor(() =>
      expect(rowCells(matrix)).toEqual([
        ['New', '6', '7', '—', '—'],
        ['Escalated', '—', '—', '—', '3'],
        ['Closed', '2', '—', '1', '—'],
      ]),
    );
  });
});

describe('CONTROLs — what keeps its order (objectui#12243)', () => {
  it('a dimension whose field declares no options keeps the dataset’s order', async () => {
    const src = sourceByDimensions({
      region: {
        rows: [
          { region: 'West', total_amount: 1 },
          { region: 'East', total_amount: 2 },
          { region: 'North', total_amount: 3 },
        ],
        fields: [
          { name: 'region', type: 'string', label: 'Region' },
          { name: 'total_amount', type: 'number', label: 'Total Amount' },
        ],
        object: 'crm_opportunity',
        dimensionFields: { region: 'region' },
      },
    });
    render(
      <DatasetReportRenderer
        report={{ name: 'by_region', type: 'summary', dataset: 'opportunity_metrics', rows: ['region'], values: ['total_amount'] }}
        dataSource={src}
      />,
    );
    const table = await screen.findByRole('table');
    // The metadata read is issued and answered: the object declares options on
    // OTHER fields, and none on this one.
    await waitFor(() => expect(metaCalls).toContain('/api/v1/meta/object/crm_opportunity'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(firstCells(table)).toEqual(['West', 'East', 'North']);
  });

  it('an explicit report `order` is the author’s: the table and the chart keep the server’s order', async () => {
    // "Biggest first" on the plotted measure, which the server applied.
    const byAmount = { ...STAGE_RESULT, rows: [...STAGE_RESULT.rows].sort((a, b) => b.total_amount - a.total_amount) };
    const src = sourceByDimensions({ stage: byAmount });
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: ZH_BUNDLE }}>
        <DatasetReportRenderer
          report={{ ...OPPORTUNITIES_BY_STAGE, order: [{ by: 'total_amount', direction: 'desc' }] }}
          dataSource={src}
        />
      </I18nProvider>,
    );
    const table = await screen.findByRole('table');
    // The relabel shows the metadata read landed before the order is read.
    await waitFor(() => expect(firstCells(table)[0]).toBe('成交'));
    expect(firstCells(table)).toEqual(['成交', '谈判', '提案', '需求分析', '资格审查', '寻找客户', 'legacy_stage', '—']);
    await waitFor(() => expect(chartCategories('stage')[0]).toBe('成交'));
    // The last category is the empty bucket, labelled by the zh bundle.
    expect(chartCategories('stage').slice(0, 7)).toEqual(['成交', '谈判', '提案', '需求分析', '资格审查', '寻找客户', 'legacy_stage']);
    expect(chartCategories('stage')).toHaveLength(8);
    // The author's order still went to the server, for both selections.
    expect(src.calls.map((c) => c.order)).toEqual([{ total_amount: 'desc' }, { total_amount: 'desc' }]);
  });

  it('the funnel still receives its declared `categoryOrder` (its own order, unchanged)', async () => {
    const src = sourceByDimensions({ 'owner,stage': OWNER_STAGE_RESULT, stage: FUNNEL_CHART_RESULT });
    render(
      <DatasetReportRenderer
        report={{
          name: 'opportunity_funnel_owner_stage',
          type: 'summary',
          dataset: 'opportunity_metrics',
          rows: ['owner', 'stage'],
          values: ['total_amount'],
          chart: { type: 'funnel', xAxis: 'stage', yAxis: 'total_amount' },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(captured?.schema?.categoryOrder).toBeDefined());
    expect(captured!.schema.chartType).toBe('funnel');
    expect(captured!.schema.categoryOrder).toEqual(
      STAGE_OPTIONS.flatMap((o) => [o.value, o.label]),
    );
  });
});
