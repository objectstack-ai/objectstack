/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8613 — an authored structured `aggregate.groupBy` on an
 * `object-metric` reaches the SPEC-SHAPE wire, not the analytics one.
 *
 * ## The defect, stated so an ablation reads cleanly
 *
 * `aggregate.groupBy` is a union: a bare field name, or the structured
 * date-bucketing node `{ field, dateGranularity?, alias? }`. The two need
 * DIFFERENT wires, and the adapter picks by the shape of the params it is
 * handed rather than by the shape of the authored value:
 *
 *   - `{ groupBy: GroupByNode[], aggregations, where }` reaches
 *     `engine.aggregate` and runs the server-side date-bucket engine;
 *   - `{ field, function, groupBy, filter }` reaches the cube/analytics wire,
 *     whose `dimensions` the contract declares as an array of dimension NAMES
 *     and which does not honour `dateGranularity` at all.
 *
 * `ObjectChart.runAggregate` has routed between them since objectui#7946.
 * `ObjectMetricWidget.computeOne` had no such branch: it forwarded the authored
 * value straight through, so the node was posted as
 * `dimensions: [{ field: 'closed_at', dateGranularity: 'month' }]` — an OBJECT
 * where a name is declared. Nothing refused it and nothing said so; the author
 * asked for monthly buckets and the platform answered a different question.
 *
 * ## Why the assertions are on the POSTED BODY
 *
 * The symptom is not a visible one — that is the whole complaint. A test that
 * asserted "the card no longer shows a wrong number" would pass on a metric
 * whose number happens to be right for the wrong reason, and every version of
 * this defect paints SOME number. So the oracle is what reaches the wire: the
 * whole options bag, by `toEqual`, so a member silently added to or dropped
 * from the call is red in either direction — the convention
 * `objectMetricQueryMembers-8071.test.tsx` set for this same call.
 *
 * ## ⭐ The controls are load-bearing, not decoration
 *
 * A repair that routed EVERYTHING through the spec-shape query would satisfy
 * every "the bad shape is gone" assertion while breaking the ordinary metric —
 * the one authoring shape that is actually shipped. So the plain string
 * `groupBy`, the absent one (`'_all'`), and the fieldless-count readback are
 * pinned here at the same fidelity, and they must stay green on BOTH ablation
 * legs. The array case is the third boundary: it is not this union's object arm
 * and must keep travelling to the producer-side refusal objectui#6864 landed in
 * the adapter, rather than being wrapped into a `groupBy: [[…]]` nobody can
 * refuse.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-metric` at MODULE scope, never inside a hook —
// object-ui/no-dynamic-import-in-test-hook.
import '../index';

afterEach(cleanup);

type Params = Record<string, unknown>;

/** An adapter that can aggregate — the only path this file exercises. */
const aggregatingAdapter = (rows: Record<string, unknown>[]) => ({
  aggregate: vi.fn(async (_object: string, _params: Params) => rows),
  find: vi.fn(async (_object: string, _params: Params) => ({ data: [] as unknown[] })),
});

const mount = (schema: Record<string, unknown>, adapter: unknown) =>
  render(
    <SchemaRendererProvider dataSource={adapter as never}>
      <SchemaRenderer schema={{ type: 'object-metric', label: 'Pipeline', ...schema } as never} />
    </SchemaRendererProvider>,
  );

/** The options bag of the first `aggregate()` call. */
const bagOf = (adapter: ReturnType<typeof aggregatingAdapter>): Params =>
  adapter.aggregate.mock.calls[0][1];

/** A predicate already in filter-AST form, so no lowering is in play. */
const OPEN = { stage: { $ne: 'closed' } };

/** The authored date-bucketing node, in the spelling `ChartGroupBySchema` admits. */
const MONTHLY = { field: 'closed_at', dateGranularity: 'month' };

describe('object-metric — a structured `aggregate.groupBy` takes the spec-shape wire (objectui#8613)', () => {
  it('posts `{ groupBy: [node], aggregations, where }` — and none of the analytics keys', async () => {
    const adapter = aggregatingAdapter([{ closed_at: '2026-01-01', amount: 120 }]);
    mount(
      {
        objectName: 'deal',
        aggregate: { field: 'amount', function: 'sum', groupBy: MONTHLY },
        filter: OPEN,
      },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(adapter.aggregate.mock.calls[0][0]).toBe('deal');
    // The WHOLE bag. `alias` is REQUIRED by `AggregationNodeSchema` and names
    // the column the measure comes back under; the node itself travels
    // VERBATIM, which is what carries `dateGranularity` to the engine.
    expect(bagOf(adapter)).toEqual({
      groupBy: [MONTHLY],
      aggregations: [{ function: 'sum', alias: 'amount', field: 'amount' }],
      where: OPEN,
    });
    // Spelled out separately: the pre-fix call carried these three and no
    // `aggregations` at all, and a bag that grew the spec keys while KEEPING
    // the analytics ones is a third, worse state — the adapter refuses that
    // combination outright (objectui#6864).
    expect(Object.keys(bagOf(adapter)).sort()).toEqual(['aggregations', 'groupBy', 'where']);
  });

  it('omits `field` on a count so the engine emits `count(*)`', async () => {
    // The dashboard relays default `field: 'value'` for a widget with no
    // explicit measure column, and `count(value)` is "no such column: value" on
    // a SQL driver. The alias is then the literal `'count'`.
    const adapter = aggregatingAdapter([{ closed_at: '2026-01-01', count: 7 }]);
    mount(
      { objectName: 'deal', aggregate: { function: 'count', groupBy: MONTHLY } },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(bagOf(adapter)).toEqual({
      groupBy: [MONTHLY],
      aggregations: [{ function: 'count', alias: 'count' }],
      where: undefined,
    });
    expect(Object.keys((bagOf(adapter).aggregations as Params[])[0])).not.toContain('field');
  });

  it('carries the node`s own `alias` through untouched', async () => {
    // `alias` renames the projected GROUP column. It is the author's, not the
    // renderer's, so a builder that rebuilt the node instead of forwarding it
    // would drop it — and every row key would then be wrong.
    const aliased = { field: 'closed_at', dateGranularity: 'quarter', alias: 'q' };
    const adapter = aggregatingAdapter([{ q: '2026-Q1', amount: 5 }]);
    mount(
      { objectName: 'deal', aggregate: { field: 'amount', function: 'avg', groupBy: aliased } },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(bagOf(adapter).groupBy).toEqual([aliased]);
  });

  it('reads the bucketed rows back under the alias it asked for', async () => {
    // The request half is only half the contract: the measure comes back under
    // `chartMeasureKey`'s answer, and the existing readback has to find it
    // there. Two rows, `sum` — so the first bucket is the answer and a readback
    // that summed them would say 320.
    const adapter = aggregatingAdapter([
      { closed_at: '2026-01-01', amount: 120 },
      { closed_at: '2026-02-01', amount: 200 },
    ]);
    mount(
      { objectName: 'deal', aggregate: { field: 'amount', function: 'sum', groupBy: MONTHLY } },
      adapter,
    );

    expect(await screen.findByText('120')).toBeTruthy();
    expect(screen.queryByText('320')).toBeNull();
  });

  it('sums a fieldless count back across EVERY bucket, under the `count` alias', async () => {
    const adapter = aggregatingAdapter([
      { closed_at: '2026-01-01', count: 3 },
      { closed_at: '2026-02-01', count: 4 },
    ]);
    mount({ objectName: 'deal', aggregate: { function: 'count', groupBy: MONTHLY } }, adapter);

    expect(await screen.findByText('7')).toBeTruthy();
  });
});

