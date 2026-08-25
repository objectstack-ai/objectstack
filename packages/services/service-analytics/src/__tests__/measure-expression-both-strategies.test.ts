// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12209 — a custom-SQL measure is refused loudly on the ObjectQL path, and
 * BOTH strategies are pinned from one fixture so neither can hide the other.
 *
 * #4157 was fixed on one strategy of two: `NativeSQLStrategy` learned to emit
 * a `number`/`string`/`boolean` measure's `sql` verbatim, and its regression
 * pin (`measure-expression-sql.test.ts`) forces `objectqlAggregate: false` —
 * so the pin covered exactly one strategy. `ObjectQLStrategy` never got the
 * matching partition: `resolveMeasureAggregation` forwarded `Metric.type`
 * verbatim as the engine method with the whole SQL expression in `field`, so
 * `driver-sql` threw `INVALID_QUERY` blaming a `function` key the author never
 * wrote, and the in-memory evaluator answered `null` for every bucket through
 * its `switch` default — the #4157 class in its null variant, measured on
 * #12053's probe: an admitted `sum` returned 300 per bucket where the
 * custom-SQL measure returned `null`.
 *
 * This file is the pin the defect could not hide from: ONE cube whose measures
 * cover all six aggregates, all three expression types and one enum-invalid
 * drift type, driven through the real `AnalyticsService` routing under BOTH
 * capability profiles. The native profile pins the expression measures still
 * SERVED (emitted verbatim); the ObjectQL profile pins them REFUSED — same
 * fixture, so a change that moves either posture turns a case here red.
 *
 * The load-bearing negatives, and why they are here:
 *
 * - every admitted AGGREGATE measure is still served on the ObjectQL path and
 *   still reaches the engine carrying its OWN method (`sum` stays `sum`). An
 *   implementation that refuses by method membership (e.g. reusing
 *   `RECOMBINABLE_METHODS`, which lacks `avg`/`count_distinct`) passes the
 *   refusal cases and goes red here.
 * - an enum-INVALID metric type (`median` — host drift, not authorable) is NOT
 *   refused with the caller-shaped `INVALID_FIELD` envelope. The drift tier is
 *   the platform's own (`dataset-refusal.ts` header, #5716): an implementation
 *   that refuses "every method that is not one of the six aggregates" passes
 *   the refusal cases too, and goes red here — the arm must key on the
 *   DECLARED expression partition (`EXPRESSION_METRIC_TYPES`), not on a method
 *   allowlist.
 * - the pre-existing cross-object non-recombinable refusal keeps its EXACT
 *   message — the new arm sits beside it, not over it.
 *
 * ## Dissolution verification, direction predicted BEFORE running
 *
 * Restoring the accepting behaviour (deleting the #12209 arm in
 * `ObjectQLStrategy.resolveMeasureAggregation`) must turn the ObjectQL-profile
 * REFUSAL cases red in the ordinary direction: each asserts the ADR-0112
 * envelope (`code`/`status`), the measure's own name in `member` and message,
 * AND that nothing reached the engine (`calls`/`sqls` empty) — with the arm
 * gone, the query "succeeds", the engine IS reached carrying the expression in
 * `field`, so the cases cannot pass vacuously. Every other case — the six
 * admitted aggregates, the drift tier, the native-profile SERVED block, the
 * cross-object twin — is predicted to stay GREEN in both directions: none of
 * them touches the arm.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
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
 * One cube, both strategies: all six aggregate types, all three custom-SQL
 * expression types. The expression `sql`s are deliberately DOT-FREE — an
 * expression containing a dot was already (mis)refused as a cross-object
 * measure, so the dot-free ones are the exact shapes that used to reach
 * `engine.aggregate` and answer `null`.
 */
