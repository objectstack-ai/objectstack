// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3650 — `timeDimensions[].dateRange` reaches the ObjectQL aggregate path.
 *
 * The strategy built its engine filter purely from `normalizeAnalyticsFilters`,
 * which reads only `where`. `dateRange` is a SIBLING of `where`, so the window
 * was dropped on the floor: no error, just every row ever recorded.
 *
 * That is not a corner case. `NativeSQLStrategy.canHandle` declines any query
 * carrying a `granularity`, so a date-bucketed trend lands here on EVERY driver
 * — and a bucketed trend is exactly the shape that also carries a range ("last
 * 12 months", "this quarter"). The chart rendered, the numbers were wrong.
 *
 * The bridge below is HONEST — it actually applies the filter it is handed — so
 * a missing predicate produces real extra rows rather than an artifact of a
 * permissive stub.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';
import { DatasetExecutor } from '../dataset-executor.js';

const dataset = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  dimensions: [
    { name: 'close_date', field: 'close_date', type: 'date' },
    { name: 'stage', field: 'stage', type: 'string' },
  ],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

/** Rows straddling the window, so a dropped bound shows up as extra revenue. */
const TABLE = [
  { id: 1, close_date: '2025-11-15', stage: 'won', amount: 900 }, // before
  { id: 2, close_date: '2026-01-10', stage: 'won', amount: 100 }, // inside
  { id: 3, close_date: '2026-01-20', stage: 'lost', amount: 200 }, // inside
  { id: 4, close_date: '2026-02-14', stage: 'won', amount: 30 }, // inside (Feb)
  { id: 5, close_date: '2026-06-05', stage: 'won', amount: 700 }, // after
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

/** Evaluate the FilterCondition subset these tests can produce. */
function matches(row: Row, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$and') return (cond as Record<string, unknown>[]).every((sub) => matches(row, sub));
    if (key.startsWith('$')) throw new Error(`test bridge: unhandled operator ${key}`);
    const v = row[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      return Object.entries(cond as Record<string, unknown>).every(([op, operand]) => {
        switch (op) {
          case '$gte': return String(v) >= String(operand);
          case '$lte': return String(v) <= String(operand);
          case '$gt': return String(v) > String(operand);
          case '$lt': return String(v) < String(operand);
          case '$ne': return v !== operand;
          default: throw new Error(`test bridge: unhandled operator ${op}`);
        }
      });
    }
    return v === cond;
  });
}

/** `engine.aggregate()` stand-in: filters, buckets, sums — for real. */
function makeAggregate(seen: AggOpts[], table: Row[] = TABLE) {
  return async (_object: string, opts: AggOpts): Promise<Row[]> => {
    seen.push(opts);
    const rows = table.filter((r) => matches(r, opts.filter ?? {}));
    const buckets = new Map<string, Row>();
    for (const r of rows) {
      const key: Row = {};
      for (const g of opts.groupBy ?? []) {
        if (typeof g === 'string') key[g] = r[g];
        // Only `month` bucketing is exercised here.
        else key[g.field] = String(r[g.field]).slice(0, 7);
      }
      const id = JSON.stringify(key);
      const b = buckets.get(id) ?? { ...key };
      for (const a of opts.aggregations ?? []) {
        if (a.method === 'sum') b[a.alias] = Number(b[a.alias] ?? 0) + Number(r[a.field] ?? 0);
        if (a.method === 'count') b[a.alias] = Number(b[a.alias] ?? 0) + 1;
      }
      buckets.set(id, b);
    }
    return [...buckets.values()];
  };
}

function makeService(seen: AggOpts[], overrides: Record<string, unknown> = {}) {
  const compiled = compileDataset(dataset);
  return new AnalyticsService({
    cubes: [compiled.cube],
    queryCapabilities: objectqlOnly,
    executeAggregate: makeAggregate(seen),
    ...overrides,
  });
}

