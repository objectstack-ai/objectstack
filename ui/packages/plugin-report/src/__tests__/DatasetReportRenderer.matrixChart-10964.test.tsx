// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10964 — a `matrix` report with `columns` draws its declared `chart`
 * beside the cross-tab.
 *
 * `ReportSchema` (`@objectstack/spec`) accepts a matrix report carrying a
 * non-empty `columns` AND a `chart`, but the renderer's cross-tab branch
 * returned `DatasetMatrixTable` before the only `report.chart` read, so the
 * chart was parsed and never drawn. The ruling on
 * objectstack-ai/objectstack#20293 is ENFORCE: the renderer draws it, beside or
 * below the cross-tab, through the SAME `chart.xAxis` / `chart.yAxis` → dataset
 * dimension / measure binding the summary arm uses. No new binding rule: the
 * chart runs its own `[xAxis] × [yAxis]` dataset query, and a matrix's `rows`
 * and `columns` are dataset dimensions exactly like a summary's `rows`.
 *
 * Pinned here:
 *  - a matrix report with `columns` and a `chart` draws BOTH, the chart after
 *    the cross-tab, from its own axis-pair query;
 *  - the control, the same report without `chart`, draws the cross-tab only
 *    and issues the cross-tab's query only;
 *  - the axis may name the ACROSS dimension too — it is a dataset dimension,
 *    bound the same way;
 *  - an out-of-spec chart type on a matrix reaches the same visible notice the
 *    summary arm shows, in the same slot.
 *
 * PREDICTIONS, written before the run: the first, third and fourth cases RED
 * before the fix (no chart slot, no chart query); the control GREEN on both
 * sides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

/** The schema the registered chart component was last handed, or `null`. */
type ChartProps = { schema: Record<string, unknown> };
let captured: ChartProps | null = null;

beforeEach(() => {
  captured = null;
  ComponentRegistry.register('chart', (props: ChartProps) => {
    captured = props;
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Selection = { dimensions: string[]; measures: string[] };

const CROSS_TAB_ROWS = [
  { status: 'Backlog', priority: 'High', est_hours: 10 },
  { status: 'Backlog', priority: 'Low', est_hours: 20 },
  { status: 'Done', priority: 'High', est_hours: 14 },
];

/**
 * A dataset source that answers by SELECTION, the way the server does: the
 * cross-tab's query groups by every dimension, the chart's by its one axis.
 */
function makeSource() {
  const calls: Selection[] = [];
  const queryDataset = vi.fn(async (_dataset: string, selection: unknown) => {
    const sel = selection as Selection;
    calls.push(sel);
    const dims = sel.dimensions.join(',');
    if (dims === 'status,priority') return { rows: CROSS_TAB_ROWS };
    if (dims === 'status') return { rows: [{ status: 'Backlog', est_hours: 30 }, { status: 'Done', est_hours: 14 }] };
    if (dims === 'priority') return { rows: [{ priority: 'High', est_hours: 24 }, { priority: 'Low', est_hours: 20 }] };
    return { rows: [] };
  });
  return { calls, queryDataset };
}

const MATRIX = {
  name: 'hours_by_status_and_priority',
  type: 'matrix',
  dataset: 'task_metrics',
  rows: ['status'],
  columns: ['priority'],
  values: ['est_hours'],
} as const;

/** The categories the chart component was handed, read off its own x key. */
const plottedCategories = () => {
  const schema = captured?.schema;
  if (!schema) return null;
  return (schema.data as Array<Record<string, unknown>>).map((d) => d[schema.xAxisKey as string]);
};

/** True when `later` comes after `earlier` in document order. */
const follows = (earlier: Element, later: Element) =>
  (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('a matrix report with columns draws its declared chart (objectui#10964)', () => {
  it('draws the cross-tab AND the chart, the chart below the cross-tab, from its own axis-pair query', async () => {
    const src = makeSource();
    render(
      <DatasetReportRenderer
        report={{ ...MATRIX, chart: { type: 'bar', xAxis: 'status', yAxis: 'est_hours' } } as never}
        dataSource={src as never}
      />,
    );
    const matrix = await screen.findByTestId('dataset-matrix');
    const chart = await screen.findByTestId('dataset-report-chart');
    // Below the cross-tab — the placement the ruling names.
    expect(follows(matrix, chart)).toBe(true);
    // The cross-tab still pivots over every dimension, with its totals.
    expect(src.calls).toContainEqual(
      expect.objectContaining({ dimensions: ['status', 'priority'], measures: ['est_hours'] }),
    );
    // The chart binds the summary arm's way: `xAxis` → one dataset dimension,
    // `yAxis` → one dataset measure, in a query of its own.
    expect(src.calls).toContainEqual(expect.objectContaining({ dimensions: ['status'], measures: ['est_hours'] }));
    await waitFor(() => expect(plottedCategories()).toEqual(['Backlog', 'Done']));
    expect(captured!.schema.chartType).toBe('bar');
  });

  it('the control — the same report without `chart` — draws the cross-tab only', async () => {
    const src = makeSource();
    render(<DatasetReportRenderer report={MATRIX as never} dataSource={src as never} />);
    await screen.findByTestId('dataset-matrix');
    await waitFor(() => expect(screen.getByText('14')).toBeInTheDocument());
    expect(screen.queryByTestId('dataset-report-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dataset-report-metric')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dataset-report-chart-unsupported')).not.toBeInTheDocument();
    // One query: the cross-tab's. Nothing asked for a chart.
    expect(src.calls.map((c) => c.dimensions)).toEqual([['status', 'priority']]);
    expect(captured).toBeNull();
  });

  it('binds an axis naming the ACROSS dimension the same way — it is a dataset dimension', async () => {
    const src = makeSource();
    render(
      <DatasetReportRenderer
        report={{ ...MATRIX, chart: { type: 'pie', xAxis: 'priority', yAxis: 'est_hours' } } as never}
        dataSource={src as never}
      />,
    );
    await screen.findByTestId('dataset-matrix');
    await screen.findByTestId('dataset-report-chart');
    expect(src.calls).toContainEqual(expect.objectContaining({ dimensions: ['priority'], measures: ['est_hours'] }));
    await waitFor(() => expect(plottedCategories()).toEqual(['High', 'Low']));
    expect(captured!.schema.chartType).toBe('pie');
  });

  it('an out-of-spec chart type on a matrix reaches the visible notice, below the cross-tab', async () => {
    const src = makeSource();
    render(
      <DatasetReportRenderer
        report={{ ...MATRIX, chart: { type: 'sunburst', xAxis: 'status', yAxis: 'est_hours' } } as never}
        dataSource={src as never}
      />,
    );
    const matrix = await screen.findByTestId('dataset-matrix');
    const notice = await screen.findByTestId('dataset-report-chart-unsupported');
    expect(notice.textContent).toContain('sunburst');
    expect(follows(matrix, notice)).toBe(true);
    expect(screen.queryByTestId('dataset-report-chart')).not.toBeInTheDocument();
  });
});
