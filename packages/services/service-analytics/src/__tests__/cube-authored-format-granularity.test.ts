// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `analytics_cube.measures.format` and `analytics_cube.dimensions.granularities`
 * — an AUTHORED cube reaches the readers a compiled dataset already reaches.
 *
 * One Cube shape has three producers (`cube-registry.ts` names them): authored
 * cubes (`defineCube()` / `defineStack({ analyticsCubes })`, threaded into
 * `AnalyticsServiceConfig.cubes`), compiled datasets, and ad-hoc inference.
 * Both keys were read on the compiled-dataset path only:
 *
 * - a dataset measure's `format` reached `fields[].format` through
 *   `enrichResultColumns`, which reads the DATASET — an authored cube has none,
 *   so `POST /analytics/query` described its measure columns with `name` and
 *   `type` alone and the authored `format` reached nobody;
 * - a single-entry `granularities` list was the default bucket
 *   `DatasetExecutor.buildQuery` filled into the query it hands `query()` —
 *   an authored cube never becomes a `CompiledDataset`, so grouping by its time
 *   dimension grouped raw timestamps, one group per distinct instant.
 *
 * What this file pins, each against a dataset CONTROL that shows the authored
 * cube now behaves as the compiled one always did:
 *
 * - `format` lands on the measure column on both strategies, under both member
 *   spellings, and on nothing else;
 * - the declared single granularity is the default bucket on `query()` and on
 *   the `generateSql()` dry run; a stated granularity wins, one outside the
 *   list is not refused, a multi-entry list states no default, and a
 *   window-only `timeDimensions` entry stays a filter — the same five answers
 *   the dataset path gives;
 * - the declared narrowing: a bucketed query is served by the engine path,
 *   which refuses every member it cannot evaluate — on a cube with `joins`, a
 *   cross-object member (`planCrossObject`) — so grouping such a query by a
 *   declared-default dimension is now refused, with the envelope, byte for
 *   byte, that stating the same granularity by hand already got. Pinned on a
 *   cross-object measure on a joined cube. (A custom-SQL measure was the
 *   second refusal source until its metric types were retired, #21000: both
 *   paths now refuse it by type whatever the route, which its case pins.)
 */

import { describe, it, expect, vi } from 'vitest';
import { CubeSchema, type Cube } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

/** Parsed the way `defineCube()` and `defineStack({ analyticsCubes })` parse an authored cube. */
const authored: Cube = CubeSchema.parse({
  name: 'orders',
  sql: 'shop_order',
  measures: {
    count: { label: 'Orders', type: 'count', sql: '*' },
    revenue: { label: 'Revenue', type: 'sum', sql: 'amount', format: '$0,0.00' },
    margin: { label: 'Margin', type: 'avg', sql: 'margin', format: '0.0%' },
  },
  dimensions: {
    status: { label: 'Status', type: 'string', sql: 'status' },
    placed_at: { label: 'Placed', type: 'time', sql: 'placed_at', granularities: ['month'] },
    shipped_at: { label: 'Shipped', type: 'time', sql: 'shipped_at', granularities: ['month', 'year'] },
    created_at: { label: 'Created', type: 'time', sql: 'created_at' },
  },
});

/** The dataset twin of `authored`: the same object, measures and default bucket. */
const dataset = DatasetSchema.parse({
  name: 'order_metrics',
  label: 'Orders',
  object: 'shop_order',
  include: [],
  dimensions: [
    { name: 'status', field: 'status', type: 'string' },
    { name: 'placed_at', field: 'placed_at', type: 'date', dateGranularity: 'month' },
  ],
  measures: [
    { name: 'count', aggregate: 'count' },
    { name: 'revenue', aggregate: 'sum', field: 'amount', format: '$0,0.00' },
  ],
});

type GroupByItem = string | { field: string; dateGranularity?: string };

/** An ObjectQL-only host that records the `groupBy` every aggregate ran with. */
function objectqlService(cubes: Cube[] = [authored]) {
  const groupBys: GroupByItem[][] = [];
  const service = new AnalyticsService({
    logger: silentLogger,
    cubes,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object, options) => {
      groupBys.push((options.groupBy ?? []) as GroupByItem[]);
      return [{ status: 'open', count: 2, revenue: 10, margin: 0.25, placed_at: '2026-07' }];
    },
  });
  return { service, groupBys };
}