describe('ObjectQLStrategy — timeDimensions[].dateRange (#3650)', () => {
  it('confines a date-bucketed trend to the requested window', async () => {
    const seen: AggOpts[] = [];
    const result = await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['close_date'],
        measures: ['revenue'],
        timeDimensions: [
          { dimension: 'close_date', granularity: 'month', dateRange: ['2026-01-01', '2026-02-28'] },
        ],
      },
      ctx,
    );

    // The window reaches the engine as an inclusive range — the same shape
    // NativeSQLStrategy binds as BETWEEN.
    expect(seen[0].filter).toEqual({ close_date: { $gte: '2026-01-01', $lte: '2026-02-28' } });
    // Nov (900) and Jun (700) are outside; before the fix all of history landed
    // in the chart — 1930 across four buckets instead of 330 across two.
    expect(result.rows).toEqual([
      { close_date: '2026-01', revenue: 300 },
      { close_date: '2026-02', revenue: 30 },
    ]);
  });

  it('still buckets by month while the window applies', async () => {
    const seen: AggOpts[] = [];
    await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['close_date'],
        measures: ['revenue'],
        timeDimensions: [
          { dimension: 'close_date', granularity: 'month', dateRange: ['2026-01-01', '2026-02-28'] },
        ],
      },
      ctx,
    );
    // The window must not displace the granularity lowering — both travel.
    expect(seen[0].groupBy).toEqual([{ field: 'close_date', dateGranularity: 'month' }]);
  });

  it('applies a window on a time dimension that is not also a selected dimension', async () => {
    const seen: AggOpts[] = [];
    const result = await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['stage'],
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
      },
      ctx,
    );

    expect(seen[0].filter).toEqual({ close_date: { $gte: '2026-01-01', $lte: '2026-01-31' } });
    expect(result.rows).toEqual([
      { stage: 'won', revenue: 100 },
      { stage: 'lost', revenue: 200 },
    ]);
  });

  it('degenerates a bare-string dateRange to a single point, like NativeSQLStrategy', async () => {
    const seen: AggOpts[] = [];
    const result = await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['stage'],
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'close_date', dateRange: '2026-01-20' }],
      },
      ctx,
    );

    expect(seen[0].filter).toEqual({ close_date: { $gte: '2026-01-20', $lte: '2026-01-20' } });
    expect(result.rows).toEqual([{ stage: 'lost', revenue: 200 }]);
  });

  it('narrows rather than vanishes on a one-entry dateRange array', async () => {
    const seen: AggOpts[] = [];
    await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['stage'],
        measures: ['revenue'],
        // The schema types `dateRange` as a plain `string[]`, so this parses.
        // `NativeSQLStrategy` drops such a window — but "drop the window" means
        // "plot all of history", the very failure #3650 is about.
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-20'] }],
      },
      ctx,
    );
    expect(seen[0].filter).toEqual({ close_date: { $gte: '2026-01-20', $lte: '2026-01-20' } });
  });

  it('ANDs the read scope around the window rather than replacing it', async () => {
    const seen: AggOpts[] = [];
    const svc = makeService(seen, {
      getReadScope: (_o: string, c?: ExecutionContext) =>
        c?.tenantId ? { organization_id: c.tenantId } : undefined,
    });
    await svc.query(
      {
        cube: 'sales',
        dimensions: ['stage'],
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
      },
      ctx,
    );

    expect(seen[0].filter).toEqual({
      $and: [
        { close_date: { $gte: '2026-01-01', $lte: '2026-01-31' } },
        { organization_id: 'org_A' },
      ],
    });
  });

  it('leaves a query without a dateRange unfiltered', async () => {
    const seen: AggOpts[] = [];
    await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['close_date'],
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'close_date', granularity: 'month' }],
      },
      ctx,
    );
    // An empty filter stays absent — the window is the only thing that would
    // have populated it, so a bucketed trend with no range still scans all.
    expect(seen[0].filter).toBeUndefined();
  });
});

