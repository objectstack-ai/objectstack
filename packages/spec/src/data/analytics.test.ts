import { describe, it, expect } from 'vitest';
import {
  AggregationMetricType,
  DimensionType,
  TimeUpdateInterval,
  RETIRED_SUB_DAY_INTERVALS,
  MetricSchema,
  DimensionSchema,
  CubeJoinSchema,
  CubeSchema,
  AnalyticsQuerySchema,
} from './analytics.zod';
import { DateGranularity } from './query.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';
import { applyConversions, collectConversionNotices } from '../conversions/apply';

describe('AggregationMetricType', () => {
  it('should accept all valid metric types', () => {
    const types = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'];
    for (const t of types) {
      expect(() => AggregationMetricType.parse(t)).not.toThrow();
    }
    // The custom-SQL-expression members were retired (#21000); their refusal
    // is pinned in `cube-metric-expression-types-retirement.test.ts`.
    expect([...AggregationMetricType.options]).toEqual(types);
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
    const intervals = ['day', 'week', 'month', 'quarter', 'year'];
    for (const i of intervals) {
      expect(() => TimeUpdateInterval.parse(i)).not.toThrow();
    }
  });

  it('should reject invalid interval', () => {
    expect(() => TimeUpdateInterval.parse('millisecond')).toThrow();
    expect(() => TimeUpdateInterval.parse('decade')).toThrow();
  });

  // [#17296] The members are NOT restated here — they are `DateGranularity`'s,
  // and this is the assertion that keeps the second copy from growing back.
  // Both halves matter: same members, same ORDER, because the order is what a
  // generated reference page and a refusal message both print.
  it('declares exactly DateGranularity, in its order — one vocabulary, not two', () => {
    expect(TimeUpdateInterval.options).toEqual(DateGranularity.options);
  });

  it('refuses each retired sub-day interval with the retirement prescription', () => {
    // COST DIRECTION. The cheap narrowing is the enum alone: delete three
    // members and let zod answer its stock "invalid option". That parses
    // identically and tells an upgrading author nothing, so what is pinned
    // here is the PRESCRIPTION, not the rejection — the retired name, the
    // replacement vocabulary, and the migrate line the ADR-0087 conversion
    // makes true. Dropping the error map to simplify this enum turns every
    // assertion below red while `.parse()` goes on throwing.
    for (const retired of RETIRED_SUB_DAY_INTERVALS) {
      const parsed = TimeUpdateInterval.safeParse(retired);
      expect(parsed.success, retired).toBe(false);
      if (parsed.success) continue;
      const [issue] = parsed.error.issues;
      expect(issue.message, retired).toContain(`'${retired}'`);
      expect(issue.message, retired).toContain('retired in protocol 18');
      expect(issue.message, retired).toContain('day, week, month, quarter, year');
      expect(issue.message, retired).toContain('os migrate meta --from 17');
    }
  });

  it('CONTROL — an interval that was NEVER declared gets the vocabulary, not the retirement', () => {
    // Without this cell the one above reads as "every rejection says
    // retired". The two populations are a different mistake with a different
    // next action, so a message that cannot tell them apart is the defect the
    // split exists to avoid: `fortnight` never existed and has no migration.
    const parsed = TimeUpdateInterval.safeParse('fortnight');
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const [issue] = parsed.error.issues;
    expect(issue.message).toContain('is not declared');
    expect(issue.message).not.toContain('os migrate meta');
  });

  it('the retired names are gone from the CUBE side too, not just the query side', () => {
    // `Dimension.granularities` is the authored, STORED half of this enum —
    // the reason the retirement needed an ADR-0087 conversion at all. Pinned
    // separately because the query key and the cube key are two sites and a
    // narrowing that reached only one of them would still parse a cube
    // offering a granularity no query may ask for.
    const dim = (granularities: string[]) => ({
      label: 'Created At', type: 'time', sql: 'created_at', granularities,
    });
    expect(DimensionSchema.safeParse(dim(['day', 'month'])).success).toBe(true);
    expect(DimensionSchema.safeParse(dim(['hour'])).success).toBe(false);
  });
});

