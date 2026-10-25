/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12061 — a chart that REFUSES for a missing category axis decides so
 * BEFORE it fetches, and reads nothing.
 *
 * objectui#8168's refusal (`chart-missing-category-axis`) is a render-time
 * return, but the object-bound fetch effect did not read it: an object-bound
 * node naming no category still issued `ds.find(objectName, { $filter })` —
 * with no `$top`, so bounded only by the data source's own default — and then
 * threw the rows away to draw the refusal. Since objectui#6152 round 15 every
 * chart list view that names no `dataset` composes exactly that node, on three
 * relays (ListView's `chart` case, app-shell's `renderListView`, plugin-view's
 * `generateViewSchema`), so every render of such a view paid for the read.
 *
 * The fix is objectui#7390's shape for `ObjectGallery`: decide the binding
 * first, then fetch. The refusal's predicate is ONE value in `ObjectChart`,
 * read by the render-time return and by the fetch gate alike, so the two
 * cannot disagree about which chart refuses. ⛔ Not a `$top` cap: a cap would
 * shrink the read, not remove it.
 *
 * ## What each case measures
 *
 * - The round-15 probe's node (`{ objectName: 'task', chartType: 'bar',
 *   filter: [] }`): `find` zero times, `aggregate` zero times, and the refusal
 *   still draws — on the FIRST paint, with no loading skeleton before it.
 * - A declared measure with no `groupBy` — the arm the refusal file calls the
 *   card's exact bag. It reaches `ds.aggregate` rather than `ds.find`, so the
 *   gate has to sit before both legs, not on one of them.
 * - A `compareTo` overlay: the comparison window is not queried either.
 * - A write to the object does not wake a refused chart into a fetch: the
 *   invalidation subscription keys on the same gate.
 * - Control, both legs of a bound chart: it fetches exactly as before — one
 *   query, on the leg its binding selects, with the same arguments.
 * - A chart refused at mount that is later given a category fetches then: the
 *   gate is a dependency of the fetch effect, not a mount-time snapshot.
 *
 * `ChartRenderer` is a stand-in: the refusal is drawn by `ObjectChart` itself,
 * and the control only needs to see that rows reached the renderer.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';

vi.mock('./ChartRenderer', () => ({
  ChartRenderer: ({ schema }: { schema?: { data?: unknown } }) => (
    <div
      data-testid="chart-renderer"
      data-rows={Array.isArray(schema?.data) ? schema.data.length : -1}
    />
  ),
}));

import { ObjectChart } from './ObjectChart';
import type { ObjectChartSchema } from '@object-ui/types';

const REFUSAL = 'chart-missing-category-axis';

/** Rows a populated data source answers with, so "no rows" never explains a zero. */
const ROWS = [
  { stage: 'won', amount: 10 },
  { stage: 'lost', amount: 4 },
];

/** Every read a data source could be asked for on the object-bound path. */
const makeDataSource = () => ({
  find: vi.fn(async () => ROWS),
  aggregate: vi.fn(async () => ROWS),
  getObjectSchema: vi.fn(async () => ({ name: 'task', fields: {} })),
});

let metadataFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // The option-colour metadata probe reads through the global fetch when no
  // host `apiFetch` is mounted. Counted, so "reads nothing" covers it too.
  metadataFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('fetch', metadataFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** Let every effect and every resolved promise land before counting reads. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

/**
 * The round-15 probe's node, transcribed from the card: what the three relays
 * compose for a chart list view that names no dataset.
 */
const PROBE_NODE: ObjectChartSchema = {
  type: 'object-chart',
  objectName: 'task',
  chartType: 'bar',
  filter: [],
};

/**
 * A declared measure with no category. `ChartAggregate` requires `groupBy`, so
 * this is a document the authoring door refuses — cast here, once, as the
 * objectui#8168 file casts it (`UNAUTHORABLE`), because every live producer
 * forwards `aggregate` untyped and the shape still arrives at runtime.
 */
const MEASURE_WITHOUT_CATEGORY = {
  field: 'amount',
  function: 'sum',
} as unknown as ObjectChartSchema['aggregate'];

describe('objectui#12061 — a chart that refuses for a missing category axis reads nothing', () => {
  it('the round-15 probe node: find zero times, aggregate zero times, and the refusal still draws', async () => {
    const ds = makeDataSource();
    render(<ObjectChart schema={PROBE_NODE} dataSource={ds} />);

    // The FIRST paint is the refusal — no loading skeleton flashes before it.
    expect(screen.getByTestId(REFUSAL)).toHaveAttribute('role', 'alert');
    expect(screen.queryByTestId('chart-loading')).toBeNull();

    await settle();

    expect(ds.find).toHaveBeenCalledTimes(0);
    expect(ds.aggregate).toHaveBeenCalledTimes(0);
    expect(ds.getObjectSchema).toHaveBeenCalledTimes(0);
    expect(metadataFetch).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId(REFUSAL)).toHaveAttribute('role', 'alert');
    expect(screen.queryByTestId('chart-loading')).toBeNull();
  });

  it('a declared measure with no groupBy: the aggregate leg is not issued either', async () => {
    const ds = makeDataSource();
    render(<ObjectChart schema={{ ...PROBE_NODE, aggregate: MEASURE_WITHOUT_CATEGORY }} dataSource={ds} />);

    await settle();

    expect(ds.aggregate).toHaveBeenCalledTimes(0);
    expect(ds.find).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId(REFUSAL)).toHaveAttribute('role', 'alert');
  });

  it('a compareTo overlay on a refused chart: neither window is queried', async () => {
    // The comparison window rides the same object-bound query as the current
    // one, so a refused bar chart asking for `compareTo` would read twice.
    const ds = makeDataSource();
    render(<ObjectChart schema={{ ...PROBE_NODE, compareTo: { kind: 'previousYear' } }} dataSource={ds} />);

    await settle();

    expect(ds.find).toHaveBeenCalledTimes(0);
    expect(ds.aggregate).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId(REFUSAL)).toHaveAttribute('role', 'alert');
  });

  it('a write to the object does not wake a refused chart into a fetch', async () => {
    const ds = makeDataSource();
    render(<ObjectChart schema={PROBE_NODE} dataSource={ds} />);
    await settle();

    act(() => notifyDataChanged({ objectName: 'task' }));
    await settle();

    expect(ds.find).toHaveBeenCalledTimes(0);
    expect(ds.aggregate).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId(REFUSAL)).toHaveAttribute('role', 'alert');
  });
});

describe('objectui#12061 control — a bound chart fetches exactly as before', () => {
  it('a category on xAxisKey and no aggregate: one find over the object, no aggregate', async () => {
    const ds = makeDataSource();
    render(<ObjectChart schema={{ ...PROBE_NODE, xAxisKey: 'stage' }} dataSource={ds} />);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await settle();

    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(ds.find).toHaveBeenCalledWith('task', { $filter: [] });
    expect(ds.aggregate).toHaveBeenCalledTimes(0);
    expect(screen.queryByTestId(REFUSAL)).toBeNull();
    expect(screen.getByTestId('chart-renderer')).toHaveAttribute('data-rows', String(ROWS.length));
  });

  it('a category on aggregate.groupBy: one aggregate over the object, no find', async () => {
    const ds = makeDataSource();
    render(
      <ObjectChart
        schema={{ ...PROBE_NODE, aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' } }}
        dataSource={ds}
      />,
    );

    await waitFor(() => expect(ds.aggregate).toHaveBeenCalled());
    await settle();

    expect(ds.aggregate).toHaveBeenCalledTimes(1);
    expect(ds.aggregate).toHaveBeenCalledWith('task', {
      field: 'amount',
      function: 'sum',
      groupBy: 'stage',
      filter: [],
    });
    expect(ds.find).toHaveBeenCalledTimes(0);
    expect(screen.queryByTestId(REFUSAL)).toBeNull();
    expect(screen.getByTestId('chart-renderer')).toHaveAttribute('data-rows', String(ROWS.length));
  });

  it('a chart refused at mount fetches once a spec xAxis declares its category', async () => {
    // The spec's `xAxis: { field }` moves none of the fetch effect's other
    // inputs (no `xAxisKey`, no `aggregate`), so only the gate itself can
    // re-run the effect when the category arrives — as it does when a
    // designer preview edits the node in place.
    const ds = makeDataSource();
    const { rerender } = render(<ObjectChart schema={PROBE_NODE} dataSource={ds} />);
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(0);

    rerender(<ObjectChart schema={{ ...PROBE_NODE, xAxis: { field: 'stage' } }} dataSource={ds} />);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await settle();

    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(ds.find).toHaveBeenCalledWith('task', { $filter: [] });
    expect(screen.queryByTestId(REFUSAL)).toBeNull();
    expect(screen.getByTestId('chart-renderer')).toHaveAttribute('data-rows', String(ROWS.length));
  });
});
