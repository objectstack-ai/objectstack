// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11526 — an authored `object-metric` whose `aggregate.groupBy` is
 * the structured node and whose `filter` is the bag's rule list draws its
 * number.
 *
 * The bag's `filter` is a `ViewFilterRule[]` (`ObjectMetricPropsSchema` in
 * `@objectstack/spec/ui`). A structured `groupBy` sends the tile down the
 * spec-shape query (objectui#8613), whose `where` `ObjectStackAdapter` posts
 * verbatim and refuses as a rule list with `UnloweredAggregateWhereError`
 * (objectui#6825, ruling A). So before this card the tile drew that refusal,
 * while the same rule list on the legacy bag (a string `groupBy`) drew the
 * number, because the adapter lowers the legacy bag's `filter` itself.
 *
 * The fix lowers the rule list in the producer, for the spec-shape query only
 * (`specShapeWhere` in `ObjectMetricWidget`). The oracle is the POSTED bag:
 * `where` must be a `FilterCondition`, the dialect `QuerySchema.where`
 * declares and the adapter's gate passes untouched. That half of the seam is
 * pinned in `data-objectstack`'s `aggregate-spec-shape-where.test.ts` ("a
 * FilterCondition OBJECT is not an array, and this gate leaves it alone"), and
 * the refusal this card keeps is pinned there too ("throws
 * UnloweredAggregateWhereError instead of posting a rule array").
 *
 * The controls are load-bearing: the legacy bag still carries the rule list
 * RAW (the adapter lowers that wire), and a flat record filter still travels
 * verbatim on the spec-shape query.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ObjectMetricBlockSchema, StrictAnyComponentSchema, safeValidateSchema } from '@object-ui/types/zod';
import { FilterConditionSchema } from '@objectstack/spec/data';
import { VIEW_FILTER_OPERATORS } from '@objectstack/spec/ui';
// Registers `object-metric` at MODULE scope, never inside a hook —
// object-ui/no-dynamic-import-in-test-hook.
import '../index';

afterEach(cleanup);

type Params = Record<string, unknown>;

/** An adapter that can aggregate, recording every call's options bag. */
const aggregatingAdapter = (rows: Record<string, unknown>[]) => ({
  aggregate: vi.fn(async (_object: string, _params: Params) => rows),
  find: vi.fn(async (_object: string, _params: Params) => ({ data: [] as unknown[] })),
});

/**
 * The authored node, in the `properties` form. The card's document, the
 * showcase-shaped one and each per-operator document are checked on the
 * block's own arm (`ObjectMetricBlockSchema`) and on both authoring faces:
 * `safeValidateSchema` (the tolerant `AnyComponentSchema`) and
 * `StrictAnyComponentSchema`, which `objectui validate` runs.
 */
const node = (properties: Record<string, unknown>) => ({ type: 'object-metric', properties });

const mount = (schema: Record<string, unknown>, adapter: unknown) =>
  render(
    <SchemaRendererProvider dataSource={adapter as never}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>,
  );

/** The options bag of the first `aggregate()` call. */
const bagOf = (adapter: ReturnType<typeof aggregatingAdapter>): Params =>
  adapter.aggregate.mock.calls[0][1];

/** The date-bucketing node, in the spelling `ChartGroupBySchema` admits. */
const MONTHLY = { field: 'close_date', dateGranularity: 'month' };

/** The card's rule list. */
const WON = [{ field: 'stage', operator: 'equals', value: 'won' }];

describe('object-metric — a structured `groupBy` with a rule-list `filter` draws its number (objectui#11526)', () => {
  it('posts the rule list lowered to a FilterCondition as `where`, and draws the number', async () => {
    // The card's document, as authored. Both authoring faces accept it, which
    // is what makes the refusal a defect rather than an authoring error.
    const doc = node({
      label: 'Won',
      objectName: 'opportunity',
      aggregate: { field: 'amount', function: 'sum', groupBy: MONTHLY },
      filter: WON,
    });
    expect(ObjectMetricBlockSchema.safeParse(doc).success).toBe(true);
    expect(safeValidateSchema(doc).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(doc).success).toBe(true);

    const adapter = aggregatingAdapter([{ close_date: '2026-01', amount: 42 }]);
    mount(doc, adapter);

    expect(await screen.findByText('42')).toBeTruthy();
    expect(adapter.aggregate.mock.calls[0][0]).toBe('opportunity');
    // The WHOLE bag, so a key added to or dropped from the call is red either way.
    expect(bagOf(adapter)).toEqual({
      groupBy: [MONTHLY],
      aggregations: [{ function: 'sum', alias: 'amount', field: 'amount' }],
      where: { stage: 'won' },
    });
    expect(Array.isArray(bagOf(adapter).where)).toBe(false);
    expect(FilterConditionSchema.safeParse(bagOf(adapter).where).success).toBe(true);
  });

  it('lowers a multi-rule list to one condition, on the count shape the showcase tiles author', async () => {
    // `app-showcase`'s My Work tiles count by `id` under a rule list; this is
    // its Open Tasks tile with a structured `groupBy` and a second rule added.
    // A count is summed across the buckets under the `count` alias.
    const doc = node({
      label: 'Open Tasks',
      objectName: 'showcase_task',
      aggregate: { field: 'id', function: 'count', groupBy: { field: 'created_at', dateGranularity: 'month' } },
      filter: [
        { field: 'status', operator: 'not_equals', value: 'done' },
        { field: 'priority', operator: 'in', value: ['high', 'urgent'] },
      ],
    });
    expect(ObjectMetricBlockSchema.safeParse(doc).success).toBe(true);
    expect(safeValidateSchema(doc).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(doc).success).toBe(true);

    const adapter = aggregatingAdapter([
      { created_at: '2026-01', count: 3 },
      { created_at: '2026-02', count: 4 },
    ]);
    mount(doc, adapter);

    expect(await screen.findByText('7')).toBeTruthy();
    expect(bagOf(adapter).where).toEqual({
      $and: [{ status: { $ne: 'done' } }, { priority: { $in: ['high', 'urgent'] } }],
    });
  });

  it('lowers every operator the spec`s rule vocabulary declares to a FilterCondition', async () => {
    // Read off the spec at run time, so an operator it adds is covered here
    // without an edit. A comparand is supplied where the operator takes one.
    const comparand: Record<string, unknown> = {
      in: ['a', 'b'],
      not_in: ['a', 'b'],
      between: [1, 9],
      greater_than: 5,
      less_than: 5,
      greater_than_or_equal: 5,
      less_than_or_equal: 5,
      before: '2026-01-01',
      after: '2026-01-01',
    };
    const valueless = new Set(['is_empty', 'is_not_empty', 'is_null', 'is_not_null']);
    expect(VIEW_FILTER_OPERATORS.length).toBeGreaterThan(0);

    for (const operator of VIEW_FILTER_OPERATORS) {
      const rule: Record<string, unknown> = { field: 'f', operator };
      if (!valueless.has(operator)) rule.value = comparand[operator] ?? 'x';
      const doc = node({
        objectName: 'deal',
        aggregate: { field: 'amount', function: 'sum', groupBy: MONTHLY },
        filter: [rule],
      });
      expect(ObjectMetricBlockSchema.safeParse(doc).success, operator).toBe(true);
      expect(safeValidateSchema(doc).success, operator).toBe(true);
      expect(StrictAnyComponentSchema.safeParse(doc).success, operator).toBe(true);

      const adapter = aggregatingAdapter([{ close_date: '2026-01', amount: 1 }]);
      mount(doc, adapter);
      await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
      const where = bagOf(adapter).where;
      expect(Array.isArray(where), operator).toBe(false);
      expect(where, operator).toBeDefined();
      expect(FilterConditionSchema.safeParse(where).success, operator).toBe(true);
      cleanup();
    }
  });

  it('an EMPTY rule list posts no filter, as the legacy wire posts none', async () => {
    const adapter = aggregatingAdapter([{ close_date: '2026-01', amount: 5 }]);
    mount(
      node({ objectName: 'deal', aggregate: { field: 'amount', function: 'sum', groupBy: MONTHLY }, filter: [] }),
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(bagOf(adapter).where).toBeUndefined();
  });

  it('BOUNDARY — an array the lowering cannot read is handed on, never dropped to "no filter"', async () => {
    // A record condition wrapped in an array is neither a rule list nor
    // filter AST. `parseFilterAST` answers `undefined` for it, which as
    // `where` would aggregate EVERY row under a filtered question. It is
    // handed on unparsed, so the adapter's refusal answers it instead.
    const unreadable = [{ stage: 'won' }];
    const adapter = aggregatingAdapter([{ close_date: '2026-01', amount: 5 }]);
    mount(
      node({ objectName: 'deal', aggregate: { field: 'amount', function: 'sum', groupBy: MONTHLY }, filter: unreadable }),
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(bagOf(adapter).where).toEqual(unreadable);
  });
});

describe('object-metric — the shapes that must NOT move (objectui#11526 controls)', () => {
  it('CONTROL — a string `groupBy` still carries the rule list RAW on the legacy bag', async () => {
    // The adapter lowers this wire's `filter` itself, so the producer leaves it
    // alone. A producer that lowered it here too would be a second lowering.
    const doc = node({
      label: 'Won',
      objectName: 'opportunity',
      aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' },
      filter: WON,
    });
    const adapter = aggregatingAdapter([{ amount_sum: 42 }]);
    mount(doc, adapter);

    expect(await screen.findByText('42')).toBeTruthy();
    expect(bagOf(adapter)).toEqual({
      field: 'amount',
      function: 'sum',
      groupBy: 'stage',
      filter: WON,
    });
  });

  it('CONTROL — a flat record filter still travels verbatim on the spec-shape query', async () => {
    const record = { stage: 'won' };
    const adapter = aggregatingAdapter([{ close_date: '2026-01', amount: 42 }]);
    mount(
      node({
        label: 'Won',
        objectName: 'opportunity',
        aggregate: { field: 'amount', function: 'sum', groupBy: MONTHLY },
        filter: record,
      }),
      adapter,
    );

    expect(await screen.findByText('42')).toBeTruthy();
    expect(bagOf(adapter).where).toEqual(record);
  });
});
