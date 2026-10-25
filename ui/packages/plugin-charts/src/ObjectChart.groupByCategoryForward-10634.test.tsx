/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10634 — an object-bound chart that names its category with
 * `aggregate.groupBy` ALONE draws that category.
 *
 * ## The defect this pins shut
 *
 * The objectui#8168 refusal lists `aggregate.groupBy` first among the bindings
 * that satisfy it, and `resolveChartCategoryField` accepts it. So a node with
 * `objectName` + `aggregate: { field, function, groupBy }` + `series` and no
 * `xAxisKey` / `xAxis` passed that screen, and was then refused one layer down:
 * the schema `ObjectChart` handed `ChartRenderer` carried no category key, so
 * `AdvancedChartImpl` floored it on `'name'`, found no row with a `name`
 * column, and drew `missing-category-key`. The author followed the renderer's
 * own remedy and was refused again, naming a key they never wrote.
 *
 * ## Why every assertion reads the DOM
 *
 * The card's bar is "the groupBy-only node drawing its categories". So each
 * case renders the whole chain — `ObjectChart` → its fetch → `ChartRenderer` →
 * `normalizeChartSchema` → `AdvancedChartImpl` — and reads the category ticks
 * and the refusal marker, never a prop. A key that is forwarded but names a
 * column the rows do not carry reads here as the refusal it produces.
 *
 * ## Which column the forward names
 *
 * The COLUMN the aggregate projects its group under, per the contract's
 * result-column convention (`chartAggregateResultKeys` in
 * `@objectstack/spec/ui`): the `groupBy` string, or `groupBy.alias ??
 * groupBy.field` for the structured node. That is not the FIELD
 * `resolveChartCategoryField` answers — its structured leg returns
 * `groupBy.field`, which is right for the refusal and the metadata probe and
 * wrong for a row lookup once an `alias` renames the column. The alias case
 * below is the one that tells the two apart.
 *
 * ⚠️ Mark and tick readings are harness-bound (`ResponsiveContainer` is fixed at
 * 480x320 here); they are derived in this file and never carried in.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// Recharts measures via ResizeObserver, which reports 0x0 under the headless
// DOM, so nothing paints. Fix its size — the shim every render test in this
// package uses.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

// `ChartRenderer` reaches the component under test through
// `React.lazy(() => import('./AdvancedChartImpl'))`. Importing the SAME
// specifier at module scope puts that load in the import phase, where no test
// or hook timeout applies (AGENTS.md, the flaky-test rule).
import './AdvancedChartImpl';
import { ObjectChart } from './ObjectChart';
import type { ObjectChartSchema } from '@object-ui/types';

