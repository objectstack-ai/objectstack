// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7495 — a dataset CHART widget of a family that ignores `compareTo`
 * asks the executor for NO comparison.
 *
 * Which families ignore it is `chartTypeIgnoresCompareTo` in `@object-ui/core`
 * — the one declaration ObjectChart reads too. Until this card the dashboard
 * kept its own, narrower copy (`chartType === 'scatter'`), so a compare-to pie /
 * donut / funnel widget still forwarded `compareTo`, still had its date window
 * lowered into `timeDimensions`, and so still made the executor run the
 * comparison pass — whose overlay series the renderer then dropped.
 *
 * What is pinned is the QUERY, not just the drawing: the selection handed to
 * `queryDataset` carries no `compareTo` and no `timeDimensions`, and is
 * byte-identical to the selection of the same widget with no `compareTo` at
 * all. Every widget-type spelling that renders as one of the four families is
 * covered — `pyramid` renders as `funnel` and `bubble` as `scatter`
 * (CHART_TYPE_MAP), so a guard written against the widget type instead of the
 * chart family would miss them.
 *
 * Two controls make the absences mean something: `bar` and `line` widgets with
 * the same `compareTo` still forward it and still get their overlay, and a pie
 * widget with NO dimensions — which renders as a metric tile, where the
 * comparison IS shown as a delta — keeps its comparison too.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

let lastChartSchema: any = null;

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: (props: any) => {
    lastChartSchema = props.schema;
    return null;
  },
}));

import { DatasetWidget } from '../DatasetWidget';

afterEach(() => {
  cleanup();
  lastChartSchema = null;
});

const Q2 = { close_date: { $gte: '2026-04-01', $lte: '2026-06-30' } };

/**
 * An executor double that behaves like the real one on the axis under test: it
 * attaches `revenue__compare` ONLY when the selection asked for a comparison.
 */
const makeSource = () => ({
  queryDataset: vi.fn(async (_dataset: string, selection: any) => ({
    rows: [
      { stage: 'won', revenue: 120, ...(selection?.compareTo ? { revenue__compare: 100 } : {}) },
      { stage: 'lost', revenue: 20, ...(selection?.compareTo ? { revenue__compare: 40 } : {}) },
    ],
    fields: [{ name: 'revenue', type: 'number', label: 'Revenue' }],
  })),
});

const widgetOf = (type: string, extra: Record<string, unknown> = {}) => ({
  type, dataset: 'sales', dimensions: ['stage'], values: ['revenue'],
  filter: { ...Q2, owner: 'u1' },
  ...extra,
});

const renderWidget = (widget: Record<string, unknown>, dataSource: unknown) =>
  render(<DatasetWidget widget={widget} dataSource={dataSource} />);

const selectionOf = (src: { queryDataset: any }) => src.queryDataset.mock.calls[0][1];

/** Every series the chart was handed that reads a comparison column. */
const overlaySeriesOf = (schema: any) =>
  (schema?.series ?? []).filter((s: any) => String(s?.dataKey).endsWith('__compare'));

describe.each([
  ['pie', 'pie'],
  ['donut', 'donut'],
  ['funnel', 'funnel'],
  ['pyramid', 'funnel'],
  ['scatter', 'scatter'],
  ['bubble', 'scatter'],
])('DatasetWidget — widget type %s (chart family %s) runs no comparison query (objectui#7495)', (type, family) => {
  it('forwards no compareTo and lowers no window', async () => {
    const src = makeSource();
    renderWidget(widgetOf(type, { compareTo: { kind: 'previousYear' } }), src);

    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect(lastChartSchema.chartType).toBe(family);
    expect(src.queryDataset).toHaveBeenCalledTimes(1);

    const selection = selectionOf(src);
    expect(selection).not.toHaveProperty('compareTo');
    expect(selection).not.toHaveProperty('timeDimensions');
    // The window stays in the runtime filter, where a widget without
    // `compareTo` keeps it — it was never moved out for a comparison pass.
    expect(selection.runtimeFilter).toEqual({ ...Q2, owner: 'u1' });
  });

  it('sends the SAME selection as the widget with no compareTo at all', async () => {
    const withCompare = makeSource();
    renderWidget(widgetOf(type, { compareTo: { kind: 'previousYear' } }), withCompare);
    await waitFor(() => expect(withCompare.queryDataset).toHaveBeenCalled());
    cleanup();

    const without = makeSource();
    renderWidget(widgetOf(type), without);
    await waitFor(() => expect(without.queryDataset).toHaveBeenCalled());

    expect(selectionOf(withCompare)).toEqual(selectionOf(without));
  });

  it('charts the primary measure and appends no comparison series', async () => {
    const src = makeSource();
    renderWidget(widgetOf(type, { compareTo: { kind: 'previousYear' } }), src);

    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect(lastChartSchema.series).toHaveLength(1);
    expect(lastChartSchema.series[0]).toMatchObject({ dataKey: 'revenue' });
    expect(lastChartSchema.data[0]).toMatchObject({ stage: 'won', revenue: 120 });
    expect(overlaySeriesOf(lastChartSchema)).toEqual([]);
  });
});

