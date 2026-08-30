// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4033 — a `timeDimensions`-only bucket must reach the caller.
 *
 * `timeDimensions` is not merely a filter carrier: an entry with a
 * `granularity` is GROUPED BY, so its bucket is a column of the result. The
 * strategy grouped by it correctly — the echoed SQL even read
 * `date_trunc('month', due_date) AS "due_date"` — but the row mapper and
 * `buildFieldMeta` both enumerated `query.dimensions` alone, so the bucket was
 * dropped on the way out:
 *
 *   rows:   [{ count: 2 }, { count: 8 }]
 *   fields: [{ name: 'count', type: 'number' }]
 *
 * A trend chart therefore got N values and no x-axis. Measured on a live
 * showcase app, which is what makes this worth pinning: the numbers were right,
 * so nothing downstream errored — the labels were simply gone. The identical
 * query written with `dimensions: ['due_date']` was always fine, which is why
 * it survived so long.
 *
 * A `timeDimensions` entry WITHOUT a granularity contributes only a `dateRange`
 * predicate and is not grouped — projecting it would invent a column, so the
 * negative case is pinned too.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';

const dataset = DatasetSchema.parse({
  name: 'delivery',
  label: 'Delivery',
  object: 'task',
  dimensions: [
    { name: 'due_date', field: 'due_date', type: 'date' },
    { name: 'priority', field: 'priority', type: 'string' },
  ],
  measures: [{ name: 'count', aggregate: 'count', field: 'id' }],
});

const TABLE: Row[] = [
  { id: 1, due_date: '2026-01-10', priority: 'high' },
  { id: 2, due_date: '2026-01-20', priority: 'low' },
  { id: 3, due_date: '2026-02-05', priority: 'high' },
];

const ctx = { tenantId: 'org_A', userId: 'u_a' } as ExecutionContext;
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

type Row = Record<string, unknown>;
type GroupByItem = string | { field: string; dateGranularity: string };
type AggOpts = {
  groupBy?: GroupByItem[];
  aggregations?: Array<{ field: string; method: string; alias: string }>;
  filter?: Record<string, unknown>;
};

/** `engine.aggregate()` stand-in: buckets and counts, honestly. */
const aggregate = async (_object: string, opts: AggOpts): Promise<Row[]> => {
  const buckets = new Map<string, Row>();
  for (const r of TABLE) {
    const key: Row = {};
    for (const g of opts.groupBy ?? []) {
      if (typeof g === 'string') key[g] = r[g];
      else key[g.field] = String(r[g.field]).slice(0, 7); // month
    }
    const id = JSON.stringify(key);
    const b = buckets.get(id) ?? { ...key };
    for (const a of opts.aggregations ?? []) {
      if (a.method === 'count') b[a.alias] = Number(b[a.alias] ?? 0) + 1;
    }
    buckets.set(id, b);
  }
  return [...buckets.values()];
};

const service = () =>
  new AnalyticsService({
    cubes: [compileDataset(dataset).cube],
    queryCapabilities: objectqlOnly,
    executeAggregate: aggregate,
  });

describe('ObjectQLStrategy — timeDimensions bucket projection (#4033)', () => {
  it('projects a timeDimensions-only bucket into the rows', async () => {
    const result = await service().query(
      {
        cube: 'delivery',
        measures: ['count'],
        timeDimensions: [{ dimension: 'due_date', granularity: 'month' }],
      },
      ctx,
    );

    // Before the fix these rows were `[{count:2},{count:1}]` — right numbers,
    // no labels.
    expect(result.rows).toEqual([
      { due_date: '2026-01', count: 2 },
      { due_date: '2026-02', count: 1 },
    ]);
  });

  it('declares the bucket in fields, so a chart can find its x-axis', async () => {
    const result = await service().query(
      {
        cube: 'delivery',
        measures: ['count'],
        timeDimensions: [{ dimension: 'due_date', granularity: 'month' }],
      },
      ctx,
    );

    // `type` here is the CUBE dimension vocabulary, where every temporal
    // dimension is `time` — not the `Field.date` / `Field.datetime` /
    // `Field.time` vocabulary the driver stores by. The dataset declares
    // `type: 'date'`; the compiled cube dimension is `time`.
    expect(result.fields).toEqual([
      { name: 'due_date', type: 'time' },
      { name: 'count', type: 'number' },
    ]);
  });

  it('presents identically whether the bucket is named in dimensions or only in timeDimensions', async () => {
    const viaTimeDimensions = await service().query(
      {
        cube: 'delivery',
        measures: ['count'],
        timeDimensions: [{ dimension: 'due_date', granularity: 'month' }],
      },
      ctx,
    );
    const viaDimensions = await service().query(
      {
        cube: 'delivery',
        dimensions: ['due_date'],
        measures: ['count'],
        timeDimensions: [{ dimension: 'due_date', granularity: 'month' }],
      },
      ctx,
    );

    // The two spellings mean the same query; they used to disagree about
    // whether the answer carried its labels.
    expect(viaTimeDimensions.rows).toEqual(viaDimensions.rows);
    expect(viaTimeDimensions.fields).toEqual(viaDimensions.fields);
  });

  it('does not duplicate a bucket that is also listed in dimensions', async () => {
    const result = await service().query(
      {
        cube: 'delivery',
        dimensions: ['due_date'],
        measures: ['count'],
        timeDimensions: [{ dimension: 'due_date', granularity: 'month' }],
      },
      ctx,
    );

    expect(result.fields.filter((f) => f.name === 'due_date')).toHaveLength(1);
  });

  it('keeps a non-granular timeDimension OUT of the projection — it only filters', async () => {
    const result = await service().query(
      {
        cube: 'delivery',
        dimensions: ['priority'],
        measures: ['count'],
        // No granularity: a window, not a bucket. Projecting it would declare a
        // column the engine never grouped by.
        timeDimensions: [{ dimension: 'due_date', dateRange: ['2026-01-01', '2026-12-31'] }],
      },
      ctx,
    );

    expect(result.fields.map((f) => f.name)).toEqual(['priority', 'count']);
    for (const row of result.rows) {
      expect(row).not.toHaveProperty('due_date');
    }
  });
});
