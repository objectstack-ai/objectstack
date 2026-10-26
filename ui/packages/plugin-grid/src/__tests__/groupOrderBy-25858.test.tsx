/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25858 — a grouped grid orders a level's groups by the level's
 * `orderBy` (spec `grouping.fields[].orderBy`, objectstack#25786), while the
 * group label still comes from `field`.
 *
 * HotCRM's forecast list groups by `period_label`, which sorts as text
 * (`Nov 2026` before `Oct 2026` before `Q1 2027`). With `orderBy:
 * 'period_start'` the spec's header query carries one `min` (asc) / `max`
 * (desc) column per ordered level, `listViewGroupOrderColumn` names it, and
 * the consumer owes the sort: by that value in `order`, a group with no value
 * last in both directions, equal values falling back to the key comparison in
 * the same direction.
 *
 * Pinned on both of the grid's group sources, since each sorts on its own:
 *   - SERVER-grouped: header rows shaped as `compileListViewGroupQuery`
 *     compiles them, at the hook and through `ObjectGrid` (which must forward
 *     `orderBy` into the header query for the column to exist at all);
 *   - CLIENT-grouped: the group's order value is folded from its rows.
 *
 * CONTROLS: a level with no `orderBy` keeps today's label / option order, and
 * its header query carries no order column.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { compileListViewGroupQuery, type ListViewGroupHeaderRow } from '@objectstack/spec/ui';

import { ObjectGrid } from '../ObjectGrid';
import { useGroupedData, useGroupedDataInOptionOrder } from '../useGroupedData';
import { buildCategoryOrder, buildCategoryRank } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource, GroupingConfig, ObjectGridSchema } from '@object-ui/types';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'forecast';

const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  period_label: { type: 'text', label: 'Period' },
  period_start: { type: 'date', label: 'Period start' },
};

/**
 * Forecast rows whose labels sort differently as text, two rows for some
 * periods, and one period with no start date. `Oct 2026` and `Q4 2026` share a
 * start date, so the key comparison breaks their tie.
 */
const ROWS: Array<Record<string, unknown>> = [
  { id: 'f1', name: 'A', period_label: 'Q4 2025', period_start: '2025-10-01' },
  { id: 'f2', name: 'B', period_label: 'Sep 2026', period_start: '2026-09-01' },
  { id: 'f3', name: 'C', period_label: 'Oct 2026', period_start: '2026-10-01' },
  { id: 'f4', name: 'D', period_label: 'Q4 2026', period_start: '2026-10-01' },
  { id: 'f5', name: 'E', period_label: 'Nov 2026', period_start: '2026-11-01' },
  { id: 'f6', name: 'F', period_label: 'Q1 2027', period_start: '2027-01-01' },
  { id: 'f7', name: 'G', period_label: 'Undated', period_start: null },
  { id: 'f8', name: 'H', period_label: 'Nov 2026', period_start: '2026-11-01' },
  { id: 'f9', name: 'I', period_label: 'Q4 2025', period_start: '2025-10-01' },
];

/** Descending `period_start`; the tie in key order, descending; undated last. */
const DESC_BY_START = ['Q1 2027', 'Nov 2026', 'Q4 2026', 'Oct 2026', 'Sep 2026', 'Q4 2025', 'Undated'];
/** Ascending `period_start`; the tie in key order, ascending; undated still last. */
const ASC_BY_START = ['Q4 2025', 'Sep 2026', 'Oct 2026', 'Q4 2026', 'Nov 2026', 'Q1 2027', 'Undated'];

type AggregationNode = { function: string; field?: string; alias: string };
type HeaderQuery = { where?: unknown; groupBy?: string[]; aggregations?: AggregationNode[] };

/** The `FilterCondition` subset the compiled group queries use. */
function matches(row: Record<string, unknown>, cond: unknown): boolean {
  if (cond === undefined || cond === null) return true;
  return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((c) => matches(row, c));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if ('$eq' in op) return row[key] === op.$eq;
      if ('$null' in op) return op.$null ? row[key] == null : row[key] != null;
      throw new Error(`double: unsupported operator ${JSON.stringify(op)}`);
    }
    return row[key] === value;
  });
}

/**
 * Answer a compiled header query over `rows` the way an engine's `GROUP BY`
 * does: one row per bucket in the stored keys' order, each grouped field under
 * its own name, then every aggregation node under its alias — `count`, and
 * `min` / `max` over the non-null values (`null` when there are none).
 */