describe.each(['bar', 'line'])('DatasetWidget — CONTROL: a %s widget keeps its comparison (objectui#7495)', (type) => {
  it('forwards compareTo, lowers the window, and appends the overlay', async () => {
    const src = makeSource();
    renderWidget(widgetOf(type, { compareTo: { kind: 'previousYear' } }), src);

    await waitFor(() => expect(overlaySeriesOf(lastChartSchema)).toHaveLength(1));
    const selection = selectionOf(src);
    expect(selection.compareTo).toEqual({ kind: 'previousYear' });
    expect(selection.timeDimensions).toEqual([
      { dimension: 'close_date', dateRange: ['2026-04-01', '2026-06-30'] },
    ]);
    expect(selection.runtimeFilter).toEqual({ owner: 'u1' });
    expect(overlaySeriesOf(lastChartSchema)[0]).toMatchObject({
      dataKey: 'revenue__compare',
      variant: 'comparison',
    });
  });
});

describe('DatasetWidget — CONTROL: the gate is the CHART branch, not the widget type (objectui#7495)', () => {
  it('a pie widget with no dimensions renders as a metric tile and keeps its comparison', async () => {
    const src = makeSource();
    renderWidget(
      { type: 'pie', dataset: 'sales', values: ['revenue'], filter: { ...Q2 }, compareTo: { kind: 'previousYear' } },
      src,
    );

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    const selection = selectionOf(src);
    expect(selection.compareTo).toEqual({ kind: 'previousYear' });
    expect(selection.timeDimensions).toEqual([
      { dimension: 'close_date', dateRange: ['2026-04-01', '2026-06-30'] },
    ]);
    // A metric tile never reaches the chart branch.
    expect(lastChartSchema).toBeNull();
  });
});

describe('DatasetWidget — no dated window: an ignoring family draws its chart instead of the refusal (objectui#7495)', () => {
  /**
   * The dataset executor refuses a `compareTo` it has no dated window to shift
   * (a dataset-invalid error). A widget that forwarded `compareTo` showed that
   * refusal in place of its chart; one that forwards nothing is never refused.
   */
  const refusingSource = () => ({
    queryDataset: vi.fn(async (_dataset: string, selection: any) => {
      if (selection?.compareTo && !selection?.timeDimensions?.length) {
        throw new Error('[dataset-executor] compareTo needs a dated window to shift');
      }
      return {
        rows: [{ stage: 'won', revenue: 120 }],
        fields: [{ name: 'revenue', type: 'number', label: 'Revenue' }],
      };
    }),
  });

  it('a pie with compareTo and an undated filter renders the pie', async () => {
    const src = refusingSource();
    const { queryByRole } = renderWidget(
      { type: 'pie', dataset: 'sales', dimensions: ['stage'], values: ['revenue'], filter: { owner: 'u1' }, compareTo: { kind: 'previousYear' } },
      src,
    );

    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect(lastChartSchema.chartType).toBe('pie');
    expect(queryByRole('alert')).toBeNull();
  });

  it('CONTROL: a bar with the same compareTo and filter still asks, and shows the refusal', async () => {
    const src = refusingSource();
    const { findByRole } = renderWidget(
      { type: 'bar', dataset: 'sales', dimensions: ['stage'], values: ['revenue'], filter: { owner: 'u1' }, compareTo: { kind: 'previousYear' } },
      src,
    );

    expect((await findByRole('alert')).textContent).toContain('compareTo needs a dated window');
    expect(lastChartSchema).toBeNull();
  });
});
