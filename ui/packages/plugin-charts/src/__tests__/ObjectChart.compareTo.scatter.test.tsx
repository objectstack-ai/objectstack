// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7402 — a `scatter` IGNORES `compareTo`, exactly as pie / donut /
 * funnel do.
 *
 * The overlay used to be synthesised for a scatter too, and the renderer reads
 * y through the single `YAxis dataKey={series[0].dataKey}`: "previous period"
 * was therefore painted on the PRIMARY's y, exactly on top of "current". The
 * ruling on #7402 removes the published capability rather than keep drawing
 * that picture; it returns with the multi-measure projection declined as
 * option A of #7194.
 *
 * What is pinned here is the POSITIVE half of "ignored": the primary series
 * (and its data) still reach ChartRenderer, and NO series whose `dataKey` ends
 * `__comparison` is synthesised. Asserting only "no refusal" would pass for a
 * chart that drew nothing at all.
 *
 * The `bar` control at the bottom is what makes those absences mean anything:
 * a change that disabled `compareTo` everywhere would satisfy every scatter
 * assertion above it and fail the control.
 *
 * Asserted at the schema handed to ChartRenderer — the seam the overlay is
 * expressed in — as in `ObjectChart.compareTo.test.tsx`, because Recharts
 * draws nothing at jsdom's zero-size container.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

let lastSchema: any = null;

vi.mock('../ChartRenderer', () => ({
  ChartRenderer: (props: any) => {
    lastSchema = props.schema;
    return null;
  },
}));

import { ObjectChart, COMPARISON_SUFFIX } from '../ObjectChart';
import type { ObjectChartSchema } from '@object-ui/types';

/** ObjectChart probes `/api/v1/meta/object/deal` for option colors; answer it. */
function installMetaFetchDouble() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      calls.push(url);
      return { ok: true, json: async () => ({}) };
    }),
  );
  return calls;
}

let metaCalls: string[] = [];

beforeEach(() => {
  metaCalls = installMetaFetchDouble();
});

afterEach(() => {
  expect(metaCalls.filter((u) => u !== '/api/v1/meta/object/deal')).toEqual([]);
  vi.unstubAllGlobals();
  cleanup();
  lastSchema = null;
});

const quarterStart = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CURRENT_FROM = iso(quarterStart(new Date()));

/** 120 for the current window, 100 for any other window asked for. */
const makeSource = () => ({
  aggregate: vi.fn(async (_object: string, q: any) => [
    { stage: 'won', amount: String(q?.filter?.close_date?.$gte) === CURRENT_FROM ? 120 : 100 },
  ]),
});

// `chartType` takes the anchored union rather than a bare `string`
// (objectui#7946): `ObjectChartProps.schema` is `ObjectChartSchema`, whose
// `chartType` is the declared family list, and `type` is required there.
const renderChart = (chartType: ObjectChartSchema['chartType'], dataSource: unknown, series?: ObjectChartSchema['series']) =>
  render(
    <ObjectChart
      schema={{
        type: 'object-chart',
        objectName: 'deal',
        chartType,
        aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' },
        filter: { close_date: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' } },
        xAxisKey: 'stage',
        compareTo: { kind: 'previousYear' },
        ...(series ? { series } : {}),
      }}
      dataSource={dataSource}
    />,
  );

/** Every series the chart was handed whose key is a synthesised overlay. */
const overlaySeriesOf = (schema: any) =>
  (schema?.series ?? []).filter((s: any) => String(s?.dataKey).endsWith(COMPARISON_SUFFIX));

describe('ObjectChart — a scatter ignores compareTo (#7402)', () => {
  it('draws the authored primary series and synthesises NO comparison overlay', async () => {
    const src = makeSource();
    renderChart('scatter', src, [{ dataKey: 'amount' }]);

    await waitFor(() => expect(lastSchema).not.toBeNull());
    // The comparison window is never even fetched — the same short-circuit
    // pie / donut / funnel take.
    expect(src.aggregate).toHaveBeenCalledTimes(1);

    // Primary: present, intact, carrying its data.
    expect(lastSchema.chartType).toBe('scatter');
    expect(lastSchema.series).toHaveLength(1);
    expect(lastSchema.series[0]).toMatchObject({ dataKey: 'amount' });
    expect(lastSchema.data[0]).toMatchObject({ stage: 'won', amount: 120 });

    // Overlay: positively absent — no series, and no column for one to read.
    expect(overlaySeriesOf(lastSchema)).toEqual([]);
    expect(lastSchema.data[0]).not.toHaveProperty(`amount${COMPARISON_SUFFIX}`);
  });

  it('adds no overlay when the author wrote no `series` at all', async () => {
    // The authored spec for a compare-to scatter has ONE measure and no
    // `series` key; the overlay was the only thing that ever put a second
    // entry there. So the pin is that `series` stays UNsynthesised.
    const src = makeSource();
    renderChart('scatter', src);

    await waitFor(() => expect(lastSchema).not.toBeNull());
    expect(src.aggregate).toHaveBeenCalledTimes(1);
    expect(overlaySeriesOf(lastSchema)).toEqual([]);
    expect(lastSchema.data[0]).toMatchObject({ stage: 'won', amount: 120 });
    expect(lastSchema.data[0]).not.toHaveProperty(`amount${COMPARISON_SUFFIX}`);
  });

  it('CONTROL: a bar with the same compareTo still synthesises the overlay', async () => {
    // Without this, a regression that switched `compareTo` off for every chart
    // type would pass both assertions above.
    const src = makeSource();
    renderChart('bar', src);

    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(lastSchema?.series?.length).toBe(2));
    expect(lastSchema.series[0]).toMatchObject({ dataKey: 'amount', variant: 'current' });
    expect(overlaySeriesOf(lastSchema)).toHaveLength(1);
    expect(overlaySeriesOf(lastSchema)[0]).toMatchObject({
      dataKey: `amount${COMPARISON_SUFFIX}`,
      variant: 'comparison',
    });
    expect(lastSchema.data[0]).toMatchObject({ amount: 120, [`amount${COMPARISON_SUFFIX}`]: 100 });
  });
});