function answerHeaderQuery(rows: Array<Record<string, unknown>>, query: HeaderQuery): ListViewGroupHeaderRow[] {
  const groupBy = query.groupBy ?? [];
  const buckets = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows.filter((r) => matches(r, query.where))) {
    const key = JSON.stringify(groupBy.map((f) => row[f] ?? null));
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, members]) => {
      const values = JSON.parse(key) as unknown[];
      const out: Record<string, unknown> = Object.fromEntries(groupBy.map((f, i) => [f, values[i]]));
      for (const node of query.aggregations ?? []) {
        if (node.function === 'count') {
          out[node.alias] = members.length;
          continue;
        }
        const present = members.map((m) => m[node.field!]).filter((v) => v !== null && v !== undefined) as string[];
        if (node.function !== 'min' && node.function !== 'max') throw new Error(`double: unsupported ${node.function}`);
        out[node.alias] = present.length === 0
          ? null
          : present.reduce((acc, v) => ((node.function === 'min' ? v < acc : v > acc) ? v : acc));
      }
      return out as ListViewGroupHeaderRow;
    });
}

/** Header rows for every depth of `grouping`, compiled by the spec. */
function compiledHeaders(grouping: GroupingConfig, rows = ROWS): ListViewGroupHeaderRow[][] {
  return grouping.fields.map((_, depthIndex) =>
    answerHeaderQuery(rows, compileListViewGroupQuery({ grouping } as never, { depth: depthIndex + 1 }) as HeaderQuery),
  );
}

afterEach(() => cleanup());

describe('the header query an ordered level compiles (objectstack#25786, the contract this card reads)', () => {
  it('carries a `max` column for `desc` and a `min` column for `asc`, beside the one groupBy column', () => {
    const desc = compileListViewGroupQuery({
      grouping: { fields: [{ field: 'period_label', orderBy: 'period_start', order: 'desc' }] },
    } as never);
    expect(desc.groupBy).toEqual(['period_label']);
    expect(desc.aggregations).toContainEqual({ function: 'max', field: 'period_start', alias: 'max_period_start' });
    const asc = compileListViewGroupQuery({
      grouping: { fields: [{ field: 'period_label', orderBy: 'period_start' }] },
    } as never);
    expect(asc.aggregations).toContainEqual({ function: 'min', field: 'period_start', alias: 'min_period_start' });
  });
});

describe('server-grouped: the hook sorts header rows by the level\'s order column (objectstack#25858)', () => {
  const groupLabelsOf = (grouping: GroupingConfig, headers = compiledHeaders(grouping)) => {
    const { result } = renderHook(() => useGroupedData(grouping, [], undefined, undefined, { headers }));
    return result.current.groups.map((g) => g.label);
  };

  it('`orderBy: period_start, order: desc` — one header per label, descending start, undated last', () => {
    expect(groupLabelsOf({ fields: [{ field: 'period_label', orderBy: 'period_start', order: 'desc' }] }))
      .toEqual(DESC_BY_START);
  });

  it('`order: asc` — ascending start; the undated group is STILL last', () => {
    expect(groupLabelsOf({ fields: [{ field: 'period_label', orderBy: 'period_start', order: 'asc' }] }))
      .toEqual(ASC_BY_START);
  });

  it('the group count is still the header\'s own', () => {
    const grouping: GroupingConfig = { fields: [{ field: 'period_label', orderBy: 'period_start', order: 'desc' }] };
    const headers = compiledHeaders(grouping);
    const { result } = renderHook(() => useGroupedData(grouping, [], undefined, undefined, { headers }));
    expect(result.current.groups.map((g) => [g.label, g.count])).toEqual(
      DESC_BY_START.map((label) => [label, ROWS.filter((r) => r.period_label === label).length]),
    );
  });

  it('an OUTER level orders by its own order column; the inner level keeps label order', () => {
    const grouping: GroupingConfig = {
      fields: [
        { field: 'period_label', orderBy: 'period_start', order: 'desc' },
        { field: 'name' },
      ],
    };
    const headers = compiledHeaders(grouping);
    const { result } = renderHook(() => useGroupedData(grouping, [], undefined, undefined, { headers }));
    expect(result.current.groups.map((g) => g.label)).toEqual(DESC_BY_START);
    const nov = result.current.groups.find((g) => g.label === 'Nov 2026')!;
    expect(nov.subgroups.map((g) => g.label)).toEqual(['E', 'H']);
  });

  it('CONTROL — no `orderBy`: label order, exactly as before', () => {
    expect(groupLabelsOf({ fields: [{ field: 'period_label', order: 'desc' }] })).toEqual(
      ['Undated', 'Sep 2026', 'Q4 2026', 'Q4 2025', 'Q1 2027', 'Oct 2026', 'Nov 2026'],
    );
  });

  it('CONTROL — `orderBy` naming the grouping field itself orders by the key', () => {
    expect(groupLabelsOf({ fields: [{ field: 'period_label', orderBy: 'period_label' }] })).toEqual(
      ['Nov 2026', 'Oct 2026', 'Q1 2027', 'Q4 2025', 'Q4 2026', 'Sep 2026', 'Undated'],
    );
  });
});