/** A raw-SQL-only host that records the statements it ran. */
function nativeService(cubes: Cube[] = [authored]) {
  const sqls: string[] = [];
  const service = new AnalyticsService({
    logger: silentLogger,
    cubes,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_object, sql) => {
      sqls.push(sql);
      return [{ status: 'open', count: 2, revenue: 10, margin: 0.25 }];
    },
  });
  return { service, sqls };
}

const formatOf = (fields: Array<{ name: string; format?: string }>, name: string) =>
  fields.find((f) => f.name === name)?.format;

describe('analytics_cube.measures.format — reaches `fields[].format` on `query()`', () => {
  for (const [profile, make] of [
    ['ObjectQL', () => objectqlService().service],
    ['native SQL', () => nativeService().service],
  ] as const) {
    it(`${profile}: each measure column carries the format its cube measure declares`, async () => {
      const result = await make().query({
        cube: 'orders',
        measures: ['orders.revenue', 'margin', 'orders.count'],
        dimensions: ['orders.status'],
      });

      expect(formatOf(result.fields, 'orders.revenue')).toBe('$0,0.00');
      expect(formatOf(result.fields, 'margin')).toBe('0.0%');
      // A measure that declares no format gets no key at all — this describes,
      // it never invents a format.
      expect(result.fields.find((f) => f.name === 'orders.count')).not.toHaveProperty('format');
      // A dimension column is not a measure column.
      expect(result.fields.find((f) => f.name === 'orders.status')).not.toHaveProperty('format');
    });
  }

  it('dataset CONTROL: the compiled path answers the same measure with the same format', async () => {
    const { service } = objectqlService();

    const viaDataset = await service.queryDataset(dataset as any, { measures: ['revenue'], dimensions: ['status'] });
    const viaCube = await service.query({ cube: 'orders', measures: ['revenue'], dimensions: ['status'] });

    expect(formatOf(viaDataset.fields, 'revenue')).toBe('$0,0.00');
    expect(formatOf(viaCube.fields, 'revenue')).toBe(formatOf(viaDataset.fields, 'revenue'));
  });

  it('a suffix-inferred measure on an authored cube declares nothing, so it carries no format', async () => {
    const { service } = objectqlService();

    const result = await service.query({ cube: 'orders', measures: ['amount_sum', 'revenue'] });

    expect(result.fields.find((f) => f.name === 'amount_sum')).not.toHaveProperty('format');
    expect(formatOf(result.fields, 'revenue')).toBe('$0,0.00');
  });
});

