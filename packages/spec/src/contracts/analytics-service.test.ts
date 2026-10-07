import { describe, it, expect } from 'vitest';
import type { IAnalyticsService, AnalyticsResult, CubeMeta } from './analytics-service';

describe('Analytics Service Contract', () => {
  it('should allow a minimal IAnalyticsService implementation with required methods', () => {
    const service: IAnalyticsService = {
      query: async (_query) => ({ rows: [], fields: [] }),
      getMeta: async () => [],
    };

    expect(typeof service.query).toBe('function');
    expect(typeof service.getMeta).toBe('function');
  });

  it('should allow a full implementation with optional methods', () => {
    const service: IAnalyticsService = {
      query: async () => ({ rows: [], fields: [] }),
      getMeta: async () => [],
      generateSql: async () => ({ sql: 'SELECT 1', params: [] }),
    };

    expect(service.generateSql).toBeDefined();
  });

  it('should execute an analytics query', async () => {
    const service: IAnalyticsService = {
      query: async (query): Promise<AnalyticsResult> => ({
        rows: [
          { 'orders.status': 'active', 'orders.count': 42 },
          { 'orders.status': 'closed', 'orders.count': 18 },
        ],
        fields: [
          { name: 'orders.status', type: 'string' },
          { name: 'orders.count', type: 'number' },
        ],
      }),
      getMeta: async () => [],
    };

    const result = await service.query({
      cube: 'orders',
      measures: ['orders.count'],
      dimensions: ['orders.status'],
    });

    expect(result.rows).toHaveLength(2);
    expect(result.fields).toHaveLength(2);
    expect(result.rows[0]['orders.count']).toBe(42);
  });

  it('should return cube metadata', async () => {
    const cubes: CubeMeta[] = [{
      name: 'orders',
      title: 'Orders',
      measures: [{ name: 'orders.count', type: 'count' }],
      dimensions: [{ name: 'orders.status', type: 'string' }],
    }];

    const service: IAnalyticsService = {
      query: async () => ({ rows: [], fields: [] }),
      getMeta: async (cubeName?) => {
        if (cubeName) return cubes.filter(c => c.name === cubeName);
        return cubes;
      },
    };

    const meta = await service.getMeta();
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe('orders');
    expect(meta[0].measures).toHaveLength(1);
  });

  // #14492 — `fields[].builtinAggregate` is optional and is the closed
  // `AggregationFunction` vocabulary, nothing else. The first two literals are
  // the two shapes the producer emits (built-in default vs authored label); the
  // third pins the closure at compile time.
  it('carries builtinAggregate on a built-in default measure column and refuses a spelling outside the enum', () => {
    const builtin: AnalyticsResult['fields'][number] = { name: 'count', type: 'number', builtinAggregate: 'count' };
    const authored: AnalyticsResult['fields'][number] = { name: 'task_count', type: 'number', label: 'Tasks' };
    expect(builtin.builtinAggregate).toBe('count');
    expect(authored.builtinAggregate).toBeUndefined();
    const offEnum: AnalyticsResult['fields'][number] = {
      name: 'count',
      type: 'number',
      // @ts-expect-error — `total` is not an AggregationFunction; the discriminator is closed
      builtinAggregate: 'total',
    };
    expect(offEnum.name).toBe('count');
  });

  // `fields[].aggregate` is optional and is the closed `AggregationFunction`
  // vocabulary. Unlike `builtinAggregate` it rides beside an authored label:
  // the first literal is the labelled `count` column the producer now emits;
  // the second pins the closure at compile time.
  it('carries aggregate on a labelled measure column and refuses a spelling outside the enum', () => {
    const labelled: AnalyticsResult['fields'][number] = { name: 'task_count', type: 'number', label: 'Tasks', aggregate: 'count' };
    expect(labelled.aggregate).toBe('count');
    expect(labelled.builtinAggregate).toBeUndefined();
    const offEnum: AnalyticsResult['fields'][number] = {
      name: 'task_count',
      type: 'number',
      // @ts-expect-error — `total` is not an AggregationFunction; the member is closed
      aggregate: 'total',
    };
    expect(offEnum.name).toBe('task_count');
  });

  // `object` — the dataset's base object, declared on the answer itself and not
  // on a drill-through side type: a `queryDataset` implementation returns it on
  // a dimension-less, zero-row answer against the plain `AnalyticsResult`, and
  // the member is a string (a non-string is refused at compile time).
  it('carries the dataset base object as `object` on a dimension-less, zero-row dataset answer', async () => {
    const service: IAnalyticsService = {
      query: async () => ({ rows: [], fields: [] }),
      getMeta: async () => [],
      queryDataset: async (dataset) => ({ rows: [], fields: [{ name: 'count', type: 'number' }], object: dataset.object }),
    };

    const answer = await service.queryDataset!(
      { name: 'projects', label: 'Projects', object: 'project', dimensions: [], measures: [{ name: 'count', aggregate: 'count' }] },
      { measures: ['count'] },
    );
    expect(answer.object).toBe('project');
    expect(answer.rows).toEqual([]);

    const offType: AnalyticsResult = {
      rows: [],
      fields: [],
      // @ts-expect-error — `object` is the base object's machine name, a string
      object: 42,
    };
    expect(offType.rows).toEqual([]);
  });

  // The four drill-through sidecars (ADR-0021 D2), declared on the answer
  // itself: a `queryDataset` implementation returns them against the plain
  // `AnalyticsResult`, and a caller reads each one without a cast (a read of an
  // undeclared member is a compile error, so these reads are the existence pin).
  // The `@ts-expect-error` lines pin each member's TYPE.
  it('carries the drill-through sidecars on a drillable dataset answer', async () => {
    const service: IAnalyticsService = {
      query: async () => ({ rows: [], fields: [] }),
      getMeta: async () => [],
      queryDataset: async (dataset) => ({
        rows: [{ account: 'Acme', close_date: '2026-Q2', revenue: 100 }],
        fields: [{ name: 'revenue', type: 'number' }],
        totals: [{ dimensions: [], rows: [{ revenue: 100 }] }],
        object: dataset.object,
        dimensionFields: { account: 'account' },
        drillRawRows: [{ account: 'acc_1' }],
        drillRawTotals: [[{}]],
        drillRanges: [{ close_date: { field: 'close_date', gte: '2026-04-01', lt: '2026-07-01' } }],
      }),
    };

    const answer = await service.queryDataset!(
      { name: 'pipeline', label: 'Pipeline', object: 'opportunity', dimensions: [], measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }] },
      { measures: ['revenue'], dimensions: ['account', 'close_date'] },
    );
    const field: string | undefined = answer.dimensionFields?.account;
    expect(field).toBe('account');
    expect(answer.drillRawRows?.[0]).toEqual({ account: 'acc_1' });
    expect(answer.drillRawTotals?.[0]?.[0]).toEqual({});
    const range: { field: string; gte: string; lt: string } | undefined = answer.drillRanges?.[0]?.close_date;
    expect(range).toEqual({ field: 'close_date', gte: '2026-04-01', lt: '2026-07-01' });

    const offType: AnalyticsResult[] = [
      // @ts-expect-error — `dimensionFields` maps a dimension name to a field NAME, a string
      { rows: [], fields: [], dimensionFields: { account: 42 } },
      // @ts-expect-error — `drillRawRows` is an array aligned to `rows`, not one map
      { rows: [], fields: [], drillRawRows: { account: 'acc_1' } },
      // @ts-expect-error — `drillRawTotals` is one array of maps PER totals grouping
      { rows: [], fields: [], drillRawTotals: [{ account: 'acc_1' }] },
      // @ts-expect-error — a `drillRanges` entry carries both bounds
      { rows: [], fields: [], drillRanges: [{ close_date: { field: 'close_date', gte: '2026-04-01' } }] },
    ];
    expect(offType).toHaveLength(4);
  });

  it('should generate SQL without executing', async () => {
    const service: IAnalyticsService = {
      query: async () => ({ rows: [], fields: [] }),
      getMeta: async () => [],
      generateSql: async (query) => ({
        sql: `SELECT COUNT(*) FROM ${query.cube}`,
        params: [],
      }),
    };

    const result = await service.generateSql!({
      cube: 'orders',
      measures: ['orders.count'],
    });

    expect(result.sql).toContain('orders');
    expect(result.params).toEqual([]);
  });
});