describe('client-grouped: each group\'s order value is folded from its rows (objectstack#25858)', () => {
  const groupLabelsOf = (grouping: GroupingConfig, rows: Array<Record<string, unknown>> = ROWS) => {
    const { result } = renderHook(() => useGroupedData(grouping, rows));
    return result.current.groups.map((g) => g.label);
  };

  it('`orderBy: period_start, order: desc` — descending start, undated last', () => {
    expect(groupLabelsOf({ fields: [{ field: 'period_label', orderBy: 'period_start', order: 'desc' }] }))
      .toEqual(DESC_BY_START);
  });

  it('`order: asc` — ascending start, undated last', () => {
    expect(groupLabelsOf({ fields: [{ field: 'period_label', orderBy: 'period_start' }] })).toEqual(ASC_BY_START);
  });

  it('a group sits where its FIRST row would: its `min` for asc, its `max` for desc', () => {
    // `wide` spans 1..10; `narrow` is 5 throughout.
    const rows = [
      { id: 1, bucket: 'wide', rank: 10 },
      { id: 2, bucket: 'narrow', rank: 5 },
      { id: 3, bucket: 'wide', rank: 1 },
      { id: 4, bucket: 'narrow', rank: 5 },
    ];
    expect(groupLabelsOf({ fields: [{ field: 'bucket', orderBy: 'rank', order: 'asc' }] }, rows))
      .toEqual(['wide', 'narrow']);
    expect(groupLabelsOf({ fields: [{ field: 'bucket', orderBy: 'rank', order: 'desc' }] }, rows))
      .toEqual(['wide', 'narrow']);
    // Sorted by `rank`, the rows read 1(wide) 5 5 10 ascending and 10(wide)
    // 5 5 1 descending: `wide` leads both. Lift its smallest value past 5 and
    // it no longer leads ascending.
    const narrowFirstAsc = [{ id: 1, bucket: 'wide', rank: 7 }, { id: 2, bucket: 'narrow', rank: 5 }];
    expect(groupLabelsOf({ fields: [{ field: 'bucket', orderBy: 'rank', order: 'asc' }] }, narrowFirstAsc))
      .toEqual(['narrow', 'wide']);
  });

  it('a numeric order value arriving as a numeric string orders as the number', () => {
    const rows = [
      { id: 1, bucket: 'a', amount: '3.10' },
      { id: 2, bucket: 'b', amount: '3.9' },
      { id: 3, bucket: 'c', amount: '12' },
    ];
    expect(groupLabelsOf({ fields: [{ field: 'bucket', orderBy: 'amount' }] }, rows)).toEqual(['a', 'b', 'c']);
  });

  it('CONTROL — no `orderBy`: label order, exactly as before', () => {
    expect(groupLabelsOf({ fields: [{ field: 'period_label' }] })).toEqual(
      ['Nov 2026', 'Oct 2026', 'Q1 2027', 'Q4 2025', 'Q4 2026', 'Sep 2026', 'Undated'],
    );
  });
});