describe('object-metric — the shapes that must NOT move (objectui#8613 controls)', () => {
  it('CONTROL — a plain string `groupBy` still takes the legacy analytics bag', async () => {
    const adapter = aggregatingAdapter([{ amount_sum: 120 }]);
    mount(
      {
        objectName: 'deal',
        aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' },
        filter: OPEN,
      },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(bagOf(adapter)).toEqual({
      field: 'amount',
      function: 'sum',
      groupBy: 'stage',
      filter: OPEN,
    });
  });

  it('CONTROL — an absent `groupBy` still floors at the single `_all` bucket', async () => {
    const adapter = aggregatingAdapter([{ amount_sum: 120 }]);
    mount({ objectName: 'deal', aggregate: { field: 'amount', function: 'sum' } }, adapter);

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(bagOf(adapter)).toEqual({
      field: 'amount',
      function: 'sum',
      groupBy: '_all',
      filter: undefined,
    });
  });

  it('BOUNDARY — an ARRAY `groupBy` is not this union`s object arm and is not wrapped', async () => {
    // It travels on the legacy bag exactly as before, where the adapter's own
    // `looksLikeSpecShape` picks it up and refuses it at the producer
    // (objectui#6864). Wrapping it here would produce `groupBy: [[…]]` — a
    // query no gate is written to refuse.
    const adapter = aggregatingAdapter([{ amount_sum: 120 }]);
    mount(
      {
        objectName: 'deal',
        aggregate: { field: 'amount', function: 'sum', groupBy: ['stage'] },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(bagOf(adapter)).toEqual({
      field: 'amount',
      function: 'sum',
      groupBy: ['stage'],
      filter: undefined,
    });
  });
});