describe('MetricSchema', () => {
  it('should accept valid minimal metric', () => {
    const metric = MetricSchema.parse({
      label: 'Total Revenue',
      type: 'sum',
      sql: 'amount',
    });

    expect(metric.type).toBe('sum');
    // The record key in `measures` is the metric's name; the parse output
    // carries no inner copy of it.
    expect(metric).not.toHaveProperty('name');
  });

  it('should accept metric with all fields', () => {
    const metric = MetricSchema.parse({
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
  it('rejects the removed `filters` key with the retirement prescription', () => {
    expect(() => MetricSchema.parse({
      label: 'Average Order Value',
      type: 'avg',
      sql: 'order_total',
      filters: [{ sql: "status = 'completed'" }],
    })).toThrow(/`measures\.<metric>\.filters`.*removed in @objectstack\/spec 17 \(.*os migrate meta --from 17/s);
  });

  // #20300 (ADR-0049 enforce-or-remove): the inner `name` REMOVED. This file
  // used to pin its snake_case regex ('should reject metric with invalid
  // snake_case name') — a check on a value nothing read, because the record key
  // was always the identity. The pin flips to the tombstone: EVERY value is
  // refused, the key-equal one included, and the refusal carries the
  // prescription. The full door-by-door pin lives in
  // `cube-member-inner-name-retirement.test.ts`.
  it('refuses the retired inner `name` with the prescription, whatever its value', () => {
    for (const name of ['total_revenue', 'TotalRevenue', '']) {
      expect(() => MetricSchema.parse({ name, label: 'Total Revenue', type: 'sum', sql: 'amount' }), name)
        .toThrow(/`measures\.<metric>\.name` was removed in @objectstack\/spec 17\.5\.0.*the record key is the metric's name.*os migrate meta --from 17/s);
    }
  });

  it('should apply defaults for optional fields', () => {
    const metric = MetricSchema.parse({
      label: 'User Count',
      type: 'count',
      sql: 'id',
    });

    expect(metric.description).toBeUndefined();
    expect(metric.format).toBeUndefined();
  });

  it('should reject metric without required fields', () => {
    // No inner `name` in either literal: with one, the tombstone alone would
    // refuse the parse and the missing field would never be what was measured.
    expect(() => MetricSchema.parse({
      label: 'Revenue',
      type: 'sum',
    })).toThrow();

    expect(() => MetricSchema.parse({
      type: 'sum',
      sql: 'amount',
    })).toThrow();

    // CONTROL: the same shape with every required field parses.
    expect(MetricSchema.safeParse({ label: 'Revenue', type: 'sum', sql: 'amount' }).success).toBe(true);
  });
});

describe('DimensionSchema', () => {
  it('should accept valid minimal dimension', () => {
    const dim = DimensionSchema.parse({
      label: 'Product Category',
      type: 'string',
      sql: 'category',
    });

    expect(dim.type).toBe('string');
    expect(dim).not.toHaveProperty('name');
  });

  it('should accept time dimension with granularities', () => {
    const dim = DimensionSchema.parse({
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
      label: 'Region',
      description: 'Geographic region',
      type: 'geo',
      sql: 'region_name',
      granularities: ['month'],
    });

    expect(dim.description).toBe('Geographic region');
  });

  // #20300 — the same flip as the metric's (see that block): the snake_case
  // check on the inner `name` pinned a value nothing read.
  it('refuses the retired inner `name` with the prescription, whatever its value', () => {
    for (const name of ['product_category', 'ProductCategory']) {
      expect(() => DimensionSchema.parse({ name, label: 'Product Category', type: 'string', sql: 'category' }), name)
        .toThrow(/`dimensions\.<dimension>\.name` was removed in @objectstack\/spec 17\.5\.0.*the record key is the dimension's name.*os migrate meta --from 17/s);
    }
  });

  it('should reject dimension without required fields', () => {
    expect(() => DimensionSchema.parse({
      label: 'Category',
      sql: 'category',
    })).toThrow();

    // CONTROL: the same shape with its `type` parses.
    expect(DimensionSchema.safeParse({ label: 'Category', type: 'string', sql: 'category' }).success).toBe(true);
  });
});

describe('CubeJoinSchema', () => {
  // #18612 (ADR-0049 enforce-or-remove, maintainer-ruled batch #154): `sql` and
  // `relationship` are REMOVED. `name` is the whole contract, and the ON clause
  // is derived from the declared relationship between the two cubes' objects.
  it('accepts a join that declares only the object it reaches', () => {
    const join = CubeJoinSchema.parse({ name: 'orders' });

    expect(join.name).toBe('orders');
    expect(join).not.toHaveProperty('relationship');
    expect(join).not.toHaveProperty('sql');
  });

  it('refuses an authored ON clause, and the refusal says the clause is DERIVED', () => {
    const r = CubeJoinSchema.safeParse({ name: 'orders', sql: '{CUBE}.user_id = {orders}.user_id' });

    expect(r.success).toBe(false);
    const issues = JSON.stringify(r.error?.issues ?? []);
    expect(issues).toContain('unrecognized_keys');
    expect(issues).toMatch(/`joins\.<alias>\.sql`.*removed.*DERIVED from the declared relationship/s);
  });

  it('refuses an authored cardinality, and the refusal says it never had an effect', () => {
    const r = CubeJoinSchema.safeParse({ name: 'line_items', relationship: 'one_to_many' });

    expect(r.success).toBe(false);
    const issues = JSON.stringify(r.error?.issues ?? []);
    expect(issues).toMatch(/`joins\.<alias>\.relationship`.*removed.*never had an effect/s);
  });

  it('refuses the `on` spelling with the derivation rather than a rename to `sql`', () => {
    const r = CubeJoinSchema.safeParse({ name: 'orders', on: '{CUBE}.id = {orders}.id' });

    expect(r.success).toBe(false);
    const issues = JSON.stringify(r.error?.issues ?? []);
    expect(issues).toContain('DERIVED from the declared relationship');
    expect(issues).not.toContain('→ `sql`');
  });

  it('should reject join without required fields', () => {
    expect(() => CubeJoinSchema.parse({})).toThrow();
  });
});

/**
 * [#18612] The retirement is measured against METADATA AT REST, not only
 * against sources.
 *
 * `sql` was REQUIRED and `relationship` carried `.default('many_to_one')`, so
 * every cube artifact ever written from the old schema's own parse output
 * carries BOTH keys — and the boot door re-parses stored metadata through
 * `ObjectStackDefinitionSchema` (`analyticsCubes: z.array(CubeSchema)`). Without
 * the ADR-0087 D2 conversion `cube-join-sql-and-relationship-removed` that
 * artifact stops booting with no remedy short of hand-editing JSON (#12772's
 * shape). The conversion is `retiredFromLoadPath`, so the AUTHORING funnel still
 * teaches the tombstone; the data-at-rest seams pin `includeRetired: true`.
 */
describe('a persisted cube heals at the door — the retired join `sql` / `relationship` are stripped (ADR-0087 D2)', () => {
  /** What `CubeSchema.parse` itself emitted before this retirement. */
  const persisted = () => ({
    analyticsCubes: [{
      name: 'showcase_delivery',
      sql: 'showcase_task',
      measures: { count: { label: 'Tasks', type: 'count', sql: '*' } },
      dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } },
      joins: {
        project: {
          name: 'showcase_project',
          relationship: 'many_to_one',
          sql: '${showcase_task}.project = ${showcase_project}.id',
        },
      },
    }],
  });

  it('is REFUSED at the boot door before the conversion and ACCEPTED after it', () => {
    const before = ObjectStackDefinitionSchema.safeParse(persisted());
    expect(before.success).toBe(false);
    expect(JSON.stringify(before.error?.issues ?? [])).toContain('unrecognized_keys');

    const healed = applyConversions(persisted(), { includeRetired: true });
    const after = ObjectStackDefinitionSchema.safeParse(healed);
    expect(
      after.success,
      `expected the converted artifact to parse; got ${JSON.stringify(after.error?.issues ?? [])}`,
    ).toBe(true);
    expect((healed as { analyticsCubes: Array<{ joins: unknown }> }).analyticsCubes[0]!.joins)
      .toEqual({ project: { name: 'showcase_project' } });
  });

  it('LIT CONTROL — a shape that was always wrong is refused on BOTH sides', () => {
    // `relationshipp` is the near-miss #4001 batch D closed. The conversion
    // strips two NAMED keys, so this one survives it and the door still refuses
    // — which is what makes the leg above a reading and not a tautology.
    const bad = () => {
      const s = persisted();
      s.analyticsCubes[0]!.joins = { project: { name: 'showcase_project', relationshipp: 'many_to_one' } } as never;
      return s;
    };
    expect(ObjectStackDefinitionSchema.safeParse(bad()).success).toBe(false);
    const healed = applyConversions(bad(), { includeRetired: true });
    expect(ObjectStackDefinitionSchema.safeParse(healed).success).toBe(false);
  });

  it('emits one notice per stripped site, and the notice NAMES the cube that lost the key', () => {
    const twoCubes = {
      analyticsCubes: [
        persisted().analyticsCubes[0]!,
        {
          name: 'billing_revenue',
          sql: 'showcase_invoice',
          measures: { amount: { label: 'Amount', type: 'sum', sql: 'amount' } },
          dimensions: { issued_on: { label: 'Issued', type: 'time', sql: 'issued_on' } },
          joins: {
            account: { name: 'showcase_account', relationship: 'many_to_one' },
            // Already canonical: the control that produces NO notice.
            owner: { name: 'sys_user' },
          },
        },
      ],
    };
    const { notices } = collectConversionNotices(twoCubes, { includeRetired: true });
    const mine = notices.filter((n) => n.conversionId === 'cube-join-sql-and-relationship-removed');
    expect(mine.map((n) => n.path)).toEqual([
      'analyticsCubes[0](showcase_delivery).joins.project.sql',
      'analyticsCubes[0](showcase_delivery).joins.project.relationship',
      'analyticsCubes[1](billing_revenue).joins.account.relationship',
    ]);
    expect(mine.every((n) => n.to === '(removed)')).toBe(true);
  });
});

describe('CubeSchema', () => {
  const validCube = {
    name: 'orders',
    sql: 'SELECT * FROM orders',
    measures: {
      count: {
        label: 'Order Count',
        type: 'count',
        sql: 'id',
      },
    },
    dimensions: {
      status: {
        label: 'Status',
        type: 'string',
        sql: 'status',
      },
    },
  };

  it('should accept valid minimal cube', () => {
    const cube = CubeSchema.parse(validCube);

    expect(cube.name).toBe('orders');
    expect(cube.public).toBe(true);
  });

  it('should accept cube with all fields', () => {
    const cube = CubeSchema.parse({
      ...validCube,
      title: 'Orders Cube',
      description: 'Cube for order analytics',
      joins: {
        users: {
          name: 'users',
        },
      },
      // No `refreshKey`: retired whole (#20637), refused with its prescription —
      // pinned in `cube-refresh-key-retirement.test.ts`.
      public: true,
    });

    expect(cube.title).toBe('Orders Cube');
    expect(cube.joins).toBeDefined();
    expect(cube.public).toBe(true);
  });

  it('keeps an explicit `public: false` (the hidden cube the analytics API refuses)', () => {
    expect(CubeSchema.parse({ ...validCube, public: false }).public).toBe(false);
  });

  it('should apply defaults', () => {
    const cube = CubeSchema.parse(validCube);

    // Visible by default — the Cube.dev default. `service-analytics` hides a
    // cube only on an explicit `public: false` (cube-visibility.ts), so a
    // `false` default would hide every cube that omits the key.
    expect(cube.public).toBe(true);
    expect(cube.title).toBeUndefined();
    expect(cube.joins).toBeUndefined();
    // The retired `refreshKey` tombstone materializes nothing.
    expect(cube).not.toHaveProperty('refreshKey');
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
        dateRange: 'last_7_days',
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

  it('should NOT default timezone -- absence means the engine resolves it', () => {
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
