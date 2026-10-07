// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `fields[].aggregate` — every measure column of a dataset answer states the
 * aggregate its measure declares, whether or not the author labelled it.
 *
 * `builtinAggregate` answers one question only: "is this header the server's
 * default?". It is absent the moment an author writes a `label`, and every
 * measured showcase widget labels its measure (a `count` named "Tasks"). So on
 * exactly the columns a dashboard draws, the answer said `{ name, type:
 * 'number', label }` and nothing else, and a chart over a count drew 0.75 /
 * 1.5 / 2.25 axis ticks because it could not tell the count from a sum.
 *
 * The aggregate is part of the dataset's own authored measure, so the ADR-0021
 * column-description seam (`enrichResultColumns`) states it from there, like
 * `label` / `format` / `currency` / `percentScale`. That seam serves both paths
 * that produce a dataset answer, the live engine query and the ADR-0037 P3
 * draft-data preview, so each pin below is asserted on both.
 *
 * Reverse verification, direction predicted BEFORE running: deleting the one
 * producer line that writes `f.aggregate` turns every positive `aggregate`
 * assertion RED on both paths and leaves the absence assertions and every
 * `builtinAggregate` assertion GREEN. Deleting only its `!m.derived` guard
 * turns the stray-aggregate case RED and nothing else.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

interface Task extends Record<string, unknown> {
  status: string;
  amount: number;
  due_on: string;
}

const ROWS: Task[] = [
  { status: 'open', amount: 100, due_on: '2026-02-03' },
  { status: 'open', amount: 50, due_on: '2026-02-10' },
  { status: 'done', amount: 25, due_on: '2026-02-15' },
  { status: 'done', amount: 10, due_on: '2026-01-20' },
];

const DATASET = DatasetSchema.parse({
  name: 'task_ds',
  label: 'Tasks',
  object: 'task',
  dimensions: [
    { name: 'status', field: 'status', type: 'string', label: 'Status' },
    { name: 'due_on', field: 'due_on', type: 'date', label: 'Due' },
  ],
  measures: [
    // The showcase shape: a `count` the author named.
    { name: 'task_count', aggregate: 'count', label: 'Tasks' },
    // The built-in default: no label, so `builtinAggregate` too.
    { name: 'count', aggregate: 'count' },
    // A `sum` over a currency field.
    { name: 'total_amount', aggregate: 'sum', field: 'amount', label: 'Total Amount', format: '$0,0' },
    // A derived measure has no single aggregate.
    { name: 'open_share', derived: { op: 'ratio', of: ['task_count', 'count'] }, label: 'Share' },
  ],
});

const sourceFieldMeta = (object: string, field: string) => {
  if (object !== 'task') return undefined;
  if (field === 'amount') return { type: 'currency' };
  if (field === 'due_on') return { type: 'date' };
  return undefined;
};

const CTX = { tenantId: 'org_A', currency: 'USD' } as ExecutionContext;

/** Enough of a GROUP BY for this fixture: the LIVE path's engine. */
function evaluateAggregate(opts: { groupBy?: unknown; aggregations?: unknown }) {
  const groupBy = (opts.groupBy ?? []) as Array<string | { field: string }>;
  const aggs = (opts.aggregations ?? []) as Array<{ field: string; method: string; alias: string }>;
  const buckets = new Map<string, { key: Record<string, unknown>; rows: Task[] }>();
  for (const r of ROWS) {
    const key: Record<string, unknown> = {};
    for (const g of groupBy) {
      const f = typeof g === 'string' ? g : g.field;
      key[f] = r[f];
    }
    const id = JSON.stringify(Object.values(key));
    let b = buckets.get(id);
    if (!b) { b = { key, rows: [] }; buckets.set(id, b); }
    b.rows.push(r);
  }
  return [...buckets.values()].map(({ key, rows }) => {
    const row: Record<string, unknown> = { ...key };
    for (const a of aggs) {
      row[a.alias] = a.method === 'sum'
        ? rows.reduce((s, r) => s + Number(r[a.field] ?? 0), 0)
        : rows.length;
    }
    return row;
  });
}

/** Two services that differ ONLY in whether a pending seed draft exists. */
function svc(preview: boolean) {
  return new AnalyticsService({
    sourceFieldMeta,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, options: Record<string, unknown>) => evaluateAggregate(options),
    ...(preview ? { draftRowsResolver: async () => ROWS as Record<string, unknown>[] } : {}),
  });
}

type Field = Awaited<ReturnType<AnalyticsService['queryDataset']>>['fields'][number];
const byName = (fields: Field[]) => Object.fromEntries(fields.map((f) => [f.name, f]));

async function bothPaths(dataset = DATASET, selection: Record<string, unknown> = {
  dimensions: ['status'],
  measures: ['task_count', 'count', 'total_amount', 'open_share'],
}) {
  const live = await svc(false).queryDataset(dataset, selection as never, CTX);
  const preview = await svc(true).queryDataset(dataset, selection as never, CTX, { previewDrafts: true });
  return { live: byName(live.fields), preview: byName(preview.fields) };
}