const CUBE: Cube = {
  name: 'orders',
  title: 'Orders',
  sql: 'orders',
  measures: {
    orders_count: { name: 'orders_count', label: 'Count', type: 'count', sql: '*' },
    total: { name: 'total', label: 'Total', type: 'sum', sql: 'amount' },
    avg_amount: { name: 'avg_amount', label: 'Avg', type: 'avg', sql: 'amount' },
    min_amount: { name: 'min_amount', label: 'Min', type: 'min', sql: 'amount' },
    max_amount: { name: 'max_amount', label: 'Max', type: 'max', sql: 'amount' },
    buyers: { name: 'buyers', label: 'Buyers', type: 'count_distinct', sql: 'buyer' },
    margin: {
      name: 'margin', label: 'Margin', type: 'number',
      sql: 'SUM(revenue) / NULLIF(SUM(cost), 0)',
    },
    top_status: {
      name: 'top_status', label: 'Top status', type: 'string',
      sql: "MAX(CASE WHEN paid THEN 'paid' ELSE 'open' END)",
    },
    any_paid: { name: 'any_paid', label: 'Any paid', type: 'boolean', sql: 'MAX(paid)' },
  },
  dimensions: {
    status: { name: 'status', label: 'Status', type: 'string', sql: 'status' },
  },
  joins: { account: { name: 'crm_account', relationship: 'belongsTo', sql: '' } },
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
  measures: { weird: { name: 'weird', label: 'Weird', type: 'median', sql: 'amount' } },
  dimensions: { status: { name: 'status', label: 'Status', type: 'string', sql: 'status' } },
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

/** The one wire shape every #12209 refusal must have (ADR-0112 / #5716). */
function expectCustomSqlRefusal(
  r: { error?: Refusal; sqls: string[]; calls: unknown[] },
  member: string,
  type: string,
) {
  expect(r.error).toBeInstanceOf(Error);
  expect(r.error?.code).toBe('INVALID_FIELD');
  expect(r.error?.status).toBe(400);
  // The measure AS THE AUTHOR WROTE IT — today's failure blames a `function`
  // key the author never wrote, or answers null under this very name.
  expect(r.error?.member).toBe(member);
  expect(r.error?.param).toBe('measures');
  expect(r.error?.cube).toBe('orders');
  expect(r.error?.message).toContain(`("${member}")`);
  expect(r.error?.message).toContain(`type "${type}"`);
  // The in-file twin's posture: name the way out, both halves.
  expect(r.error?.message).toContain('or run on a native-SQL driver');
  // The refusal is a refusal: the engine was never reached, nothing executed.
  expect(r.calls).toEqual([]);
  expect(r.sqls).toEqual([]);
}

// ── 1. The ObjectQL path REFUSES what it cannot serve ────────────────────────

describe('ObjectQL path: custom-SQL measures are refused loudly', () => {
  it.each([
    ['margin', 'number'],
    ['top_status', 'string'],
    ['any_paid', 'boolean'],
  ] as const)('refuses "%s" (type %s) with INVALID_FIELD/400, engine never reached', async (member, type) => {
    const r = await run({ cube: 'orders', measures: [member], dimensions: ['status'] }, 'objectql');
    expectCustomSqlRefusal(r, member, type);
  });

  it('an admitted measure beside it does not rescue the query — the custom-SQL member is named', async () => {
    const r = await run({ cube: 'orders', measures: ['total', 'margin'], dimensions: ['status'] }, 'objectql');
    expectCustomSqlRefusal(r, 'margin', 'number');
  });

  it('refuses on the scalar (no-dimension) shape too', async () => {
    const r = await run({ cube: 'orders', measures: ['margin'] }, 'objectql');
    expectCustomSqlRefusal(r, 'margin', 'number');
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

  it('an enum-invalid drift type is NOT refused as the caller\'s mistake', async () => {
    // `median` is not authorable (`AggregationMetricType` is closed), so an
    // arrival is OUR drift — the undeclared-500 tier, never the caller-shaped
    // 400 (#5716). This is the case that reds a "refuse every method that is
    // not one of the six aggregates" implementation: extensionally identical
    // to the partition check on every enum-valid cube, it re-blames the
    // caller exactly here.
    const r = await run({ cube: 'orders_drift', measures: ['weird'], dimensions: ['status'] }, 'objectql');
    expect(r.error?.code).not.toBe('INVALID_FIELD');
  });
});

// ── 3. The other strategy on the SAME fixture: still serves the expression ───

describe('native-SQL path: the same custom-SQL measures stay served', () => {
  it('emits the number expression verbatim, no refusal', async () => {
    const r = await run({ cube: 'orders', measures: ['margin'], dimensions: ['status'] }, 'native');
    expect(r.error).toBeUndefined();
    expect(r.sqls).toHaveLength(1);
    expect(r.sqls[0]).toContain('SUM(revenue) / NULLIF(SUM(cost), 0) AS "margin"');
    expect(r.calls).toEqual([]);
  });

  it('emits string and boolean expressions verbatim, no refusal', async () => {
    const r = await run({ cube: 'orders', measures: ['top_status', 'any_paid'] }, 'native');
    expect(r.error).toBeUndefined();
    expect(r.sqls[0]).toContain(`MAX(CASE WHEN paid THEN 'paid' ELSE 'open' END) AS "top_status"`);
    expect(r.sqls[0]).toContain('MAX(paid) AS "any_paid"');
  });
});

// ── 4. The twin keeps its exact message ──────────────────────────────────────

describe('the cross-object non-recombinable refusal is untouched beside the new arm', () => {
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

  it('a custom-SQL measure beside a cross-object dimension is refused as custom-SQL', async () => {
    // Deliberate precedence: the custom-SQL verdict names the real defect (the
    // measure can never run on this engine, cross-object dimension or not),
    // and both doors reach it through the one resolver — so the attribution
    // cannot fork between /analytics/query and /analytics/sql.
    const r = await run(
      { cube: 'orders', dimensions: ['account.region'], measures: ['margin'] },
      'objectql',
    );
    expectCustomSqlRefusal(r, 'margin', 'number');
  });
});
