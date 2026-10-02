// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cube measure whose `type` names no aggregate is refused on BOTH strategies,
 * from one fixture, so neither can hide the other (commit 017130a09, #21000).
 *
 * The history this file carries: `AggregationMetricType` declared three
 * custom-SQL-expression types — `number` / `string` / `boolean` — whose `sql`
 * WAS the computation. `NativeSQLStrategy` emitted them verbatim (#4157) and
 * `ObjectQLStrategy` refused them `INVALID_FIELD` / 400 (commit 017130a09),
 * partitioned by a shared `EXPRESSION_METRIC_TYPES` set, and this file pinned
 * the two postures side by side. A cube member's `sql` then became a column
 * reference, so the three had nothing left to compute — measured before
 * #21000 on this fixture's shape, the raw-SQL path emitted the referenced
 * column UNAGGREGATED in a grouped statement — and they were retired from the
 * spec with a prescription. The partition went with them.
 *
 * What is pinned now, ONE cube (all six aggregates, the three retired types,
 * one never-declared drift type) driven through the real `AnalyticsService`
 * routing under BOTH capability profiles:
 *
 * - each retired type is REFUSED on both paths, never served, with the SPEC's
 *   prescription (`aggregateOfMeasure`) — in the undeclared-500 tier, since
 *   only a cube that never met `CubeSchema`'s parse can carry one — and
 *   nothing reaches the engine or the driver;
 * - every admitted AGGREGATE measure is still served on the ObjectQL path and
 *   still reaches the engine carrying its OWN method (`sum` stays `sum`);
 * - an enum-INVALID drift type (`median`) is NOT refused with the caller-shaped
 *   `INVALID_FIELD` envelope (#5716 / `dataset-refusal.ts`), on either path;
 * - the pre-existing cross-object non-recombinable refusal keeps its EXACT
 *   message, and a retired type beside a cross-object dimension is refused as
 *   the type refusal (the one resolver both doors call reaches it first).
 *
 * ## Dissolution verification, direction predicted BEFORE running
 *
 * Restoring the native path's verbatim emit for the three must turn the
 * native-profile REFUSAL cases red in the ordinary direction (the query
 * "succeeds" and a statement is executed); removing the ObjectQL resolver's
 * verdict must turn the ObjectQL-profile cases red the same way (the engine is
 * reached carrying the retired type as its method). The aggregate, drift and
 * cross-object cases are predicted to stay green in both directions.
 */

import { describe, it, expect, vi } from 'vitest';
import { AggregationMetricType, type Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

/** `orders`' real columns — every bare-identifier measure/dimension source. */
const ORDER_FIELDS = ['id', 'amount', 'cost', 'revenue', 'paid', 'buyer', 'status', 'account', 'created_at'];

/**
 * One cube, both strategies: all six aggregate types, and the three retired
 * custom-SQL types over a COLUMN — the shape a cube stored after #20943 made
 * `sql` a column reference and before #21000 retired the types still carries.
 * Built WITHOUT the parse (`as never`): `CubeSchema` refuses all three, so only
 * a cube a host registers in-process from a literal can reach the service
 * with one.
 */
const CUBE: Cube = {
  name: 'orders',
  title: 'Orders',
  sql: 'orders',
  measures: {
    orders_count: { label: 'Count', type: 'count', sql: '*' },
    total: { label: 'Total', type: 'sum', sql: 'amount' },
    avg_amount: { label: 'Avg', type: 'avg', sql: 'amount' },
    min_amount: { label: 'Min', type: 'min', sql: 'amount' },
    max_amount: { label: 'Max', type: 'max', sql: 'amount' },
    buyers: { label: 'Buyers', type: 'count_distinct', sql: 'buyer' },
    margin: { label: 'Margin', type: 'number', sql: 'revenue' },
    top_status: { label: 'Top status', type: 'string', sql: 'status' },
    any_paid: { label: 'Any paid', type: 'boolean', sql: 'paid' },
  },
  dimensions: {
    status: { label: 'Status', type: 'string', sql: 'status' },
  },
  joins: { account: { name: 'crm_account' } },
} as never;

/**
 * An enum-INVALID metric type. `AggregationMetricType` is closed and `median`
 * is not in it, so no spec-valid cube can declare this — it models host drift
 * (a cube registered without meeting `CubeSchema`). The drift tier belongs to
 * the platform, never to the caller (#5716 / `dataset-refusal.ts`).
 */
const DRIFT_CUBE: Cube = {
  name: 'orders_drift',
  title: 'Orders drift',
  sql: 'orders',
  measures: { weird: { label: 'Weird', type: 'median', sql: 'amount' } },
  dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } },
} as never;

type Refusal = Error & {
  code?: string;
  status?: number;
  member?: string;
  param?: string;
  cube?: string;
};

function makeService(profile: 'objectql' | 'native') {
  const sqls: string[] = [];
  const calls: Array<{ object: string; aggregations?: unknown; groupBy?: unknown }> = [];
  const service = new AnalyticsService({
    logger: silentLogger,
    cubes: [CUBE, DRIFT_CUBE],
    queryCapabilities: () => ({
      nativeSql: profile === 'native',
      objectqlAggregate: profile === 'objectql',
      inMemory: false,
    }),
    executeAggregate: async (object: string, options: any) => {
      calls.push({ object, aggregations: options?.aggregations, groupBy: options?.groupBy });
      return [{ status: 'open', total: 300 }];
    },
    executeRawSql: async (_object: string, sql: string) => {
      sqls.push(sql);
      return [{ status: 'open' }];
    },
    isRegisteredObject: (n: string) => n === 'orders',
    getObjectFieldNames: (n: string) => (n === 'orders' ? ORDER_FIELDS : undefined),
  } as any);
  return { service, sqls, calls };
}

/** Run one query on a fresh service under `profile`, reporting everything. */
async function run(query: unknown, profile: 'objectql' | 'native') {
  const { service, sqls, calls } = makeService(profile);
  let rows: Array<Record<string, unknown>> | undefined;
  let error: Refusal | undefined;
  try {
    rows = (await service.query(query as never)).rows as Array<Record<string, unknown>>;
  } catch (e) {
    error = e as Refusal;
  }
  return { rows, error, sqls, calls };
}

/** Run one dry-run `generateSql` (the `/analytics/sql` face) on a fresh service under `profile`. */
async function runSql(query: unknown, profile: 'objectql' | 'native') {
  const { service, sqls, calls } = makeService(profile);
  let error: Refusal | undefined;
  try {
    await service.generateSql(query as never);
  } catch (e) {
    error = e as Refusal;
  }
  return { error, sqls, calls };
}

const RETIRED = [
  ['margin', 'number'],
  ['top_status', 'string'],
  ['any_paid', 'boolean'],
] as const;

const PROFILES = ['native', 'objectql'] as const;

/**
 * The one refusal a retired metric type meets (`aggregateOfMeasure`, #21000):
 * the measure and cube named, the SPEC's prescription for the type verbatim,
 * the undeclared-500 tier (no ADR-0112 envelope — only a cube that never met
 * the parse can carry one), and nothing executed.
 */
function expectRetiredTypeRefusal(
  r: { error?: Refusal; sqls: string[]; calls: unknown[] },
  member: string,
  type: string,
) {
  expect(r.error).toBeInstanceOf(Error);
  expect(r.error?.message).toContain(`measure "${member}" on cube "orders" cannot be served: its type "${type}"`);
  // The prescription is the spec's own, read off the enum — so an operator
  // reads what `os validate` would have printed for this cube.
  const spec = AggregationMetricType.safeParse(type);
  expect(spec.success).toBe(false);
  expect(r.error?.message).toContain(spec.error!.issues[0]!.message);
  expect(r.error?.message).toContain(`\`${type}\` was removed from \`AggregationMetricType\``);
  // Undeclared-500 tier: never the caller-blaming INVALID_FIELD / 400.
  expect(r.error?.code).toBeUndefined();
  expect(r.error?.status).toBeUndefined();
  // The refusal is a refusal: the engine was never reached, nothing executed.
  expect(r.calls).toEqual([]);
  expect(r.sqls).toEqual([]);
}

// ── 1. Both paths REFUSE a retired type, on both doors ───────────────────────

describe.each(PROFILES)('%s path: a retired custom-SQL metric type is refused, never served', (profile) => {
  it.each(RETIRED)('refuses "%s" (type %s) on /analytics/query, nothing executed', async (member, type) => {
    const r = await run({ cube: 'orders', measures: [member], dimensions: ['status'] }, profile);
    expectRetiredTypeRefusal(r, member, type);
  });

  it.each(RETIRED)('refuses "%s" (type %s) on the /analytics/sql dry run too', async (member, type) => {
    const r = await runSql({ cube: 'orders', measures: [member], dimensions: ['status'] }, profile);
    expectRetiredTypeRefusal(r, member, type);
  });

  it('an admitted measure beside it does not rescue the query — the retired member is named', async () => {
    const r = await run({ cube: 'orders', measures: ['total', 'margin'], dimensions: ['status'] }, profile);
    expectRetiredTypeRefusal(r, 'margin', 'number');
  });

  it('refuses on the scalar (no-dimension) shape too', async () => {
    const r = await run({ cube: 'orders', measures: ['margin'] }, profile);
    expectRetiredTypeRefusal(r, 'margin', 'number');
  });
});

// ── 2. The load-bearing negative: admitted aggregates still served ───────────

describe('ObjectQL path: every admitted aggregate is still served, carrying its own method', () => {
  it('an admitted sum measure reaches the engine as {field, method: "sum"} and answers', async () => {
    const r = await run({ cube: 'orders', measures: ['total'], dimensions: ['status'] }, 'objectql');
    expect(r.error).toBeUndefined();
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].aggregations).toEqual([{ field: 'amount', method: 'sum', alias: 'total' }]);
    expect(r.rows?.[0]?.total).toBe(300);
  });

  it('all six aggregate types reach the engine, each carrying its own method', async () => {
    const r = await run({
      cube: 'orders',
      measures: ['orders_count', 'total', 'avg_amount', 'min_amount', 'max_amount', 'buyers'],
      dimensions: ['status'],
    }, 'objectql');
    expect(r.error).toBeUndefined();
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].aggregations).toEqual([
      { field: '*', method: 'count', alias: 'orders_count' },
      { field: 'amount', method: 'sum', alias: 'total' },
      { field: 'amount', method: 'avg', alias: 'avg_amount' },
      { field: 'amount', method: 'min', alias: 'min_amount' },
      { field: 'amount', method: 'max', alias: 'max_amount' },
      { field: 'buyer', method: 'count_distinct', alias: 'buyers' },
    ]);
  });
});

