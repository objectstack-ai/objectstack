// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#13714 — a cube query carrying a `timeDimensions[].granularity` is
 * SERVED, through the analytics strategy fork onto a REAL SQL driver.
 *
 * ## Why this suite runs the road rather than a unit of it
 *
 * The card is a field report from a running deployment and it names the trap
 * itself: the date-bucket parity pins (#3773 date-bucket-parity, #3839
 * empty-group-parity) were GREEN the whole time the endpoint answered 500,
 * because they exercise bucketing at a layer that never carries the input that
 * breaks. So this file does what they cannot — it drives `AnalyticsService`
 * with a real `SqlDriver` on **better-sqlite3, the driver the report was filed
 * against**, and asserts the rows come back.
 *
 * ## The reported request
 *
 * ```
 * POST /api/v1/analytics/query
 * { "cube": "showcase_delivery",
 *   "measures": ["showcase_delivery.count"],
 *   "timeDimensions": [{ "dimension": "showcase_delivery.due_date",
 *                        "granularity": "month" }] }
 * → 500 DATABASE_ERROR
 * ```
 *
 * with controls from the same session that SUCCEED: the same measure by
 * `dimensions: [...status]` → 200 reconciling against `/data`, a second measure
 * by status → 200, and malformed bodies → 400 at the entry validator.
 *
 * ## The chain, and which link each pin owns
 *
 * 1. A granularity routes OFF the native-SQL face — `NativeSQLStrategy.canHandle`
 *    declines exactly on `timeDimensions[].granularity`. ⭐ Already pinned, both
 *    directions, by `native-sql-granularity-decline.test.ts`; a DECLARED CONTROL
 *    here, deliberately not duplicated.
 * 2. `ObjectQLStrategy` then hands the driver an aggregation whose `alias` is the
 *    caller's CUBE-QUALIFIED measure name — `<cube>.<measure>` — because that is
 *    the key the caller reads its own number back under. **That is this file's
 *    first block**, and it was the unpinned link.
 * 3. `driver-sql` must emit that alias as ONE identifier. Before the repair it
 *    bound it through knex's `??`, which parses an identifier rather than quoting
 *    one and splits on `.`, so the statement reached the database as
 *    ``count(*) as `showcase_delivery`.`count` `` and was refused before it ran.
 *    Pinned per dialect — SQLite embedded, Postgres and MySQL live — by
 *    `packages/drivers/driver-sql/src/sql-driver-13714-aggregate-alias-single-identifier.test.ts`.
 *
 * ⚠️ Link 1 is why the fault LOOKED like a date-bucketing fault and is not one:
 * the granularity is the ROUTER. The native face hand-writes `AS "<measure>"` —
 * one quoted identifier, already correct — so an un-bucketed cube query never
 * reached the broken door while a bucketed one always did. That is exactly why
 * the report's controls were 200, and it means a repair aimed at
 * `buildDateBucketExpr` would have left the defect untouched.
 *
 * ## What the bridge here stands in for
 *
 * `executeAggregate` is bridged to `driver.aggregate`, the same shape
 * `cross-field-engine-fallback.test.ts` uses and for the same stated reason: in
 * production the bridge is `engine.aggregate`, and `driver.aggregate` is what
 * that call reaches. The one behaviour the engine adds on top is the
 * `supports.queryDateGranularity` fork — for a granularity a dialect does not
 * bucket natively it buckets IN MEMORY instead of calling this door. SQLite
 * declines `week` (its `%V` needs SQLite 3.46), so `week` is asserted here as
 * what the DIRECT caller gets: the declared #6212 `NOT_IMPLEMENTED`/501
 * capability refusal, never a `DATABASE_ERROR`. The in-memory leg it stands for
 * is the engine's, and is what the parity suites measure.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { DateGranularity } from '@objectstack/spec/data';
import type { AggregationNode, Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, DriverQuery } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';

const OBJECT = 'td_delivery';
const CUBE_NAME = 'td_delivery_cube';
const COUNT = `${CUBE_NAME}.count`;
const HOURS = `${CUBE_NAME}.total_estimate_hours`;
const DUE_DATE = `${CUBE_NAME}.due_date`;
const STATUS = `${CUBE_NAME}.status`;

/** `showcase_delivery` with the names changed and the joins dropped. */
const CUBE: Cube = {
  name: CUBE_NAME,
  title: 'TD Delivery Analytics',
  sql: OBJECT,
  measures: {
    count: { name: 'count', label: 'Count', type: 'count', sql: '*' },
    total_estimate_hours: {
      name: 'total_estimate_hours', label: 'Total Estimated Hours', type: 'sum', sql: 'estimate_hours',
    },
  },
  dimensions: {
    status: { name: 'status', label: 'Status', type: 'string', sql: 'status' },
    // `type: 'time'` over a `Field.date` column — the shape the report buckets.
    due_date: { name: 'due_date', label: 'Due Date', type: 'time', sql: 'due_date' },
  },
} as unknown as Cube;

