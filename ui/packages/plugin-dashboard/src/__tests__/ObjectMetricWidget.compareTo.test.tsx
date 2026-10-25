// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#3337 — the inline KPI half of the legacy `compareTo` path under the
 * converged `{ kind, dimension? }` shape (objectstack#5011).
 *
 * The widget issues a second aggregate over the shifted window and derives the
 * trend from the two values; the i18n label comes from `compareTo.kind` (plus,
 * for `previousPeriod`, the filter's own macro vocabulary).
 *
 * The window is deliberately a QUARTER: the two kinds then disagree about both
 * the window (`previousYear` = same quarter −1y, `previousPeriod` = the quarter
 * before) and the label (`vs last year` / `vs last quarter`), so each case can
 * only pass by reading `.kind`. A year-scoped filter would have let a
 * `previousYear` that fell through to the previousPeriod branch pass anyway.
 *
 * ## Promoted to the member pin for `object-metric.compareTo` (objectui#8071)
 *
 * objectui#8071's eighth slice registers this file as the pin for that key: the
 * cases below already assert the member SET the renderer reads — `kind` selects
 * both the comparison window and the label, `dimension` is carried but inert on
 * this inline path, and an absent `compareTo` leaves the tile at one pass with
 * no trend — which is what a member-shape claim has to say.
 *
 * The four cases above drive `ObjectMetricWidget` directly. The registered
 * block `object-metric` is the same reader: its `ElementDataSourceGate` shell
 * re-binds only `objectName` and `filter` and forwards every other authored key
 * untouched, so `compareTo` arrives at this component exactly as authored. That
 * is asserted rather than assumed by the last case in this file, which mounts
 * `type: 'object-metric'` through `SchemaRenderer`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ObjectMetricWidget } from '../ObjectMetricWidget';
// Registers `object-metric` at MODULE scope, never inside a hook
// (object-ui/no-dynamic-import-in-test-hook).
import '../index';

afterEach(cleanup);

/** The current window's own bounds, resolved the same way the widget resolves them. */
const quarterStart = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CURRENT_FROM = iso(quarterStart(new Date()));
/** Same quarter, one year earlier — string surgery, independent of the shifter. */
const PREVIOUS_YEAR_FROM = `${Number(CURRENT_FROM.slice(0, 4)) - 1}${CURRENT_FROM.slice(4)}`;

const makeSource = () => ({
  aggregate: vi.fn(async (_object: string, q: any) => [
    { amount_sum: String(q?.filter?.close_date?.$gte) === CURRENT_FROM ? 120 : 100 },
  ]),
});

const comparisonFilterOf = (src: { aggregate: any }) => {
  const call = src.aggregate.mock.calls.find(
    (c: any[]) => String(c[1].filter.close_date.$gte) !== CURRENT_FROM,
  );
  return call?.[1].filter.close_date;
};

const renderWidget = (compareTo: unknown, dataSource: unknown) =>
  render(
    <ObjectMetricWidget
      objectName="deal"
      label="Revenue"
      aggregate={{ field: 'amount', function: 'sum' }}
      filter={{ close_date: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' } }}
      compareTo={compareTo as any}
      dataSource={dataSource as any}
    />,
  );

describe('ObjectMetricWidget — compareTo under { kind }', () => {
  it('previousYear shifts the SAME quarter back one year and labels "vs last year"', async () => {
    const src = makeSource();
    renderWidget({ kind: 'previousYear' }, src);

    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    expect(comparisonFilterOf(src).$gte).toBe(PREVIOUS_YEAR_FROM);

    // 120 vs 100 → +20%, labelled off `.kind` and NOT off the filter's quarter
    // tokens (which is what the previousPeriod arm reads).
    expect(await screen.findByText('20%')).toBeInTheDocument();
    expect(await screen.findByText(/vs last year/i)).toBeInTheDocument();
    expect(screen.queryByText(/vs last quarter/i)).not.toBeInTheDocument();
  });

  it('previousPeriod substitutes current_* → last_* and labels "vs last quarter"', async () => {
    const src = makeSource();
    renderWidget({ kind: 'previousPeriod' }, src);

    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    const cmp = comparisonFilterOf(src);
    // The PREVIOUS QUARTER, which is not the same quarter a year earlier.
    expect(cmp.$gte).not.toBe(PREVIOUS_YEAR_FROM);
    expect(cmp.$lte < CURRENT_FROM).toBe(true);

    expect(await screen.findByText('20%')).toBeInTheDocument();
    expect(await screen.findByText(/vs last quarter/i)).toBeInTheDocument();
  });

  it('carries a dimension without letting it touch the query', async () => {
    // `dimension` addresses a DATASET time dimension, resolved by the executor.
    // This inline path shifts the widget's own filter, so it must be inert here.
    const src = makeSource();
    renderWidget({ kind: 'previousYear', dimension: 'close_date' }, src);
    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    for (const call of src.aggregate.mock.calls) {
      expect(Object.keys(call[1].filter)).toEqual(['close_date']);
    }
    expect(comparisonFilterOf(src).$gte).toBe(PREVIOUS_YEAR_FROM);
  });

  it('runs a single pass and shows no trend without compareTo', async () => {
    const src = makeSource();
    renderWidget(undefined, src);
    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/vs last/i)).not.toBeInTheDocument();
  });

  it('arrives unchanged through the registered `object-metric` block', async () => {
    // What makes the four cases above a pin on the BLOCK's key rather than on
    // one component's prop: authored on the schema, `compareTo` passes the
    // `ElementDataSourceGate` shell untouched and shifts the window exactly as
    // it does when handed straight to the widget.
    const src = makeSource();
    render(
      <SchemaRendererProvider dataSource={src as never}>
        <SchemaRenderer
          schema={{
            type: 'object-metric',
            objectName: 'deal',
            label: 'Revenue',
            aggregate: { field: 'amount', function: 'sum' },
            filter: { close_date: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' } },
            compareTo: { kind: 'previousYear' },
          } as never}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(src.aggregate).toHaveBeenCalledTimes(2));
    expect(comparisonFilterOf(src).$gte).toBe(PREVIOUS_YEAR_FROM);
    expect(await screen.findByText(/vs last year/i)).toBeInTheDocument();
  });
});