beforeEach(() => {
  // `ObjectChart` probes object metadata for option colours on the global
  // fetch. Answered from a double so the render is offline and deterministic.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** The rows an aggregate `{ field: 'amount', function: 'sum', groupBy: 'stage' }` returns. */
const STAGE_ROWS = [
  { stage: 'won', amount: 10 },
  { stage: 'lost', amount: 4 },
];

/** The aggregate the card measured, its category named ONCE, as `groupBy`. */
const GROUP_BY_STAGE = { field: 'amount', function: 'sum', groupBy: 'stage' } as const;

const readChart = (container: HTMLElement) => ({
  marks: container.querySelectorAll('.recharts-rectangle').length,
  refusal: container.querySelector('[data-chart-error]')?.getAttribute('data-chart-error') ?? null,
  refusalText: container.querySelector('[data-chart-error]')?.textContent ?? null,
  screenRefusal: !!screen.queryByTestId('chart-missing-category-axis'),
  ticks: Array.from(container.querySelectorAll('.recharts-cartesian-axis-tick-value')).map((n) => n.textContent),
});

/**
 * Wait for a TERMINAL state — a plot or a refusal. Either satisfies it, so a
 * refusal is never mistaken for a timeout and a timeout is never read as "it
 * drew nothing".
 */
const settleChart = async (container: HTMLElement) => {
  await waitFor(() => {
    if (!container.querySelector('.recharts-surface') && !container.querySelector('[data-chart-error]')) {
      throw new Error('neither a plot nor a refusal');
    }
  }, { timeout: 5000 });
  return readChart(container);
};

const drawObjectChart = async (
  schema: Partial<ObjectChartSchema>,
  rows: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) => {
  const dataSource = { aggregate: vi.fn(async () => rows.map((row) => ({ ...row }))), ...extra };
  const { container } = render(
    <ObjectChart
      schema={{ type: 'object-chart', objectName: 'crm_opportunity', chartType: 'bar', isAnimationActive: false, ...schema }}
      dataSource={dataSource}
    />,
  );
  return { drawn: await settleChart(container), dataSource };
};

describe('a groupBy-only object-bound chart draws its categories (objectui#10634)', () => {
  it('string `groupBy` with no `xAxisKey` / `xAxis` — the card\'s measured node', async () => {
    const { drawn, dataSource } = await drawObjectChart(
      { aggregate: { ...GROUP_BY_STAGE }, series: [{ dataKey: 'amount' }] },
      STAGE_ROWS,
    );
    expect(dataSource.aggregate).toHaveBeenCalled();
    expect(drawn.screenRefusal).toBe(false);
    expect(drawn.refusal).toBeNull();
    expect(drawn.marks).toBe(2);
    expect(drawn.ticks).toEqual(expect.arrayContaining(['won', 'lost']));
  });

  it('control: the same node with `xAxisKey: \'stage\'` draws the same categories', async () => {
    const { drawn } = await drawObjectChart(
      { aggregate: { ...GROUP_BY_STAGE }, xAxisKey: 'stage', series: [{ dataKey: 'amount' }] },
      STAGE_ROWS,
    );
    expect(drawn.refusal).toBeNull();
    expect(drawn.marks).toBe(2);
    expect(drawn.ticks).toEqual(expect.arrayContaining(['won', 'lost']));
  });

  it('the structured `groupBy: { field }` form draws its categories', async () => {
    const { drawn } = await drawObjectChart(
      { aggregate: { field: 'amount', function: 'sum', groupBy: { field: 'stage' } }, series: [{ dataKey: 'amount' }] },
      STAGE_ROWS,
    );
    expect(drawn.refusal).toBeNull();
    expect(drawn.marks).toBe(2);
    expect(drawn.ticks).toEqual(expect.arrayContaining(['won', 'lost']));
  });

  it('a structured node with an `alias` binds the ALIASED column the rows carry, not the field', async () => {
    // `alias` renames the projected group column (`ChartGroupBySchema`: "this
    // becomes the category column"), so the rows arrive keyed by it. A forward
    // of the FIELD would bind `stage` against rows that have no `stage` and be
    // refused exactly as the card's node was.
    const aliasedRows = STAGE_ROWS.map(({ stage, amount }) => ({ pipeline_stage: stage, amount }));
    const { drawn } = await drawObjectChart(
      {
        aggregate: { field: 'amount', function: 'sum', groupBy: { field: 'stage', alias: 'pipeline_stage' } },
        series: [{ dataKey: 'amount' }],
      },
      aliasedRows,
    );
    expect(drawn.refusal).toBeNull();
    expect(drawn.marks).toBe(2);
    expect(drawn.ticks).toEqual(expect.arrayContaining(['won', 'lost']));
  });

  it('the forwarded key survives the groupBy label rewrite: the ticks are the option labels', async () => {
    const getObjectSchema = vi.fn(async () => ({
      fields: {
        stage: {
          type: 'select',
          options: [
            { value: 'won', label: 'Closed won' },
            { value: 'lost', label: 'Closed lost' },
          ],
        },
      },
    }));
    const { drawn } = await drawObjectChart(
      { aggregate: { ...GROUP_BY_STAGE }, series: [{ dataKey: 'amount' }] },
      STAGE_ROWS,
      { getObjectSchema },
    );
    expect(getObjectSchema).toHaveBeenCalled();
    expect(drawn.refusal).toBeNull();
    expect(drawn.marks).toBe(2);
    expect(drawn.ticks).toEqual(expect.arrayContaining(['Closed won', 'Closed lost']));
    expect(drawn.ticks).not.toContain('won');
  });
});

/**
 * The forward FILLS an absent slot; it never writes over one the author
 * authored. Each case below carries rows under BOTH columns, so the tick text
 * says which binding the axis actually read.
 */
describe('an authored category axis wins over the forwarded groupBy column (objectui#10634)', () => {
  const BOTH_COLUMNS = [
    { stage: 'won', owner: 'ann', amount: 10 },
    { stage: 'lost', owner: 'bob', amount: 4 },
  ];

  it('an authored `xAxisKey` is drawn, not the `groupBy` column', async () => {
    const { drawn } = await drawObjectChart(
      { aggregate: { ...GROUP_BY_STAGE }, xAxisKey: 'owner', series: [{ dataKey: 'amount' }] },
      BOTH_COLUMNS,
    );
    expect(drawn.refusal).toBeNull();
    expect(drawn.ticks).toEqual(expect.arrayContaining(['ann', 'bob']));
    expect(drawn.ticks).not.toContain('won');
  });

  it('an authored spec-shape `xAxis: { field }` is drawn, not the `groupBy` column', async () => {
    // The renderer resolves `xAxis.field` DOWNSTREAM of this component, so a
    // forward that asked only whether `xAxisKey` was written would shadow it.
    const { drawn } = await drawObjectChart(
      { aggregate: { ...GROUP_BY_STAGE }, xAxis: { field: 'owner' }, series: [{ dataKey: 'amount' }] },
      BOTH_COLUMNS,
    );
    expect(drawn.refusal).toBeNull();
    expect(drawn.ticks).toEqual(expect.arrayContaining(['ann', 'bob']));
    expect(drawn.ticks).not.toContain('won');
  });
});

/**
 * The forward is scoped to the path the objectui#8168 screen guards: an
 * object-bound chart that FETCHES its rows through the aggregate. Authored
 * rows are handed to `ChartRenderer` as they are — the aggregate never ran over
 * them, so its `groupBy` says nothing about their columns.
 */
describe('authored rows are untouched by the forward (objectui#10634)', () => {
  const AUTHORED = [{ name: 'Acme', amount: 1 }, { name: 'Globex', amount: 2 }];

  it('an object-bound node carrying authored `data` keeps the renderer\'s own category', async () => {
    const { container } = render(
      <ObjectChart
        schema={{
          type: 'object-chart',
          objectName: 'accounts',
          chartType: 'bar',
          isAnimationActive: false,
          aggregate: { ...GROUP_BY_STAGE },
          data: AUTHORED,
          series: [{ dataKey: 'amount' }],
        }}
      />,
    );
    const drawn = await settleChart(container);
    expect(drawn.refusal).toBeNull();
    expect(drawn.ticks).toEqual(expect.arrayContaining(['Acme', 'Globex']));
  });

  it('a static-data node (no `objectName`) keeps the renderer\'s own category', async () => {
    const { container } = render(
      <ObjectChart
        schema={{
          type: 'object-chart',
          chartType: 'bar',
          isAnimationActive: false,
          aggregate: { ...GROUP_BY_STAGE },
          data: AUTHORED,
          series: [{ dataKey: 'amount' }],
        }}
      />,
    );
    const drawn = await settleChart(container);
    expect(drawn.refusal).toBeNull();
    expect(drawn.ticks).toEqual(expect.arrayContaining(['Acme', 'Globex']));
  });
});
