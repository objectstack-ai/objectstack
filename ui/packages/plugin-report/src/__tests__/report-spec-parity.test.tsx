/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Report type & chart type ↔ spec vocabulary parity + behavior (#2941).
 *
 * Two Tier-1 findings lived in this renderer:
 *
 * 1. `mapReportChartType` collapsed 10 of the 19 `ChartTypeSchema` values to
 *    a BAR — an author who declared `funnel` or `treemap` got a plausible
 *    wrong picture with no warning anywhere.
 * 2. `tabular` vs `summary` was resolved from the DATA (whether `rows` was
 *    non-empty), never from the declared type — the two types shared one
 *    branch and the type dropdown did nothing.
 *
 * Contract under test:
 * - parity: `planReportChart` classifies exactly the spec's 19 chart names
 *   (none fall through to `unsupported`), and `resolveReportPresentation`
 *   maps exactly the spec's 4 report types;
 * - behavior: the classifier's families reach distinct renderings — series
 *   types keep their name (no bar collapse), single-value types render a
 *   number, tabular types add no duplicate chart, out-of-spec values get a
 *   visible notice;
 * - behavior: `summary` renders the server-computed totals footer, `tabular`
 *   does not — same selection, distinct presentation, driven by the type.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ChartTypeSchema, ReportType } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import {
  DatasetReportRenderer,
  planReportChart,
  resolveReportPresentation,
} from '../DatasetReportRenderer';

const specChartTypes: string[] = enumOptions(ChartTypeSchema);

const specReportTypes: string[] = enumOptions(ReportType);

describe('planReportChart covers the spec chart vocabulary', () => {
  it('reads a non-empty enum from the spec', () => {
    expect(specChartTypes, 'could not read ChartTypeSchema.options from the spec').not.toEqual([]);
  });

  it('classifies every spec chart type onto a real branch', () => {
    const unsupported = specChartTypes.filter((name) => planReportChart(name).kind === 'unsupported');
    expect(
      unsupported,
      'these validate against ChartTypeSchema but hit the out-of-spec branch — classify them in planReportChart',
    ).toEqual([]);
  });

  it('never collapses a non-bar series family to bar', () => {
    const collapsed = specChartTypes.filter((name) => {
      const plan = planReportChart(name);
      // `column` IS the spec's vertical-bar alias — the generic chart draws
      // it as a bar by definition, so it is exempt.
      return plan.kind === 'series' && plan.chartType === 'bar' && name !== 'bar' && name !== 'column';
    });
    expect(collapsed, 'these silently drew a bar chart before #2941').toEqual([]);
  });

  it('flags an out-of-spec value instead of guessing', () => {
    expect(planReportChart('sunburst')).toEqual({ kind: 'unsupported', type: 'sunburst' });
  });
});

describe('resolveReportPresentation covers the spec report-type vocabulary', () => {
  it('reads a non-empty enum from the spec', () => {
    expect(specReportTypes, 'could not read ReportType.options from the spec').not.toEqual([]);
  });

  it('maps every spec report type onto its own presentation', () => {
    const mapped = Object.fromEntries(specReportTypes.map((name) => [name, resolveReportPresentation(name)]));
    expect(mapped).toEqual({
      tabular: 'tabular',
      summary: 'summary',
      matrix: 'matrix',
      joined: 'joined',
    });
  });

  it("falls back to the spec's declared default ('tabular') for absent values", () => {
    expect(resolveReportPresentation(undefined)).toBe('tabular');
  });
});

type MockRows = Array<Record<string, unknown>>;
type MockResult = { rows: MockRows; totals?: Array<{ dimensions: string[]; rows: MockRows }> };

function makeSource(byDataset: Record<string, MockRows | MockResult>) {
  const calls: Array<{ dataset: string; selection: any }> = [];
  return {
    calls,
    queryDataset: vi.fn(async (dataset: string, selection: unknown) => {
      calls.push({ dataset, selection: selection as any });
      const entry = byDataset[dataset];
      if (Array.isArray(entry)) return { rows: entry };
      return { rows: entry?.rows ?? [], ...(entry?.totals ? { totals: entry.totals } : {}) };
    }),
  };
}

