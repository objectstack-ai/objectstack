// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30197 — an inline KPI tile whose window is already past
 * (`yesterday`, `last_month`, `last_7_days`) and which asks for
 * `compareTo: { kind: 'previousPeriod' }` shows the change against the window
 * just before it, labelled "vs previous period".
 *
 * Before the fix `yesterday` and `last_month` kept their tokens, so the
 * comparison aggregate ran over the current window again and the tile painted
 * a 0% change ("vs last month" for 上月); `last_7_days` (8 days through today)
 * moved only its end and was labelled "vs yesterday".
 *
 * Same harness as `ObjectMetricWidget.compareTo.forwardPresets-30140.test.tsx`:
 * the data source answers 120 for the current window, 100 for the expected
 * previous window and 7 for any other, so +20% is reachable only by querying
 * exactly the expected previous window.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { DATE_RANGE_PRESET_MACRO_WINDOWS } from '@objectstack/spec/data';
// Registers `object-metric` at MODULE scope, never inside a hook
// (object-ui/no-dynamic-import-in-test-hook).
import '../index';

afterEach(cleanup);

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = new Date();
const addDays = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);

/** Each past preset: its own first day, and the first and last day of the window before it. */
const CASES = [
  {
    preset: 'last_month' as const,
    currentFrom: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
    previous: [iso(new Date(today.getFullYear(), today.getMonth() - 2, 1)), iso(new Date(today.getFullYear(), today.getMonth() - 1, 0))],
    staleLabel: /vs last month/i,
  },
  {
    // A single day against the day before it, written as one equality bound.
    preset: 'yesterday' as const,
    currentFrom: iso(addDays(-1)),
    previous: [iso(addDays(-2)), iso(addDays(-2))],
    staleLabel: /vs yesterday/i,
  },
  {
    // Seven days ago through today, 8 days, against the 8 days before them.
    preset: 'last_7_days' as const,
    currentFrom: iso(addDays(-7)),
    previous: [iso(addDays(-15)), iso(addDays(-8))],
    staleLabel: /vs yesterday/i,
  },
];

describe('object-metric compareTo on an already-past preset window (#30197)', () => {
  it.each(CASES)('$preset compares with the window just before it', async ({ preset, currentFrom, previous, staleLabel }) => {
    const [start, end] = DATE_RANGE_PRESET_MACRO_WINDOWS[preset];
    const aggregate = vi.fn(async (_object: string, q: any) => {
      const window = q?.filter?.close_date ?? {};
      if (window.$gte === currentFrom) return [{ amount_sum: 120 }];
      if (window.$gte === previous[0] && window.$lte === previous[1]) return [{ amount_sum: 100 }];
      return [{ amount_sum: 7 }];
    });
    render(
      <SchemaRendererProvider dataSource={{ aggregate } as never}>
        <SchemaRenderer
          schema={{
            type: 'object-metric',
            objectName: 'deal',
            label: 'Revenue',
            aggregate: { field: 'amount', function: 'sum' },
            filter: { close_date: { $gte: start, $lte: end } },
            compareTo: { kind: 'previousPeriod' },
          } as never}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(aggregate).toHaveBeenCalledTimes(2));
    const windows = aggregate.mock.calls.map((c: any[]) => c[1].filter.close_date);
    expect(windows).toContainEqual({ $gte: previous[0], $lte: previous[1] });

    // 120 against 100: a non-zero change, under the window's own label.
    expect(await screen.findByText('20%')).toBeInTheDocument();
    expect(await screen.findByText(/vs previous period/i)).toBeInTheDocument();
    expect(screen.queryByText(staleLabel)).not.toBeInTheDocument();
  });
});