describe('native-SQL path: every admitted aggregate is still wrapped', () => {
  it('the six aggregates lower to their SQL functions in one statement', async () => {
    const r = await run({
      cube: 'orders',
      measures: ['orders_count', 'total', 'avg_amount', 'min_amount', 'max_amount', 'buyers'],
      dimensions: ['status'],
    }, 'native');
    expect(r.error).toBeUndefined();
    expect(r.sqls).toHaveLength(1);
    for (const fragment of ['COUNT(*)', 'SUM(amount)', 'AVG(amount)', 'MIN(amount)', 'MAX(amount)', 'COUNT(DISTINCT buyer)']) {
      expect(r.sqls[0]).toContain(fragment);
    }
  });
});

// ── 3. The drift tier: never the caller's mistake, on either path ───────────

describe.each(PROFILES)('%s path: an enum-invalid drift type', (profile) => {
  it('is NOT refused as the caller\'s mistake, and never reaches the engine', async () => {
    // `median` was never authorable (`AggregationMetricType` is closed), so an
    // arrival is OUR drift — the undeclared-500 tier, never the caller-shaped
    // 400 (#5716). It is refused in the spec's words — its vocabulary, not a
    // retirement — and on the ObjectQL path it is no longer forwarded to the
    // engine as a method no driver declares.
    const r = await run({ cube: 'orders_drift', measures: ['weird'], dimensions: ['status'] }, profile);
    expect(r.error).toBeInstanceOf(Error);
    expect(r.error?.code).not.toBe('INVALID_FIELD');
    expect(r.error?.code).toBeUndefined();
    expect(r.error?.message).toContain('cannot be served: its type "median"');
    expect(r.error?.message).not.toMatch(/was removed/);
    expect(r.calls).toEqual([]);
    expect(r.sqls).toEqual([]);
  });
});