describe('ObjectQLStrategy — window ∧ where on one field (#3650)', () => {
  it('intersects a window with a disjoint-operator where bound', async () => {
    const seen: AggOpts[] = [];
    const result = await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['stage'],
        measures: ['revenue'],
        // `$gt` and the window's `$gte`/`$lte` name different operators, so they
        // share one entry.
        where: { close_date: { $gt: '2026-01-15' } },
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
      },
      ctx,
    );

    expect(seen[0].filter).toEqual({
      close_date: { $gt: '2026-01-15', $gte: '2026-01-01', $lte: '2026-01-31' },
    });
    expect(result.rows).toEqual([{ stage: 'lost', revenue: 200 }]);
  });

  it('intersects a window with a COLLIDING where bound instead of widening', async () => {
    const seen: AggOpts[] = [];
    const result = await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['stage'],
        measures: ['revenue'],
        // A narrower `$gte` on the same field. Spreading the window over it
        // would keep the window's looser `2026-01-01` and silently widen the
        // query; the collision becomes its own conjunct instead.
        where: { close_date: { $gte: '2026-01-15' } },
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
      },
      ctx,
    );

    expect(seen[0].filter).toEqual({
      close_date: { $gte: '2026-01-15' },
      $and: [{ close_date: { $gte: '2026-01-01', $lte: '2026-01-31' } }],
    });
    // Jan 10 (100) is excluded by the caller's own narrower bound.
    expect(result.rows).toEqual([{ stage: 'lost', revenue: 200 }]);
  });

  it('keeps both operands when a bare equality meets an operator object', async () => {
    const seen: AggOpts[] = [];
    // `$and` in `where` flattens to two entries on one field — the shape that
    // used to have the second silently replace the first.
    await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['close_date'],
        measures: ['revenue'],
        where: { $and: [{ stage: 'won' }, { stage: { $ne: 'lost' } }] },
      },
      ctx,
    );

    // [#5298] The `$ne` operand arrives NULL-safe: `fieldLeaves` emits it as an
    // `or` of the null predicate with the comparison, so "stage is not lost"
    // keeps the rows that have no stage — the answer every other backend gives.
    // What this case is about is unchanged and still visible: BOTH operands
    // survive, the second as its own `$and` conjunct rather than overwriting the
    // bare equality.
    expect(seen[0].filter).toEqual({
      stage: 'won',
      $and: [{ $or: [{ stage: null }, { stage: { $ne: 'lost' } }] }],
    });
  });
});

describe('DatasetExecutor compareTo over the ObjectQL path (#3650)', () => {
  it('shifts the comparison window instead of re-running the identical query', async () => {
    const seen: AggOpts[] = [];
    const compiled = compileDataset(dataset);
    const svc = makeService(seen);

    const res = await new DatasetExecutor(svc).execute(compiled, {
      dimensions: ['stage'],
      measures: ['revenue'],
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
      compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
    });

    // `runCompare` builds the comparison pass by shifting `dateRange` and
    // nothing else. With the window dropped, the two passes were byte-identical
    // — every `__compare` column equalled its primary and the delta was always
    // a flat 0%.
    expect(seen).toHaveLength(2);
    expect(seen[0].filter).not.toEqual(seen[1].filter);
    const windows = seen.map((s) => (s.filter?.close_date as Record<string, unknown>)?.$gte);
    expect(windows).toEqual(['2026-01-01', '2025-12-01']);

    // Dec 2025 holds no rows, so the comparison is genuinely empty — not a copy
    // of the primary.
    const won = res.rows.find((r) => r.stage === 'won')!;
    expect(won.revenue).toBe(100);
    expect(won.revenue__compare ?? 0).toBe(0);
  });
});

