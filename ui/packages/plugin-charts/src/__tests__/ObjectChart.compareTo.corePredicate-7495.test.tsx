// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7495 — ObjectChart decides "does this chart family ignore
 * `compareTo`" by asking `@object-ui/core`'s `chartTypeIgnoresCompareTo`, the
 * one declaration the dashboard's DatasetWidget reads too. It keeps no list of
 * its own.
 *
 * Two halves:
 *
 *  1. Behaviour unchanged for the three families no ObjectChart test pinned
 *     before (pie / donut / funnel; scatter is pinned by
 *     `ObjectChart.compareTo.scatter.test.tsx`): ONE aggregate call — the
 *     comparison window is never fetched — and no overlay series.
 *  2. The answer comes from core. The predicate is wrapped in a spy whose
 *     answer the test can FORCE. Forcing `true` on a `bar` must suppress the
 *     comparison fetch and the overlay; forcing `false` on a `pie` must run
 *     both. A local copy of the list left in ObjectChart would ignore the
 *     forced answer and fail both — which is what makes this a pin that the
 *     core predicate is the one read, at both of its call sites (the fetch and
 *     the series synthesis).
 *
 * Asserted at the schema handed to ChartRenderer, as the sibling compareTo
 * suites do, because Recharts draws nothing at jsdom's zero-size container.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const probe = vi.hoisted(() => ({
  /** `undefined` = answer truthfully; a boolean = force that answer. */
  forced: undefined as boolean | undefined,
  asked: [] as Array<string | undefined>,
}));

vi.mock('@object-ui/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/core')>();
  return {
    ...actual,
    chartTypeIgnoresCompareTo: (chartType: string | undefined) => {
      probe.asked.push(chartType);
      return probe.forced ?? actual.chartTypeIgnoresCompareTo(chartType);
    },
  };
});

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
  probe.forced = undefined;
  probe.asked = [];
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

// `chartType` is a bare string here, cast at the one call: `funnel` is not in
// `ObjectChartSchema['chartType']`'s declared union, yet it reaches ObjectChart at
// run time — DashboardRenderer's object-chart path passes its resolved widget
// type through as `chartType`, and `funnel` is one of those. The pin follows the
// run-time population, not the declared one.
const renderChart = (chartType: string, dataSource: unknown) =>
  render(
    <ObjectChart
      schema={{
        type: 'object-chart',
        objectName: 'deal',
        chartType: chartType as ObjectChartSchema['chartType'],
        aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' },
        filter: { close_date: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' } },
        xAxisKey: 'stage',
        compareTo: { kind: 'previousYear' },
      }}
      dataSource={dataSource}
    />,
  );

/** Every series the chart was handed whose key is a synthesised overlay. */
const overlaySeriesOf = (schema: any) =>
  (schema?.series ?? []).filter((s: any) => String(s?.dataKey).endsWith(COMPARISON_SUFFIX));

describe.each(['pie', 'donut', 'funnel'])('ObjectChart — %s ignores compareTo (objectui#7495)', (chartType) => {
  it('fetches only the current window and synthesises no overlay', async () => {
    const src = makeSource();
    renderChart(chartType, src);

    await waitFor(() => expect(lastSchema).not.toBeNull());
    await waitFor(() => expect(lastSchema.data?.[0]).toMatchObject({ stage: 'won', amount: 120 }));
    // The comparison window is never fetched.
    expect(src.aggregate).toHaveBeenCalledTimes(1);
    expect(lastSchema.chartType).toBe(chartType);
    expect(overlaySeriesOf(lastSchema)).toEqual([]);
    expect(lastSchema.data[0]).not.toHaveProperty(`amount${COMPARISON_SUFFIX}`);
    // …and the family was asked of core, not of a local list.
    expect(probe.asked).toContain(chartType);
  });
});

describe('ObjectChart reads the core predicate — its answer, forced, drives both call sites (objectui#7495)', () => {
  it('forced TRUE on a bar: no comparison fetch, no overlay', async () => {
    probe.forced = true;
    const src = makeSource();
    renderChart('bar', src);

    await waitFor(() => expect(lastSchema).not.toBeNull());
    await waitFor(() => expect(lastSchema.data?.[0]).toMatchObject({ stage: 'won', amount: 120 }));
    expect(src.aggregate).toHaveBeenCalledTimes(1);
    expect(overlaySeriesOf(lastSchema)).toEqual([]);
    expect(probe.asked).toContain('bar');
  });

  it('forced FALSE on a pie: the comparison is fetched and the overlay synthesised', async () => {
    probe.forced = false;
    const src = makeSource();
    renderChart('pie', src);

    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(overlaySeriesOf(lastSchema)).toHaveLength(1));
    expect(overlaySeriesOf(lastSchema)[0]).toMatchObject({
      dataKey: `amount${COMPARISON_SUFFIX}`,
      variant: 'comparison',
    });
    expect(lastSchema.data[0]).toMatchObject({ amount: 120, [`amount${COMPARISON_SUFFIX}`]: 100 });
  });

  it('CONTROL: answered truthfully, a bar keeps its comparison fetch and overlay', async () => {
    // Without this, a regression that switched `compareTo` off for every
    // chart type would pass the pie / donut / funnel pins above.
    const src = makeSource();
    renderChart('bar', src);

    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(overlaySeriesOf(lastSchema)).toHaveLength(1));
    expect(lastSchema.series[0]).toMatchObject({ dataKey: 'amount', variant: 'current' });
  });
});