// ── 4. The twin keeps its exact message ──────────────────────────────────────

describe('the cross-object non-recombinable refusal is untouched beside the type verdict', () => {
  it('still refuses avg + cross-object dimension with its exact shipped message', async () => {
    const r = await run(
      { cube: 'orders', dimensions: ['account.region'], measures: ['avg_amount'] },
      'objectql',
    );
    expect(r.error?.code).toBe('INVALID_FIELD');
    expect(r.error?.status).toBe(400);
    expect(r.error?.member).toBe('avg_amount');
    expect(r.error?.message).toBe(
      '[Analytics] ObjectQLStrategy cannot group by a cross-object dimension ' +
      'with a "avg" measure ("avg_amount") — its value cannot be recombined ' +
      'across the intermediate FK grouping. Use sum/count/min/max, or run on ' +
      'a native-SQL driver.',
    );
    expect(r.calls).toEqual([]);
  });

  it('a retired type beside a cross-object dimension is refused as the type refusal', async () => {
    // Deliberate precedence: the type verdict names the real defect (the
    // measure can never run, cross-object dimension or not), and both doors
    // reach it through the one resolver — so the attribution cannot fork
    // between /analytics/query and /analytics/sql.
    const r = await run(
      { cube: 'orders', dimensions: ['account.region'], measures: ['margin'] },
      'objectql',
    );
    expectRetiredTypeRefusal(r, 'margin', 'number');
  });
});