describe('fields[].aggregate — a dataset answer states each measure column\'s aggregate', () => {
  it('a labelled `count` measure states `count`, and an unlabelled one still carries builtinAggregate', async () => {
    const { live, preview } = await bothPaths();
    for (const [path, fields] of [['live', live], ['preview', preview]] as const) {
      // The showcase column: the author's label, and now the aggregate beside it.
      expect(fields.task_count?.label, path).toBe('Tasks');
      expect(fields.task_count?.aggregate, path).toBe('count');
      // `builtinAggregate` keeps its label-only meaning: absent under a label…
      expect(fields.task_count?.builtinAggregate, path).toBeUndefined();
      // …and present, beside the new member, on the label-less default.
      expect(fields.count?.builtinAggregate, path).toBe('count');
      expect(fields.count?.aggregate, path).toBe('count');
      expect(fields.count?.label, path).toBeUndefined();
    }
  });

  it('a `sum` over a currency field states `sum`', async () => {
    const { live, preview } = await bothPaths();
    for (const [path, fields] of [['live', live], ['preview', preview]] as const) {
      expect(fields.total_amount?.aggregate, path).toBe('sum');
      // The column's other descriptors are untouched by the new member.
      expect(fields.total_amount?.currency, path).toBe('USD');
      expect(fields.total_amount?.format, path).toBe('$0,0');
      expect(fields.total_amount?.type, path).toBe('number');
    }
  });

  it('the preview path states the same as the live path, column for column', async () => {
    const { live, preview } = await bothPaths();
    expect(Object.keys(preview).sort()).toEqual(Object.keys(live).sort());
    for (const name of Object.keys(live)) {
      expect(preview[name]?.aggregate, `column "${name}"`).toBe(live[name]?.aggregate);
    }
  });

  it('is absent on a dimension column and on a derived measure, on both paths', async () => {
    const { live, preview } = await bothPaths();
    for (const [path, fields] of [['live', live], ['preview', preview]] as const) {
      expect(fields.status, path).toBeDefined();
      expect(fields.status?.aggregate, path).toBeUndefined();
      expect(fields.open_share, path).toBeDefined();
      expect(fields.open_share?.aggregate, path).toBeUndefined();
    }
  });

  it('a derived measure that also declares a stray `aggregate` states none: the compiler ignores it', async () => {
    const stray = DatasetSchema.parse({
      ...DATASET,
      name: 'task_ds_stray',
      measures: [
        { name: 'task_count', aggregate: 'count', label: 'Tasks' },
        { name: 'count', aggregate: 'count' },
        { name: 'open_share', derived: { op: 'ratio', of: ['task_count', 'count'] }, aggregate: 'sum', label: 'Share' },
      ],
    });
    const { live, preview } = await bothPaths(stray, { dimensions: ['status'], measures: ['task_count', 'count', 'open_share'] });
    for (const [path, fields] of [['live', live], ['preview', preview]] as const) {
      expect(fields.open_share, path).toBeDefined();
      expect(fields.open_share?.aggregate, path).toBeUndefined();
      // Control: the base measures beside it are still described.
      expect(fields.task_count?.aggregate, path).toBe('count');
    }
  });

  it('a `__compare` column states its measure\'s aggregate, on both paths', async () => {
    const selection = {
      dimensions: ['status'],
      measures: ['task_count', 'total_amount'],
      timeDimensions: [{ dimension: 'due_on', dateRange: ['2026-02-01', '2026-02-28'] }],
      compareTo: { kind: 'previousPeriod', dimension: 'due_on' },
    };
    const { live, preview } = await bothPaths(DATASET, selection);
    for (const [path, fields] of [['live', live], ['preview', preview]] as const) {
      expect(fields.task_count__compare, path).toBeDefined();
      expect(fields.task_count__compare?.aggregate, path).toBe('count');
      expect(fields.total_amount__compare?.aggregate, path).toBe('sum');
    }
  });
});

describe('fields[].aggregate — absent on a cube query answer', () => {
  it('`query()` (POST /analytics/query) never passes through the dataset column seam, so it states none', async () => {
    const service = new AnalyticsService({
      cubes: [{
        name: 'task_cube',
        title: 'Tasks',
        sql: 'task',
        measures: { task_count: { label: 'Tasks', type: 'count', sql: '*' } },
        dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } },
      } as never],
      sourceFieldMeta,
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (_object: string, options: Record<string, unknown>) => evaluateAggregate(options),
    });
    const result = await service.query(
      { cube: 'task_cube', measures: ['task_count'], dimensions: ['status'] },
      CTX,
    );
    const measure = result.fields.find((f) => f.name === 'task_count');
    expect(measure).toBeDefined();
    expect(measure?.aggregate).toBeUndefined();
  });
});
