// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7402 — the DASHBOARD half of "a scatter ignores `compareTo`".
 *
 * `CHART_TYPE_MAP` maps BOTH widget types `scatter` and `bubble` onto
 * `chartType: 'scatter'`, and this path had no chart-family exclusion at all:
 * a compare-to scatter widget got a `revenue__compare` series appended, which
 * the renderer then drew through the primary's single y axis — "previous
 * period" painted exactly on top of "current".
 *
 * Both widget-type spellings are pinned, because an exclusion written against
 * the widget type instead of the chart type would cover one and miss the other.
 *
 * The assertions are POSITIVE about the primary (it is still there, with its
 * numbers) and positive about the absence of the overlay (no series keyed
 * `<measure>__compare`) — "nothing refused" would also be true of a widget
 * that rendered nothing.
 *
 * The `bar` control at the bottom is mandatory: without it, a regression that
 * suppressed every comparison series would pass every assertion above.
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

/** The executor answers with the `__compare` columns already attached. */
const makeSource = () => ({
  queryDataset: vi.fn(async () => ({
    rows: [
      { stage: 'won', revenue: 120, revenue__compare: 100 },
      { stage: 'lost', revenue: 20, revenue__compare: 40 },
    ],
    fields: [{ name: 'revenue', type: 'number', label: 'Revenue' }],
  })),
});

const renderWidget = (type: string, dataSource: unknown) =>
  render(
    <DatasetWidget
      widget={{
        type, dataset: 'sales', dimensions: ['stage'], values: ['revenue'],
        filter: { ...Q2 }, compareTo: { kind: 'previousYear' },
      }}
      dataSource={dataSource}
    />,
  );

/** Every series the chart was handed that reads a comparison column. */
const overlaySeriesOf = (schema: any) =>
  (schema?.series ?? []).filter((s: any) => String(s?.dataKey).endsWith('__compare'));

describe.each(['scatter', 'bubble'])('DatasetWidget — widget type %s ignores compareTo (#7402)', (type) => {
  it('charts the primary measure and appends NO comparison series', async () => {
    const src = makeSource();
    renderWidget(type, src);

    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    // Both spellings reach the renderer as the SAME chart family — which is
    // why one chart-type exclusion covers both.
    expect(lastChartSchema.chartType).toBe('scatter');

    // Primary: drawn, with its own numbers, untouched by the overlay's absence.
    expect(lastChartSchema.series).toHaveLength(1);
    expect(lastChartSchema.series[0]).toMatchObject({ dataKey: 'revenue' });
    expect(lastChartSchema.series[0].variant).toBeUndefined();
    expect(lastChartSchema.data[0]).toMatchObject({ stage: 'won', revenue: 120 });

    // Overlay: positively absent, even though the executor DID return the
    // `revenue__compare` column — the widget declines to draw it.
    expect(overlaySeriesOf(lastChartSchema)).toEqual([]);
  });
});

describe('DatasetWidget — the compareTo overlay control (#7402)', () => {
  it('CONTROL: a bar widget with the same compareTo still gets its overlay', async () => {
    const src = makeSource();
    renderWidget('bar', src);

    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect(lastChartSchema.chartType).toBe('bar');
    expect(lastChartSchema.series).toHaveLength(2);
    expect(lastChartSchema.series[0]).toMatchObject({ dataKey: 'revenue', variant: 'current' });
    expect(overlaySeriesOf(lastChartSchema)).toHaveLength(1);
    expect(overlaySeriesOf(lastChartSchema)[0]).toMatchObject({
      dataKey: 'revenue__compare',
      variant: 'comparison',
    });
  });
});
