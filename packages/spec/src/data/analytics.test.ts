import { describe, it, expect } from 'vitest';
import {
  AggregationMetricType,
  DimensionType,
  TimeUpdateInterval,
  MetricSchema,
  DimensionSchema,
  CubeJoinSchema,
  CubeSchema,
  AnalyticsQuerySchema,
} from './analytics.zod';

describe('AggregationMetricType', () => {
  it('should accept all valid metric types', () => {
    const types = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct', 'number', 'string', 'boolean'];
    for (const t of types) {
      expect(() => AggregationMetricType.parse(t)).not.toThrow();
    }
  });

  it('should reject invalid metric type', () => {
    expect(() => AggregationMetricType.parse('median')).toThrow();
    expect(() => AggregationMetricType.parse('')).toThrow();
  });
});

describe('DimensionType', () => {
  it('should accept all valid dimension types', () => {
    const types = ['string', 'number', 'boolean', 'time', 'geo'];
    for (const t of types) {
      expect(() => DimensionType.parse(t)).not.toThrow();
    }
  });

  it('should reject invalid dimension type', () => {
    expect(() => DimensionType.parse('date')).toThrow();
    expect(() => DimensionType.parse('array')).toThrow();
  });
});

describe('TimeUpdateInterval', () => {
  it('should accept all valid intervals', () => {
    const intervals = ['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];
    for (const i of intervals) {
      expect(() => TimeUpdateInterval.parse(i)).not.toThrow();
    }
  });

  it('should reject invalid interval', () => {
    expect(() => TimeUpdateInterval.parse('millisecond')).toThrow();
    expect(() => TimeUpdateInterval.parse('decade')).toThrow();
  });
});

describe('MetricSchema', () => {
  it('should accept valid minimal metric', () => {
    const metric = MetricSchema.parse({
      name: 'total_revenue',
      label: 'Total Revenue',
      type: 'sum',
      sql: 'amount',
    });

    expect(metric.name).toBe('total_revenue');
    expect(metric.type).toBe('sum');
  });

  it('should accept metric with all fields', () => {
    const metric = MetricSchema.parse({
      name: 'avg_order_value',
      label: 'Average Order Value',
      description: 'Average revenue per order',
      type: 'avg',
      sql: 'order_total',
      format: 'currency',
    });

    expect(metric.description).toBe('Average revenue per order');
    expect(metric.format).toBe('currency');
  });

  // #10414 (ADR-0049 enforce-or-remove): `filters` REMOVED. It was a declared
  // per-metric raw-SQL filter no strategy ever read — an authored
  // `filters: [{ sql }]` parsed, registered, and silently returned the
  // UNFILTERED aggregate (this file used to pin exactly that parse survival,
  // `expect(metric.filters).toHaveLength(1)`). The pin flips: the refusal must
  // carry the prescription — the fully-qualified key, the removal, and the
  // migration channel — not merely throw.
  it('rejects the removed `filters` key with the retirement prescription (#10414)', () => {
    expect(() => MetricSchema.parse({
      name: 'avg_order_value',
      label: 'Average Order Value',
      type: 'avg',
      sql: 'order_total',
      filters: [{ sql: "status = 'completed'" }],
    })).toThrow(/`measures\.<metric>\.filters`.*removed in @objectstack\/spec 17 \(#10414.*os migrate meta --from 17/s);
  });

  it('should apply defaults for optional fields', () => {
    const metric = MetricSchema.parse({
      name: 'count_users',
      label: 'User Count',
      type: 'count',
      sql: 'id',
    });

    expect(metric.description).toBeUndefined();
    expect(metric.format).toBeUndefined();
  });

  it('should reject metric with invalid snake_case name', () => {
    expect(() => MetricSchema.parse({
      name: 'TotalRevenue',
      label: 'Total Revenue',
      type: 'sum',
      sql: 'amount',
    })).toThrow();

    expect(() => MetricSchema.parse({
      name: 'total-revenue',
      label: 'Total Revenue',
      type: 'sum',
      sql: 'amount',
    })).toThrow();
  });

  it('should reject metric without required fields', () => {
    expect(() => MetricSchema.parse({
      name: 'revenue',
      label: 'Revenue',
      type: 'sum',
    })).toThrow();

    expect(() => MetricSchema.parse({
      name: 'revenue',
      type: 'sum',
      sql: 'amount',
    })).toThrow();
  });
});

describe('DimensionSchema', () => {
  it('should accept valid minimal dimension', () => {
    const dim = DimensionSchema.parse({
      name: 'product_category',
      label: 'Product Category',
      type: 'string',
      sql: 'category',
    });

    expect(dim.name).toBe('product_category');
    expect(dim.type).toBe('string');
  });

  it('should accept time dimension with granularities', () => {
    const dim = DimensionSchema.parse({
      name: 'created_at',
      label: 'Created At',
      type: 'time',
      sql: 'created_at',
      granularities: ['day', 'week', 'month', 'year'],
    });

    expect(dim.granularities).toHaveLength(4);
    expect(dim.granularities).toContain('day');
  });

  it('should accept dimension with all fields', () => {
    const dim = DimensionSchema.parse({
      name: 'region',
      label: 'Region',
      description: 'Geographic region',
      type: 'geo',
      sql: 'region_name',
      granularities: ['month'],
    });

    expect(dim.description).toBe('Geographic region');
  });

  it('should reject dimension with invalid name', () => {
    expect(() => DimensionSchema.parse({
      name: 'ProductCategory',
      label: 'Product Category',
      type: 'string',
      sql: 'category',
    })).toThrow();
  });

  it('should reject dimension without required fields', () => {
    expect(() => DimensionSchema.parse({
      name: 'category',
      label: 'Category',
      sql: 'category',
    })).toThrow();
  });
});

describe('CubeJoinSchema', () => {
  it('should accept valid join with default relationship', () => {
    const join = CubeJoinSchema.parse({
      name: 'orders',
      sql: '{CUBE}.user_id = {orders}.user_id',
    });

    expect(join.name).toBe('orders');
    expect(join.relationship).toBe('many_to_one');
  });

  it('should accept join with explicit relationship', () => {
    const join = CubeJoinSchema.parse({
      name: 'line_items',
      relationship: 'one_to_many',
      sql: '{CUBE}.id = {line_items}.order_id',
    });

    expect(join.relationship).toBe('one_to_many');
  });

  it('should accept all valid relationships', () => {
    for (const rel of ['one_to_one', 'one_to_many', 'many_to_one']) {
      expect(() => CubeJoinSchema.parse({
        name: 'target',
        relationship: rel,
        sql: '{CUBE}.id = {target}.id',
      })).not.toThrow();
    }
  });

  it('should reject join with invalid relationship', () => {
    expect(() => CubeJoinSchema.parse({
      name: 'target',
      relationship: 'many_to_many',
      sql: '{CUBE}.id = {target}.id',
    })).toThrow();
  });

  it('should reject join without required fields', () => {
    expect(() => CubeJoinSchema.parse({
      name: 'orders',
    })).toThrow();

    expect(() => CubeJoinSchema.parse({
      sql: '{CUBE}.id = {orders}.id',
    })).toThrow();
  });
});

describe('CubeSchema', () => {
  const validCube = {
    name: 'orders',
    sql: 'SELECT * FROM orders',
    measures: {
      count: {
        name: 'count',
        label: 'Order Count',
        type: 'count',
        sql: 'id',
      },
    },
    dimensions: {
      status: {
        name: 'status',
        label: 'Status',
        type: 'string',
        sql: 'status',
      },
    },
  };

  it('should accept valid minimal cube', () => {
    const cube = CubeSchema.parse(validCube);

    expect(cube.name).toBe('orders');
    expect(cube.public).toBe(false);
  });

  it('should accept cube with all fields', () => {
    const cube = CubeSchema.parse({
      ...validCube,
      title: 'Orders Cube',
      description: 'Cube for order analytics',
      joins: {
        users: {
          name: 'users',
          relationship: 'many_to_one',
          sql: '{CUBE}.user_id = {users}.id',
        },
      },
      refreshKey: {
        every: '1 hour',
        sql: 'SELECT MAX(updated_at) FROM orders',
      },
      public: true,
    });

    expect(cube.title).toBe('Orders Cube');
    expect(cube.joins).toBeDefined();
    expect(cube.refreshKey?.every).toBe('1 hour');
    expect(cube.public).toBe(true);
  });

  it('should apply defaults', () => {
    const cube = CubeSchema.parse(validCube);

    expect(cube.public).toBe(false);
    expect(cube.title).toBeUndefined();
    expect(cube.joins).toBeUndefined();
    expect(cube.refreshKey).toBeUndefined();
  });

  it('should reject cube with invalid name', () => {
    expect(() => CubeSchema.parse({
      ...validCube,
      name: 'InvalidName',
    })).toThrow();
  });

  it('should reject cube without required fields', () => {
    expect(() => CubeSchema.parse({
      name: 'orders',
      sql: 'SELECT * FROM orders',
      measures: {},
    })).toThrow();

    expect(() => CubeSchema.parse({
      name: 'orders',
      sql: 'SELECT * FROM orders',
      dimensions: {},
    })).toThrow();
  });
});

describe('AnalyticsQuerySchema', () => {
  it('should accept valid minimal query', () => {
    const query = AnalyticsQuerySchema.parse({
      measures: ['orders.count'],
    });

    expect(query.measures).toEqual(['orders.count']);
    // [#4538] No `timezone` default: absence is meaningful (the engine
    // resolves org timezone -- #1982/#2018), so the parse must preserve it.
    expect(query.timezone).toBeUndefined();
  });

  it('should accept query with all fields', () => {
    const query = AnalyticsQuerySchema.parse({
      measures: ['orders.count', 'orders.total_revenue'],
      dimensions: ['orders.status'],
      where: { 'orders.status': 'completed' },
      timeDimensions: [{
        dimension: 'orders.created_at',
        granularity: 'month',
        dateRange: 'Last 7 days',
      }],
      order: { 'orders.count': 'desc' },
      limit: 100,
      offset: 0,
      timezone: 'America/New_York',
    });

    expect(query.dimensions).toEqual(['orders.status']);
    expect(query.where).toEqual({ 'orders.status': 'completed' });
    expect(query.timeDimensions).toHaveLength(1);
    expect(query.limit).toBe(100);
    expect(query.timezone).toBe('America/New_York');
  });

  it('should accept query with date range array', () => {
    const query = AnalyticsQuerySchema.parse({
      measures: ['orders.count'],
      timeDimensions: [{
        dimension: 'orders.created_at',
        dateRange: ['2023-01-01', '2023-01-31'],
      }],
    });

    expect(query.timeDimensions![0].dateRange).toEqual(['2023-01-01', '2023-01-31']);
  });

  it('should accept all FilterCondition operators in `where`', () => {
    const operators: Array<[string, unknown]> = [
      ['$eq', 'a'], ['$ne', 'a'], ['$gt', 1], ['$gte', 1], ['$lt', 1], ['$lte', 1],
      ['$in', ['a', 'b']], ['$nin', ['a', 'b']], ['$contains', 'foo'],
    ];
    for (const [op, val] of operators) {
      expect(() => AnalyticsQuerySchema.parse({
        measures: ['m.count'],
        where: { 'm.dim': { [op]: val } },
      })).not.toThrow();
    }
  });

  it('should NOT default timezone -- absence means the engine resolves it (#4538)', () => {
    const query = AnalyticsQuerySchema.parse({
      measures: ['orders.count'],
    });

    expect(query.timezone).toBeUndefined();
    expect('timezone' in query).toBe(false);
  });

  it('should reject query without measures', () => {
    expect(() => AnalyticsQuerySchema.parse({})).toThrow();
  });

  it('should reject query with invalid timeDimension granularity', () => {
    expect(() => AnalyticsQuerySchema.parse({
      measures: ['orders.count'],
      timeDimensions: [{
        dimension: 'orders.created_at',
        granularity: 'millennium',
      }],
    })).toThrow();
  });
});
