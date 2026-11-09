// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30140 — an inline KPI tile whose window is one of the forward
 * dashboard presets (`next_month`, `next_quarter`, `next_30_days`) and which
 * asks for `compareTo: { kind: 'previousPeriod' }` shows the change against the
 * window just before it, under a label that names that window.
 *
 * Before the fix the comparison aggregate ran over the current window again
 * (`next_*` tokens were never substituted), so the tile painted a 0% change
 * labelled "vs last month" / "vs last quarter"; the rolling window moved only
 * its start and was labelled "vs yesterday".
 *
 * The data source answers 120 for the current window, 100 for the expected
 * previous window, and 7 for any other window, so the tile can only show +20%
 * by querying exactly the expected previous window.
 *
 * Mounted through the registered `object-metric` block, the path an author
 * reaches. The filter is each preset's own window, read from the spec table
 * the dashboard filter bar lowers presets through.
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
const quarterStart = (offset: number) =>
  new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + offset * 3, 1);

/** Each forward preset: its own first day, and the first and last day of the window before it. */
const CASES = [
  {
    preset: 'next_month' as const,
    currentFrom: iso(new Date(today.getFullYear(), today.getMonth() + 1, 1)),
    previous: [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(new Date(today.getFullYear(), today.getMonth() + 1, 0))],
    label: /vs this month/i,
    staleLabel: /vs last month/i,
  },
  {
    preset: 'next_quarter' as const,
    currentFrom: iso(quarterStart(1)),
    previous: [iso(quarterStart(0)), iso(new Date(quarterStart(1).getFullYear(), quarterStart(1).getMonth(), 0))],
    label: /vs this quarter/i,
    staleLabel: /vs last quarter/i,
  },
  {
    // Today and the 30 days after it, 31 days, against the 31 days that end yesterday.
    preset: 'next_30_days' as const,
    currentFrom: iso(today),
    previous: [iso(addDays(-31)), iso(addDays(-1))],
    label: /vs previous period/i,
    staleLabel: /vs yesterday/i,
  },
];

describe('object-metric compareTo on a forward preset window (#30140)', () => {
  it.each(CASES)('$preset compares with the window just before it', async ({ preset, currentFrom, previous, label, staleLabel }) => {
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
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByText(staleLabel)).not.toBeInTheDocument();
  });
});
