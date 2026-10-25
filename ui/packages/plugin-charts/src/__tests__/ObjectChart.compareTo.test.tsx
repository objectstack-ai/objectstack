// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#3337 — the LEGACY inline object-provider chart path under the
 * converged `compareTo` shape (`{ kind, dimension? }`, objectstack#5011).
 *
 * This path is where the retired three-branch union actually ran, so it is the
 * one that has to keep working verbatim: the comparison window is fetched by
 * shifting the widget's own filter, the previous-window values arrive under
 * `<valueKey>__comparison`, and the overlay series is labelled from the same
 * trend vocabulary the metric card uses.
 *
 * The window is a QUARTER so the two kinds disagree about both the window and
 * the label — a year-scoped filter would let a `previousYear` that fell through
 * to the previousPeriod branch pass anyway.
 *
 * Asserted at the schema handed to ChartRenderer — the seam the overlay is
 * actually expressed in — rather than through Recharts' DOM, which draws
 * nothing at jsdom's zero-size container.
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

import { ObjectChart } from '../ObjectChart';
import type { DashboardWidget as SpecDashboardWidget } from '@objectstack/spec/ui';

/**
 * objectui#4106 — answer ObjectChart's option-color probe from a double.
 *
 * `objectName: 'deal'` makes ObjectChart resolve the category dimension's
 * option colors via `GET /api/v1/meta/object/deal` on the GLOBAL `fetch`
 * (ObjectChart.tsx:352) — under happy-dom a REAL request, 4 per run here (one
 * per test). The effect swallows the rejection by design, so the suite stayed
 * green while stderr filled with `connect ECONNREFUSED 127.0.0.1:3000`.
 *
 * `{}` reproduces that failure's observable outcome exactly: no options →
 * `buildOptionColorMap` returns null, the state the catch branch already set.
 * The compareTo assertions below are untouched by it.
 */
function installMetaFetchDouble(routes: Record<string, unknown> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      calls.push(url);
      return { ok: true, json: async () => routes[url] ?? {} };
    }),
  );
  return calls;
}

let metaCalls: string[] = [];

beforeEach(() => {
  metaCalls = installMetaFetchDouble();
});

afterEach(() => {
  // Anything other than the option-color probe is a NEW escape — fail here.
  expect(metaCalls.filter((u) => u !== '/api/v1/meta/object/deal')).toEqual([]);
  vi.unstubAllGlobals();
  cleanup();
  lastSchema = null;
});

const quarterStart = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CURRENT_FROM = iso(quarterStart(new Date()));
/** Same quarter, one year earlier — string surgery, independent of the shifter. */
const PREVIOUS_YEAR_FROM = `${Number(CURRENT_FROM.slice(0, 4)) - 1}${CURRENT_FROM.slice(4)}`;

/** 120 for the current window, 100 for whatever window the comparison asks for. */
const makeSource = () => ({
  aggregate: vi.fn(async (_object: string, q: any) => [
    { stage: 'won', amount: String(q?.filter?.close_date?.$gte) === CURRENT_FROM ? 120 : 100 },
  ]),
});

const comparisonFromOf = (src: { aggregate: any }) =>
  src.aggregate.mock.calls
    .map((c: any[]) => String(c[1].filter.close_date.$gte))
    .find((from: string) => from !== CURRENT_FROM);

/**
 * ⚠️ `compareTo` is typed at the PRODUCER's own declaration rather than
 * `unknown`, and the reason is a measurement rather than tidiness.
 *
 * `DashboardRenderer` composes this node with `compareTo: widget.compareTo`,
 * forwarding the dashboard widget's key verbatim — so
 * `DashboardWidget['compareTo']` is literally where every value that reaches
 * this prop comes from. All four call sites below already pass exactly that
 * shape (`{ kind }`, `{ kind, dimension }`, or nothing), so nothing this file
 * expresses is lost.
 *
 * What it buys: objectui#8885 (PR objectui#8895) declares `compareTo` on
 * `ObjectChartSchema` bound to that same symbol. With `unknown` here, the
 * literal below stops compiling the moment the two PRs are UNIONISED — a defect
 * neither branch could see alone, because on this branch the key still rode
 * `BaseSchema`'s index signature. Measured on the merge of the two heads: the
 * union's `tsc -p tsconfig.test.json` reported this line, and it was masked in
 * the obvious reading because `type-check` is `tsc --noEmit && tsc -p
 * tsconfig.test.json` — the `&&` short-circuits, so the first error hides every
 * error the TEST project would have reported.
 */
const renderChart = (compareTo: SpecDashboardWidget['compareTo'], dataSource: unknown) =>
  render(
    <ObjectChart
      schema={{
        type: 'object-chart',
        objectName: 'deal',
        chartType: 'bar',
        aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' },
        filter: { close_date: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' } },
        xAxisKey: 'stage',
        ...(compareTo ? { compareTo } : {}),
      }}
      dataSource={dataSource}
    />,
  );

describe('ObjectChart — inline compareTo overlay under { kind }', () => {
  it('previousYear fetches the same quarter one year back and overlays it', async () => {
    const src = makeSource();
    renderChart({ kind: 'previousYear' }, src);

    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    expect(comparisonFromOf(src)).toBe(PREVIOUS_YEAR_FROM);

    await waitFor(() => expect(lastSchema?.series?.length).toBe(2));
    expect(lastSchema.data[0]).toMatchObject({ amount: 120, amount__comparison: 100 });
    expect(lastSchema.series[0]).toMatchObject({ dataKey: 'amount', variant: 'current' });
    expect(lastSchema.series[1]).toMatchObject({ dataKey: 'amount__comparison', variant: 'comparison' });
    // Label derived from `.kind`, not from the filter's quarter tokens.
    expect(lastSchema.series[1].label).toBe('Previous year');
  });

  it('previousPeriod substitutes current_* tokens and labels by the filter’s window', async () => {
    const src = makeSource();
    renderChart({ kind: 'previousPeriod' }, src);

    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    // The PREVIOUS QUARTER — not the same quarter a year earlier.
    expect(comparisonFromOf(src)).not.toBe(PREVIOUS_YEAR_FROM);
    expect(String(comparisonFromOf(src)) < CURRENT_FROM).toBe(true);

    await waitFor(() => expect(lastSchema?.series?.length).toBe(2));
    expect(lastSchema.series[1].label).toBe('Previous quarter');
  });

  it('a dimension changes nothing here — it names a DATASET time dimension', async () => {
    // `dimension` is the executor's input on the dataset path. The inline path
    // shifts the widget's own filter, so carrying one must not alter the query.
    const src = makeSource();
    renderChart({ kind: 'previousYear', dimension: 'close_date' }, src);
    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    expect(comparisonFromOf(src)).toBe(PREVIOUS_YEAR_FROM);
    await waitFor(() => expect(lastSchema?.series?.length).toBe(2));
    expect(lastSchema.series[1]).toMatchObject({ dataKey: 'amount__comparison', variant: 'comparison' });
  });

  it('runs a single pass and adds no overlay without compareTo', async () => {
    const src = makeSource();
    renderChart(undefined, src);
    await waitFor(() => expect(lastSchema).not.toBeNull());
    expect(src.aggregate).toHaveBeenCalledTimes(1);
    expect(lastSchema.data[0]).not.toHaveProperty('amount__comparison');
  });
});