/** Two months, three rows — enough for a `month` bucket to have work to do. */
const ROWS = [
  { id: 'r1', status: 'open', due_date: '2026-01-15', estimate_hours: 2 },
  { id: 'r2', status: 'open', due_date: '2026-01-20', estimate_hours: 3 },
  { id: 'r3', status: 'done', due_date: '2026-02-05', estimate_hours: 4 },
];

describe('[#13714] a cube time-dimension granularity reaches a real SQL driver and is served', () => {
  let driver: SqlDriver;
  let service: AnalyticsService;
  /** Every driver-level aggregate call the run made, as the driver saw it. */
  let aggregateCalls: DriverQuery[];
  /** What this dialect PUBLISHES — the record `engine.aggregate` dispatches on. */
  let caps: Record<string, boolean>;

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: OBJECT,
        fields: {
          status: { type: 'string' },
          due_date: { type: 'date' },
          estimate_hours: { type: 'number' },
        },
      },
    ] as never);
    for (const row of ROWS) await driver.create(OBJECT, { ...row }, { bypassTenantAudit: true } as never);
    caps = ((driver as unknown as { supports: { queryDateGranularity?: Record<string, boolean> } })
      .supports.queryDateGranularity ?? {});

    aggregateCalls = [];
    service = new AnalyticsService({
      cubes: [CUBE],
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (objectName, options) => {
        // `{field, method, alias}` → `{field, function, alias}`: the analytics
        // contract spells it `method`, the Query Protocol's
        // `AggregationNodeSchema` spells it `function`, and `engine.aggregate`
        // is what renames it in production. Mapped here rather than worked
        // around, so the bridge keeps the shape a real host writes.
        const query: DriverQuery = {
          where: options.filter as DriverQuery['where'],
          groupBy: options.groupBy,
          aggregations: options.aggregations?.map(({ field, method, alias }) => ({
            field,
            function: method as AggregationNode['function'],
            alias,
          })),
        };
        aggregateCalls.push(query);
        return (await driver.aggregate(objectName, query)) as Record<string, unknown>[];
      },
    });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  const run = async (query: Partial<AnalyticsQuery>) => {
    aggregateCalls = [];
    return service.query({ cube: CUBE_NAME, ...query } as AnalyticsQuery);
  };

  const caught = async (fn: () => Promise<unknown>): Promise<any> => {
    try {
      await fn();
    } catch (err) {
      return err;
    }
    return null;
  };

  // ───────────────────────────────────────────────────────────────
  // LINK 2 — the alias the strategy hands the driver
  // ───────────────────────────────────────────────────────────────

  it('the driver is handed the CUBE-QUALIFIED measure name as the aggregation alias', async () => {
    // The unpinned link, and the reason the defect only ever showed through
    // analytics: nothing else routinely puts a dot in an `alias`. Asserted on
    // the call the driver actually received, not on a rendering of it.
    await run({ measures: [COUNT], timeDimensions: [{ dimension: DUE_DATE, granularity: 'month' }] });

    expect(aggregateCalls).toHaveLength(1);
    expect(aggregateCalls[0].aggregations?.map((a) => a.alias)).toEqual([COUNT]);
    // And the bucket really is a structured groupBy item, so this call is the
    // one that reaches the date-bucket emission path.
    expect(aggregateCalls[0].groupBy).toEqual([{ field: 'due_date', dateGranularity: 'month' }]);
  });

  // ───────────────────────────────────────────────────────────────
  // THE CARD — every granularity the spec declares, not just `month`
  // ───────────────────────────────────────────────────────────────

  for (const granularity of DateGranularity.options) {
    it(`granularity '${granularity}' is served end to end, never a DATABASE_ERROR`, async () => {
      const err = await caught(() =>
        run({ measures: [COUNT], timeDimensions: [{ dimension: DUE_DATE, granularity }] }),
      );

      // ⛔ The one answer this card forbids, whatever this dialect buckets: a
      // backend fault for a query that is spelled correctly.
      expect(err?.code, `${granularity}: must not be a backend fault`).not.toBe('DATABASE_ERROR');

      if (caps[granularity] !== true) {
        // The declared capability gap (#6212). In production `engine.aggregate`
        // reads the same record and buckets in memory instead of calling this
        // door; the direct caller gets the refusal, and it is a statement about
        // the BACKEND, never about the request.
        expect(err?.code, `${granularity}: declined natively → the #6212 refusal`).toBe('NOT_IMPLEMENTED');
        expect(err?.status).toBe(501);
        return;
      }

      expect(err, `${granularity}: served natively, so nothing may throw`).toBeNull();
      const result = await run({
        measures: [COUNT],
        timeDimensions: [{ dimension: DUE_DATE, granularity }],
      });
      expect(result.rows.length, `${granularity}: at least one bucket`).toBeGreaterThan(0);
      for (const row of result.rows) {
        expect(Object.keys(row), `${granularity}: the caller's own measure key`).toContain(COUNT);
      }
      const total = result.rows.reduce((sum, r) => sum + Number(r[COUNT] ?? 0), 0);
      expect(total, `${granularity}: no row dropped, none double-counted`).toBe(ROWS.length);
    });
  }

  it("'month' — the reported request — separates January from February", async () => {
    // That the buckets are the RIGHT buckets, not merely present: one collapsed
    // bucket is the #3773 failure mode and would satisfy the total above.
    const result = await run({
      measures: [COUNT],
      timeDimensions: [{ dimension: DUE_DATE, granularity: 'month' }],
    });

    const byBucket = new Map(result.rows.map((r) => [String(r[DUE_DATE]).slice(0, 7), Number(r[COUNT])]));
    expect(byBucket.get('2026-01')).toBe(2);
    expect(byBucket.get('2026-02')).toBe(1);
  });

  it('a bucketed SUM measure is served too — count is not a special case', async () => {
    const result = await run({
      measures: [HOURS],
      timeDimensions: [{ dimension: DUE_DATE, granularity: 'month' }],
    });

    const total = result.rows.reduce((sum, r) => sum + Number(r[HOURS] ?? 0), 0);
    expect(total).toBe(9);
  });

  it('two measures bucketed together keep their own two columns', async () => {
    const result = await run({
      measures: [COUNT, HOURS],
      timeDimensions: [{ dimension: DUE_DATE, granularity: 'month' }],
    });

    for (const row of result.rows) {
      expect(Object.keys(row)).toEqual(expect.arrayContaining([COUNT, HOURS]));
    }
  });

  it('a granularity ALONGSIDE a plain dimension is served', async () => {
    const result = await run({
      measures: [COUNT],
      dimensions: [STATUS],
      timeDimensions: [{ dimension: DUE_DATE, granularity: 'month' }],
    });

    const total = result.rows.reduce((sum, r) => sum + Number(r[COUNT] ?? 0), 0);
    expect(total).toBe(ROWS.length);
  });

  // ───────────────────────────────────────────────────────────────
  // THE AXIS — the same door, WITHOUT a granularity
  // ───────────────────────────────────────────────────────────────
  //
  // ⚠️ These are deliberately NOT a reproduction of the reporter's controls,
  // and the ablation is what proves they are not: they redden along with the
  // bucketed cases. `queryCapabilities` here declares `nativeSql: false`, so an
  // un-bucketed query is forced down the SAME door instead of being served by
  // `NativeSQLStrategy` as it is in the field. That is the point — it isolates
  // the granularity as a ROUTER rather than the fault: strip the bucket, keep
  // the cube-qualified alias, and the door still fails before the repair.
  //
  // The reporter's actual controls travel the native face, and the fork that
  // sends them there is pinned in both directions by
  // `native-sql-granularity-decline.test.ts` — a DECLARED CONTROL for this card,
  // green throughout and not re-measured here.

  it('the same door serves an un-bucketed cube query — the bucket is not the fault', async () => {
    const result = await run({ measures: [COUNT], dimensions: [STATUS] });

    const byStatus = new Map(result.rows.map((r) => [String(r[STATUS]), Number(r[COUNT])]));
    expect(byStatus.get('open')).toBe(2);
    expect(byStatus.get('done')).toBe(1);
  });

  it('a second measure by status is served on that door too', async () => {
    const result = await run({ measures: [HOURS], dimensions: [STATUS] });

    const byStatus = new Map(result.rows.map((r) => [String(r[STATUS]), Number(r[HOURS])]));
    expect(byStatus.get('open')).toBe(5);
    expect(byStatus.get('done')).toBe(4);
  });

  it('the bucket totals reconcile against the rows the driver actually holds', async () => {
    // The reporter reconciled their controls against `/data`; this reconciles
    // against the same driver's own `find`, so a green total cannot come from an
    // empty or differently-scoped read.
    const all = (await driver.find(OBJECT, {})) as unknown[];
    expect(all).toHaveLength(ROWS.length);

    const bucketed = await run({
      measures: [COUNT],
      timeDimensions: [{ dimension: DUE_DATE, granularity: 'month' }],
    });
    const total = bucketed.rows.reduce((sum, r) => sum + Number(r[COUNT] ?? 0), 0);
    expect(total).toBe(all.length);
  });
});