const bucketRows = [
  { status: 'Backlog', est_hours: 30 },
  { status: 'Done', est_hours: 24 },
];

describe('summary vs tabular is driven by the declared type', () => {
  beforeEach(() => vi.clearAllMocks());

  it('summary requests the grand total and renders the totals footer', async () => {
    const src = makeSource({
      task_metrics: { rows: bucketRows, totals: [{ dimensions: [], rows: [{ est_hours: 54 }] }] },
    });
    render(
      <DatasetReportRenderer
        report={{ name: 'r', type: 'summary', dataset: 'task_metrics', rows: ['status'], values: ['est_hours'] }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('dataset-report-total-row')).toBeInTheDocument());
    expect(src.calls[0].selection.totals).toEqual({ groupings: [[]] });
    expect(screen.getByTestId('dataset-report-total-row').textContent).toContain('54');
  });

  it('tabular renders the same selection with no totals request and no footer', async () => {
    const src = makeSource({
      task_metrics: { rows: bucketRows, totals: [{ dimensions: [], rows: [{ est_hours: 54 }] }] },
    });
    render(
      <DatasetReportRenderer
        report={{ name: 'r', type: 'tabular', dataset: 'task_metrics', rows: ['status'], values: ['est_hours'] }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(screen.getByText('Backlog')).toBeInTheDocument());
    expect(src.calls[0].selection.totals).toBeUndefined();
    expect(screen.queryByTestId('dataset-report-total-row')).not.toBeInTheDocument();
  });

  it('an older server returning no totals renders the summary table without a footer', async () => {
    const src = makeSource({ task_metrics: bucketRows });
    render(
      <DatasetReportRenderer
        report={{ name: 'r', type: 'summary', dataset: 'task_metrics', rows: ['status'], values: ['est_hours'] }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(screen.getByText('Backlog')).toBeInTheDocument());
    expect(screen.queryByTestId('dataset-report-total-row')).not.toBeInTheDocument();
  });
});

describe('embedded chart families render per plan', () => {
  beforeEach(() => vi.clearAllMocks());

  const reportWithChart = (type: string) => ({
    name: 'r',
    type: 'summary',
    dataset: 'task_metrics',
    rows: ['status'],
    values: ['est_hours'],
    chart: { type, xAxis: 'status', yAxis: 'est_hours' },
  });

  it('a single-value chart (kpi) queries the measure with NO dimension and renders the number', async () => {
    const src = makeSource({ task_metrics: { rows: [{ est_hours: 54 }] } });
    render(<DatasetReportRenderer report={reportWithChart('kpi')} dataSource={src} />);
    await waitFor(() => expect(screen.getByTestId('dataset-report-metric')).toBeInTheDocument());
    // The metric card's own query: measures only, no grouping dimension.
    const metricCall = src.calls.find((c) => Array.isArray(c.selection.dimensions) && c.selection.dimensions.length === 0);
    expect(metricCall, 'expected a dimensionless dataset query for the single-value chart').toBeTruthy();
    expect(metricCall!.selection.measures).toEqual(['est_hours']);
    expect(screen.getByTestId('dataset-report-metric').textContent).toContain('54');
  });

  it("a tabular chart type ('table') adds no duplicate chart", async () => {
    const src = makeSource({ task_metrics: bucketRows });
    render(<DatasetReportRenderer report={reportWithChart('table')} dataSource={src} />);
    await waitFor(() => expect(screen.getByText('Backlog')).toBeInTheDocument());
    expect(screen.queryByTestId('dataset-report-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dataset-report-metric')).not.toBeInTheDocument();
  });

  it('an out-of-spec chart type renders a visible notice, not a silent bar', async () => {
    const src = makeSource({ task_metrics: bucketRows });
    render(<DatasetReportRenderer report={reportWithChart('sunburst')} dataSource={src} />);
    await waitFor(() => expect(screen.getByTestId('dataset-report-chart-unsupported')).toBeInTheDocument());
    expect(screen.getByTestId('dataset-report-chart-unsupported').textContent).toContain('sunburst');
    expect(screen.queryByTestId('dataset-report-chart')).not.toBeInTheDocument();
  });
});