describe('precedence: `orderBy` ahead of a declared option order (objectstack#25858)', () => {
  const STAGES = [
    { value: 'won', label: 'Won' },
    { value: 'open', label: 'Open' },
    { value: 'lost', label: 'Lost' },
  ];
  const ranks = new Map([['stage', buildCategoryRank(buildCategoryOrder(STAGES))!]]);
  const rows = [
    { id: 1, stage: 'won', closed_on: '2026-03-01' },
    { id: 2, stage: 'open', closed_on: '2026-01-01' },
    { id: 3, stage: 'lost', closed_on: '2026-02-01' },
  ];

  it('a level with `orderBy` orders by it, not by the options', () => {
    const { result } = renderHook(() =>
      useGroupedDataInOptionOrder(
        { fields: [{ field: 'stage', orderBy: 'closed_on' }] }, rows, undefined, undefined, undefined, ranks,
      ),
    );
    expect(result.current.groups.map((g) => g.keyValues.stage)).toEqual(['open', 'lost', 'won']);
  });

  it('equal order values fall back to the option order, in the same direction', () => {
    const tied = rows.map((r) => ({ ...r, closed_on: '2026-01-01' }));
    const asc = renderHook(() =>
      useGroupedDataInOptionOrder(
        { fields: [{ field: 'stage', orderBy: 'closed_on' }] }, tied, undefined, undefined, undefined, ranks,
      ),
    );
    expect(asc.result.current.groups.map((g) => g.keyValues.stage)).toEqual(['won', 'open', 'lost']);
    const desc = renderHook(() =>
      useGroupedDataInOptionOrder(
        { fields: [{ field: 'stage', orderBy: 'closed_on', order: 'desc' }] }, tied, undefined, undefined, undefined, ranks,
      ),
    );
    expect(desc.result.current.groups.map((g) => g.keyValues.stage)).toEqual(['lost', 'open', 'won']);
  });

  it('CONTROL — without `orderBy` the declared option order is unchanged', () => {
    const { result } = renderHook(() =>
      useGroupedDataInOptionOrder({ fields: [{ field: 'stage' }] }, rows, undefined, undefined, undefined, ranks),
    );
    expect(result.current.groups.map((g) => g.keyValues.stage)).toEqual(['won', 'open', 'lost']);
  });
});

describe('through ObjectGrid: `orderBy` reaches the header query and orders the painted headers (objectstack#25858)', () => {
  const makeServerSource = () => ({
    queryGroupHeaders: vi.fn(async (_object: string, query: HeaderQuery) => answerHeaderQuery(ROWS, query)),
    find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
      const matching = ROWS.filter((r) => matches(r, params.$filter));
      const skip = (params.$skip as number | undefined) ?? 0;
      const top = (params.$top as number | undefined) ?? matching.length;
      return { data: matching.slice(skip, skip + top), total: matching.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
  });

  const renderGrid = (grouping: GroupingConfig, data?: unknown) => {
    const ds = makeServerSource();
    render(
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: OBJECT,
            columns: ['name', 'period_label', 'period_start'],
            ...(data ? { data } : {}),
            grouping,
          } as unknown as ObjectGridSchema}
          dataSource={ds as unknown as DataSource}
        />
      </ActionProvider>,
    );
    return ds;
  };

  const groupLabels = () =>
    Array.from(document.querySelectorAll('.group-label')).map((el) => el.textContent);

  it('server-grouped: the header query carries `max_period_start`, and the groups read descending start', async () => {
    const ds = renderGrid({ fields: [{ field: 'period_label', orderBy: 'period_start', order: 'desc' }] });
    await vi.waitFor(() => expect(groupLabels()).toEqual(DESC_BY_START));
    const queries = ds.queryGroupHeaders.mock.calls.map(([, query]) => query as HeaderQuery);
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query.groupBy).toEqual(['period_label']);
      expect(query.aggregations).toContainEqual({ function: 'max', field: 'period_start', alias: 'max_period_start' });
    }
  });

  it('client-grouped (rows handed in): the groups read descending start', async () => {
    const ds = renderGrid(
      { fields: [{ field: 'period_label', orderBy: 'period_start', order: 'desc' }] },
      { provider: 'value', items: ROWS },
    );
    await vi.waitFor(() => expect(groupLabels()).toEqual(DESC_BY_START));
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();
  });

  it('CONTROL — no `orderBy`: the header query carries no order column, and label order holds', async () => {
    const ds = renderGrid({ fields: [{ field: 'period_label' }] });
    await vi.waitFor(() =>
      expect(groupLabels()).toEqual(['Nov 2026', 'Oct 2026', 'Q1 2027', 'Q4 2025', 'Q4 2026', 'Sep 2026', 'Undated']),
    );
    for (const [, query] of ds.queryGroupHeaders.mock.calls) {
      expect((query as HeaderQuery).aggregations).toEqual([{ function: 'count', alias: 'count' }]);
    }
  });
});