describe('ObjectQLStrategy.generateSql — window rendering (#3650)', () => {
  it('renders the window as a parameterised half-open pair', async () => {
    const seen: AggOpts[] = [];
    const svc = makeService(seen);

    const { sql, params } = await svc.generateSql!({
      cube: 'sales',
      dimensions: ['close_date'],
      measures: ['revenue'],
      timeDimensions: [
        { dimension: 'close_date', granularity: 'month', dateRange: ['2026-01-01', '2026-02-28'] },
      ],
    });

    // The preview used to omit the window deliberately, because `execute()`
    // dropped it. Now that the window applies, omitting it would be the lie in
    // the other direction — and since #3777 the render is half-open, because
    // that is what execute()'s driver actually runs for a bare-day `$lte` on a
    // datetime column; a BETWEEN would hand a debugger SQL that drops the
    // final day's rows.
    expect(sql).toContain('(close_date >= $1 AND close_date < $2)');
    expect(sql).toContain("date_trunc('month', close_date)");
    // Bounds bind as parameters — the echoed string travels to the browser.
    expect(params).toEqual(['2026-01-01', '2026-03-01']);
    expect(sql).not.toContain('2026-01-01');
  });

  it('numbers window placeholders after the caller\'s own filters', async () => {
    const seen: AggOpts[] = [];
    const svc = makeService(seen);

    const { sql, params } = await svc.generateSql!({
      cube: 'sales',
      dimensions: ['stage'],
      measures: ['revenue'],
      where: { stage: 'won' },
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
    });

    expect(sql).toContain('(close_date >= $2 AND close_date < $3)');
    expect(params).toEqual(['won', '2026-01-01', '2026-02-01']);
  });
});

describe('ObjectQLStrategy — cross-object FK-expand carries the window (#3650 × #3654)', () => {
  const crossDataset = DatasetSchema.parse({
    name: 'sales_by_account',
    label: 'Sales by account',
    object: 'opportunity',
    include: ['account'],
    dimensions: [
      { name: 'region', field: 'account.region', type: 'string' },
      { name: 'close_date', field: 'close_date', type: 'date' },
    ],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
  });

  it('scopes the BASE aggregate of an FK-expand to the window', async () => {
    const calls: Array<{ object: string; filter?: unknown }> = [];
    const compiled = compileDataset(crossDataset);
    const svc = new AnalyticsService({
      cubes: [compiled.cube],
      queryCapabilities: objectqlOnly,
      getAllowedRelationships: () => compiled.allowedRelationships,
      executeAggregate: async (object, opts) => {
        calls.push({ object, filter: opts.filter });
        return object === 'opportunity'
          ? [{ account: 'acc_w', revenue: 100 }]
          : [{ id: 'acc_w', region: 'West' }];
      },
    });

    const result = await svc.query(
      {
        cube: 'sales_by_account',
        dimensions: ['region'],
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
      },
      ctx,
    );

    const base = calls.find((c) => c.object === 'opportunity')!;
    expect(base.filter).toEqual({ close_date: { $gte: '2026-01-01', $lte: '2026-01-31' } });
    // The FK→attribute resolution is keyed by id and must NOT inherit the
    // window — a related record has no `close_date`.
    const ref = calls.find((c) => c.object === 'account')!;
    expect(ref.filter).toEqual({ id: { $in: ['acc_w'] } });
    expect(result.rows).toEqual([{ region: 'West', revenue: 100 }]);
  });

  it('rejects a window on a CROSS-OBJECT time dimension as a bucketing error', async () => {
    const crossTime = DatasetSchema.parse({
      name: 'sales_by_acct_date',
      label: 'Sales by account date',
      object: 'opportunity',
      include: ['account'],
      dimensions: [
        { name: 'region', field: 'account.region', type: 'string' },
        { name: 'acct_created', field: 'account.created_at', type: 'date' },
      ],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
    });
    const compiled = compileDataset(crossTime);
    const svc = new AnalyticsService({
      cubes: [compiled.cube],
      queryCapabilities: objectqlOnly,
      getAllowedRelationships: () => compiled.allowedRelationships,
      executeAggregate: async () => [],
    });

    const query = {
      cube: 'sales_by_acct_date',
      dimensions: ['region'],
      measures: ['revenue'],
      timeDimensions: [{ dimension: 'acct_created', dateRange: ['2026-01-01', '2026-01-31'] }],
    };
    // Reported as a time-dimension bucketing error, not as the "cross-object
    // filter" its lowered predicate would otherwise look like.
    await expect(svc.query(query, ctx)).rejects.toThrow(
      /cannot bucket a cross-object time dimension/,
    );
    // `/analytics/sql` rejects the same query, the same way.
    await expect(svc.generateSql!(query)).rejects.toThrow(
      /cannot bucket a cross-object time dimension/,
    );
  });
});