describe('analytics_cube.dimensions.granularities — the declared single granularity is the default bucket', () => {
  it('`query()` buckets a grouped time dimension at its declared granularity', async () => {
    const { service, groupBys } = objectqlService();

    const result = await service.query({ cube: 'orders', measures: ['count'], dimensions: ['orders.placed_at'] });

    expect(groupBys).toEqual([[{ field: 'placed_at', dateGranularity: 'month' }]]);
    // One column for the bucket, not a second one for the filled entry.
    expect(result.fields.filter((f) => f.name === 'orders.placed_at')).toHaveLength(1);
  });

  it('dataset CONTROL: the compiled dataset groups the same dimension with the same bucket', async () => {
    const { service, groupBys } = objectqlService();

    await service.queryDataset(dataset as any, { measures: ['count'], dimensions: ['placed_at'] });
    await service.query({ cube: 'orders', measures: ['count'], dimensions: ['placed_at'] });

    expect(groupBys).toHaveLength(2);
    expect(groupBys[1]).toEqual(groupBys[0]);
    expect(groupBys[0]).toEqual([{ field: 'placed_at', dateGranularity: 'month' }]);
  });

  it('fills an unstated `timeDimensions` entry for a GROUPED dimension', async () => {
    const { service, groupBys } = objectqlService();

    await service.query({
      cube: 'orders',
      measures: ['count'],
      dimensions: ['placed_at'],
      timeDimensions: [{ dimension: 'placed_at', dateRange: ['2026-01-01', '2026-12-31'] }],
    });

    expect(groupBys).toEqual([[{ field: 'placed_at', dateGranularity: 'month' }]]);
  });

  it('a stated granularity wins, and one outside the declared list is not refused (dataset parity)', async () => {
    const { service, groupBys } = objectqlService();

    await service.query({
      cube: 'orders',
      measures: ['count'],
      dimensions: ['placed_at'],
      timeDimensions: [{ dimension: 'placed_at', granularity: 'year' }],
    });
    await service.queryDataset(dataset as any, {
      measures: ['count'],
      dimensions: ['placed_at'],
      timeDimensions: [{ dimension: 'placed_at', granularity: 'year' }],
    });

    expect(groupBys).toEqual([
      [{ field: 'placed_at', dateGranularity: 'year' }],
      [{ field: 'placed_at', dateGranularity: 'year' }],
    ]);
  });

  it('a multi-entry list states no default, and an undeclared list none either — the raw column groups', async () => {
    const { service, groupBys } = objectqlService();

    await service.query({ cube: 'orders', measures: ['count'], dimensions: ['shipped_at'] });
    await service.query({ cube: 'orders', measures: ['count'], dimensions: ['created_at'] });

    expect(groupBys).toEqual([['shipped_at'], ['created_at']]);
  });

  it('a window-only `timeDimensions` entry stays a filter — not grouped, not bucketed', async () => {
    const { service, groupBys } = objectqlService();

    await service.query({
      cube: 'orders',
      measures: ['count'],
      timeDimensions: [{ dimension: 'placed_at', dateRange: ['2026-01-01', '2026-12-31'] }],
    });

    expect(groupBys).toEqual([[]]);
  });

  it('`generateSql()` dry-runs the bucketed statement `query()` runs', async () => {
    const { service } = objectqlService();

    const declared = await service.generateSql({ cube: 'orders', measures: ['count'], dimensions: ['placed_at'] });
    const undeclared = await service.generateSql({ cube: 'orders', measures: ['count'], dimensions: ['created_at'] });

    expect(declared.sql).toMatch(/date_trunc\('month'/i);
    expect(undeclared.sql).not.toMatch(/date_trunc/i);
  });

  it('native SQL declines a bucketed query, so a declared default routes to the engine path as a dataset does', async () => {
    const both = { nativeSql: true, objectqlAggregate: true, inMemory: false };
    const sqls: string[] = [];
    const groupBys: GroupByItem[][] = [];
    const service = new AnalyticsService({
      logger: silentLogger,
      cubes: [authored],
      queryCapabilities: () => both,
      executeRawSql: async (_o, sql) => {
        sqls.push(sql);
        return [];
      },
      executeAggregate: async (_o, options) => {
        groupBys.push((options.groupBy ?? []) as GroupByItem[]);
        return [];
      },
    });

    await service.query({ cube: 'orders', measures: ['count'], dimensions: ['placed_at'] });
    await service.query({ cube: 'orders', measures: ['count'], dimensions: ['created_at'] });

    expect(groupBys).toEqual([[{ field: 'placed_at', dateGranularity: 'month' }]]);
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toMatch(/created_at/);
  });

  it('a retired custom-SQL metric type is refused whatever the route — by default bucket, by a stated granularity, and on the raw-SQL path', async () => {
    // NOT parsed: `CubeSchema` refuses this member at every authoring door —
    // its `sql` since #20943, its `type` since #21000. The refusal pinned here
    // is still owed to a cube that reaches the service without meeting that
    // parse (a host registering one in-process), so the member is built
    // directly on the parsed cube. Before #21000 the engine path refused it and
    // the raw-SQL path served it, so the route a declared default chose decided
    // the answer; now both refuse it by type, before anything executes.
    // `as unknown as Cube`: `tsc` refuses the retired type at a typed cube too.
    const withExpression = {
      ...authored,
      measures: {
        ...authored.measures,
        done_rate: { label: 'Done', type: 'number', sql: "SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) * 1.0 / COUNT(*)" },
      },
    } as unknown as Cube;
    expect(CubeSchema.safeParse(withExpression).success).toBe(false);
    const aggregated: string[] = [];
    const sqls: string[] = [];
    const service = new AnalyticsService({
      logger: silentLogger,
      cubes: [withExpression],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async (_o, sql) => {
        sqls.push(sql);
        return [];
      },
      executeAggregate: async (object) => {
        aggregated.push(object);
        return [];
      },
    });
    const refusal = (e: any) => ({ code: e?.code, status: e?.status, message: (e as Error)?.message });

    const byDefault = await service
      .query({ cube: 'orders', measures: ['done_rate'], dimensions: ['placed_at'] })
      .catch((e: unknown) => e);
    const byHand = await service
      .query({
        cube: 'orders',
        measures: ['done_rate'],
        dimensions: ['placed_at'],
        timeDimensions: [{ dimension: 'placed_at', granularity: 'month' }],
      })
      .catch((e: unknown) => e);
    // The control that used to be SERVED on the raw-SQL path: a dimension that
    // declares no single default keeps the query there.
    const rawSqlRoute = await service
      .query({ cube: 'orders', measures: ['done_rate'], dimensions: ['shipped_at'] })
      .catch((e: unknown) => e);

    expect(byDefault).toBeInstanceOf(Error);
    expect(refusal(byDefault).message).toContain('measure "done_rate" on cube "orders" cannot be served: its type "number"');
    // One refusal, whichever route the query took.
    expect(refusal(byDefault)).toEqual(refusal(byHand));
    expect(refusal(byDefault)).toEqual(refusal(rawSqlRoute));
    // The undeclared-500 tier, never the caller-blaming 400.
    expect(refusal(byDefault).code).toBeUndefined();
    expect(aggregated).toEqual([]);
    expect(sqls).toEqual([]);
  });

  it('DECLARED NARROWING, joined cube: a cross-object measure grouped by a declared-default dimension gets the refusal a stated granularity gets', async () => {
    // The engine path's other refusals are reached by the same re-route: on a
    // cube that declares `joins`, a member resolving through one (here a
    // measure over `account.balance`) is refused by
    // `ObjectQLStrategy.planCrossObject`, where the raw-SQL path joins it.
    const joined: Cube = CubeSchema.parse({
      ...authored,
      measures: {
        ...authored.measures,
        account_balance: { label: 'Account balance', type: 'sum', sql: 'account.balance' },
      },
      joins: { account: { name: 'crm_account' } },
    });
    const aggregated: string[] = [];
    const sqls: string[] = [];
    const service = new AnalyticsService({
      logger: silentLogger,
      cubes: [joined],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async (_o, sql) => {
        sqls.push(sql);
        return [];
      },
      executeAggregate: async (object) => {
        aggregated.push(object);
        return [];
      },
    });
    const envelope = (e: any) => ({
      code: e?.code,
      status: e?.status,
      message: e?.message,
      member: e?.member,
      param: e?.param,
      cube: e?.cube,
      keys: e instanceof Error ? Object.keys(e).sort() : undefined,
    });

    const byDefault = await service
      .query({ cube: 'orders', measures: ['account_balance'], dimensions: ['placed_at'] })
      .catch((e: unknown) => e);
    const byHand = await service
      .query({
        cube: 'orders',
        measures: ['account_balance'],
        dimensions: ['placed_at'],
        timeDimensions: [{ dimension: 'placed_at', granularity: 'month' }],
      })
      .catch((e: unknown) => e);

    expect({ code: envelope(byDefault).code, status: envelope(byDefault).status }).toEqual({
      code: 'INVALID_FIELD',
      status: 400,
    });
    // Not a new refusal: byte-equal to the one stating the granularity by hand already got.
    expect(envelope(byDefault)).toEqual(envelope(byHand));
    expect(aggregated).toEqual([]);
    expect(sqls).toEqual([]);

    // Control: the same cross-object measure grouped by a dimension that
    // declares no single default is still answered, joined, on the raw-SQL path.
    await service.query({ cube: 'orders', measures: ['account_balance'], dimensions: ['shipped_at'] });
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toMatch(/JOIN/);
  });
});
