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
