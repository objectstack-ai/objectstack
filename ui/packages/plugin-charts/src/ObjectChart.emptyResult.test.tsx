/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7130 — `ObjectChart` over an empty result renders a self-describing
 * empty state instead of a bare frame.
 *
 * ## What the bare frame was, measured
 *
 * Before this branch the component fell through to `ChartRenderer` with
 * `data: []`. Rendered in a real browser at 220c18d05, recharts emitted an SVG
 * with TWO hairline axis rules and ZERO `<text>` nodes for bar/line, and
 * nothing at all for pie — ticks are derived from the data, so an empty domain
 * labels nothing. The filing hypothesis ("a chart frame with axes is arguably
 * self-describing") is false: there are no labels on an empty chart.
 *
 * ## Why the assertions are shaped this way
 *
 * The maintainer's bar (hotcrm#1212) is *distinguishable from a load failure at
 * a glance*, so the pin is not "an empty state exists" — it is that the empty
 * state and the failure state are DIFFERENT, checked on the ARIA roles that
 * carry that difference (`status` vs `alert`), plus the three directions this
 * branch could be wrong in: firing over real rows, firing before the fetch
 * resolves, and swallowing an error. Each is a separate `it` so an ablation
 * reports which arm moved.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import { ObjectChart } from './ObjectChart';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const schema = {
  type: 'object-chart' as const,
  chartType: 'bar' as const,
  objectName: 'crm_opportunity',
  xAxisKey: 'stage',
  series: [{ dataKey: 'amount', label: 'Amount' }],
  isAnimationActive: false,
};

const renderWith = (dataSource: any, overrides: Record<string, unknown> = {}) =>
  render(<ObjectChart schema={{ ...schema, ...overrides }} dataSource={dataSource} />);

describe('ObjectChart — empty result (objectui#7130)', () => {
  it('renders a self-describing empty state when the query returns no rows', async () => {
    renderWith({ find: vi.fn().mockResolvedValue([]) });

    const box = await screen.findByTestId('chart-empty-state');
    // The copy states that the load SUCCEEDED — the fact a blank tile cannot
    // give the reader — and promises no recovery (no "loading", no "retry").
    expect(box).toHaveTextContent('No data yet');
    expect(box).toHaveTextContent('loaded successfully');
    expect(box.textContent).not.toMatch(/try again|retry|loading/i);
    // Names WHAT is empty, so the tile is self-describing without authored copy.
    expect(screen.getByTestId('chart-empty-source')).toHaveTextContent('crm_opportunity');
  });

  it('marks the empty state `status`, distinct from the failure box `alert`', async () => {
    // The whole point of the card: the reader must be able to tell an empty
    // result from a load failure. Asserted on the two roles rather than on
    // copy, because that is the machine-readable half of the distinction.
    const { unmount } = renderWith({ find: vi.fn().mockResolvedValue([]) });
    expect(await screen.findByTestId('chart-empty-state')).toHaveAttribute('role', 'status');
    unmount();

    renderWith({ find: vi.fn().mockRejectedValue(new Error('Network request failed')) });
    const failure = await screen.findByTestId('chart-error');
    expect(failure).toHaveAttribute('role', 'alert');
    // …and the empty branch must not have swallowed the error.
    expect(screen.queryByTestId('chart-empty-state')).toBeNull();
  });

  it('does NOT fire over a populated result', async () => {
    renderWith({
      find: vi.fn().mockResolvedValue([
        { stage: 'Qualify', amount: 12 },
        { stage: 'Won', amount: 9 },
      ]),
    });
    // Wait for the fetch to settle before asserting the absence, so this cannot
    // pass merely by running before the data arrives.
    await waitFor(() => expect(screen.queryByTestId('chart-loading')).toBeNull());
    expect(screen.queryByTestId('chart-empty-state')).toBeNull();
  });

  it('does NOT flash before the fetch resolves — loading still wins', async () => {
    renderWith({ find: vi.fn(() => new Promise(() => {})) });
    expect(await screen.findByTestId('chart-loading')).toBeTruthy();
    expect(screen.queryByTestId('chart-empty-state')).toBeNull();
  });

  it('leaves an inline-data chart alone — it ran no query to report on', async () => {
    // `data: []` is an authoring choice, not an empty query result, so the copy
    // ("its query returned no records") would be false of it.
    renderWith({ find: vi.fn().mockResolvedValue([]) }, { data: [] });
    await waitFor(() => expect(screen.queryByTestId('chart-loading')).toBeNull());
    expect(screen.queryByTestId('chart-empty-state')).toBeNull();
  });
});
