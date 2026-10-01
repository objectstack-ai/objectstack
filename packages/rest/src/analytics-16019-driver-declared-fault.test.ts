// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16019] `POST /analytics/dataset/query` — a driver fault on the raw-SQL path
 * reaches the caller by DECLARATION, and the declaration wins over the
 * phrasing heuristic.
 *
 * ## The ruling, and where each half is proved
 *
 * Under the 2026-09-06 ruling (decision batch #57, option 3) `SqlDriver.execute()`
 * declares the fault — `DATABASE_ERROR`/500, the dialect error under a
 * non-enumerable `cause` — and this door's ③a arm relays a declared 5xx with the
 * producer's code and `INTERNAL_ERROR_MESSAGE`. The two halves are proved
 * separately: `driver-sql`'s `sql-driver-16019-raw-statement-fault-envelope.test.ts`
 * proves `SqlDriver.execute` declares the fault, and the SECOND block here proves
 * this route relays a declared `DATABASE_ERROR`/500 with the prose withheld (a
 * throwing double hands the door the exact declared shape).
 *
 * [#21177] This file once drove the two halves END TO END through one call — a
 * real `AnalyticsService` on the native-SQL strategy over a real better-sqlite3
 * `SqlDriver`, fed a dataset dimension whose expression called `translate()`, the
 * function SQLite lacks. That path is gone: #21177 refuses a caller-supplied
 * inline-dataset dimension/measure `field` that is not a column reference at the
 * analytics door, before any strategy or driver runs, so a raw `translate(...)`
 * can no longer reach the engine from caller content. The FIRST block now pins
 * THAT — the door refuses the expression `PERMISSION_DENIED` / 403, the one
 * judge #21156 reaches (no new error code) — beside a positive control that a
 * legitimate dataset on declared fields is still served 200 by the real driver.
 * It pins the route's SAVED branch (`body.datasetName`) the same way: that branch
 * loads the dataset from metadata and calls the same `queryDataset`, so a saved
 * dataset whose `field` is not a column reference is refused too, and a saved
 * plain-column dataset is still served.
 *
 * [#21220] The contract now refuses that `field` text one step earlier, at parse:
 * `DatasetSchema` holds a dimension's and measure's `field` to a column reference,
 * and this route parses every dataset it is handed — inline and saved alike —
 * before calling `queryDataset`. So on THIS route both cases are answered by the
 * route's own validation, `400 VALIDATION_FAILED` naming the path
 * (`dimensions.N.field`), still before any strategy or driver runs and still
 * without echoing the expression. The service door's `403 PERMISSION_DENIED`
 * stays as defence in depth for a dataset that reaches `queryDataset` without
 * that parse, and is pinned where it is reachable: in `service-analytics`'s
 * `inline-dataset-field-admission-door.test.ts`.
 *
 * The second block pins the ordering the ruling's execution notes name. A
 * DECLARED fault is withheld even when its text is one the heuristic does not
 * know (declared wins); an UNDECLARED knex-shaped fault still falls to the
 * heuristic (the fallback stays); an UNDECLARED bare fault is the heuristic's
 * residual — pinned as the coverage boundary, the way `error-leak.test.ts`
 * pins MSSQL and Oracle, so the boundary keeps a live subject. ⛔ Not a leak to
 * close with a row: the remedy for a producer that throws dialect text bare is
 * to declare, which is the whole ruling.
 *
 * Note this file exercises the BUILT `@objectstack/service-analytics` and
 * `@objectstack/driver-sql` (both resolve through their `exports` to `dist/`):
 * mutating either source without rebuilding proves nothing here.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * The ORDERING pin in block 2 has its own leg: gate the door's ③a relay
 * behind `looksLikeInternalErrorLeak` being false (i.e. consult the heuristic
 * first) and only that case goes RED (`ANALYTICS_QUERY_FAILED` in place of the
 * producer's code); the neighbouring "phrase the heuristic does not know"
 * case stays GREEN, which is precisely why it could not stand in for this one.
 * The first block's leg (since #21220): admit anything in the contract's
 * column-reference pattern and the route's parse passes the expression on — the
 * refusal flips from `400 VALIDATION_FAILED` to the service door's
 * `403 PERMISSION_DENIED`; remove that door as well and it reaches the real driver,
 * the `500 DATABASE_ERROR` relay this file once asserted.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { AnalyticsService } from '@objectstack/service-analytics';
import { SqlDriver } from '@objectstack/driver-sql';
import { INTERNAL_ERROR_MESSAGE, declaresServerFault, looksLikeInternalErrorLeak } from '@objectstack/types';
import { RestServer } from './rest-server';

// [#17865] This file observes the REST fault log, so it declares the level it
// asserts against instead of inheriting the suite's quiet one. 'info' is the
// SHIPPED default — what a real caller gets. Paired by
// scripts/check-rest-log-spy-declared.mjs: an observer that declares nothing
// is a finding by name.
beforeAll(() => { vi.stubEnv('OS_REST_LOG', 'info'); });
afterAll(() => { vi.unstubAllEnvs(); });

// ── harness (the shape `analytics-dataset-dimension-gate.test.ts` uses) ──────

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
/** `savedDatasets` is what the route's `body.datasetName` branch loads from metadata. */
function mockProtocol(savedDatasets: unknown[] = []) {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue(savedDatasets),
  };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

function buildRoute(analyticsProvider?: any, savedDatasets: unknown[] = []) {
  const rest = new RestServer(
    mockServer() as any, mockProtocol(savedDatasets) as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    analyticsProvider,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  return rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'))!;
}

/** A service double whose `queryDataset` throws exactly the given error. */
function throwingAnalytics(error: unknown) {
  return { queryDataset: vi.fn().mockRejectedValue(error) };
}

async function post(route: any, body: unknown) {
  const res = mockRes();
  await route.handler({ method: 'POST', params: {}, headers: {}, body } as any, res);
  return res;
}

const ACCOUNT_FIELDS = ['id', 'name', 'industry'];

/**
 * A legitimate dataset on declared fields — the positive control, and the body
 * block 2 posts to the throwing double (whose `queryDataset` is mocked, so the
 * definition never reaches the real door).
 */
const dataset = {
  name: 'account_metrics',
  label: 'Account metrics',
  object: 'crm_account',
  dimensions: [
    { name: 'industry', field: 'industry', type: 'string' },
  ],
  measures: [{ name: 'account_count', aggregate: 'count' }],
};

/**
 * [#21177] A caller-supplied inline dataset whose dimension `field` is a raw
 * expression. Until #21177 the compiler passed it through verbatim and the real
 * engine ran it (the #16028 `translate()` fault this file once drove end to end);
 * now the caller-content gate refuses it at the door, before any strategy or
 * driver runs. The real-driver declaration and the door relay it once proved
 * jointly are each covered on their own: `driver-sql`'s
 * `sql-driver-16019-raw-statement-fault-envelope.test.ts` proves `SqlDriver`
 * declares the fault, and block 2 below proves this route relays a declared
 * `DATABASE_ERROR` / 500 with the prose withheld.
 */
const expressionDataset = {
  ...dataset,
  dimensions: [
    { name: 'industry', field: 'industry', type: 'string' },
    { name: 'folded_name', field: "translate(name, 'ABC', 'abc')", type: 'string' },
  ],
};

async function realDriver(): Promise<SqlDriver> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.initObjects([
    {
      name: 'crm_account',
      fields: {
        id: { type: 'text', name: 'id' },
        name: { type: 'text', name: 'name' },
        industry: { type: 'text', name: 'industry' },
      },
    } as any,
  ]);
  await driver.create('crm_account', { id: '1', name: 'Acme', industry: 'tech' });
  return driver;
}

/**
 * A REAL `AnalyticsService` on the native-SQL path, behind the bridge
 * `service-analytics/src/plugin.ts` wires when no `executeRawSql` is supplied:
 * `$n` placeholders → `?`, then `engine.execute` → `driver.execute`. The engine
 * layer adds driver SELECTION only, so the driver is called here directly.
 */
function realAnalytics(driver: SqlDriver): AnalyticsService {
  const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_object: string, sql: string, params: unknown[]) =>
      (await driver.execute(sql.replace(/\$(\d+)/g, '?'), params as any[])) as Record<string, unknown>[],
    isRegisteredObject: (n: string) => n === 'crm_account',
    getObjectFieldNames: (n: string) => (n === 'crm_account' ? ACCOUNT_FIELDS : undefined),
  });
}

let errored: string[] = [];
let warned: string[] = [];
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errored = [];
  warned = [];
  const collect = (sink: string[]) => (...args: unknown[]) => {
    sink.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  };
  consoleError = vi.spyOn(console, 'error').mockImplementation(collect(errored));
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(collect(warned));
});
afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#16019] a driver fault on the raw-SQL path reaches the caller by declaration — real compiler, real engine', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = await realDriver();
  });
  afterEach(async () => {
    await driver.disconnect();
  });

  it('[#21177 / #21220] a caller-supplied dimension-field expression is refused 400 VALIDATION_FAILED at the route\'s parse — before any strategy or driver runs', async () => {
    const execute = vi.spyOn(driver, 'execute');
    const route = buildRoute(async () => realAnalytics(driver));
    const res = await post(route, { dataset: expressionDataset, selection: { measures: ['account_count'], dimensions: ['folded_name'] } });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    // The contract's refusal, at the expression's own path (`detail` is the
    // parse's issue list, cut at 1000 characters — read, not re-parsed).
    expect(res.body.detail).toMatch(/"code":\s*"invalid_format"/);
    expect(res.body.detail).toMatch(/"path":\s*\[\s*"dimensions",\s*1,\s*"field"\s*\]/);
    // Caller text that names no column is refused before it is evaluated — the
    // driver never ran, so there is no driver fault line.
    expect(execute).not.toHaveBeenCalled();
    expect(warned.filter((m) => m.includes('[sql-driver] DATABASE_ERROR'))).toHaveLength(0);
    // ⛔ The refusal names the path, never the caller's `field` expression text
    // or a compiled statement. The statement check reads the keywords as the
    // strategies emit them (upper case): the prescription itself tells the
    // author, in prose, to "Group by the column itself".
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/translate/i);
    expect(body).not.toMatch(/\bSELECT\b|\bGROUP BY\b/);
  });

  it('POSITIVE CONTROL: a legitimate dataset on declared fields → 200 with rows', async () => {
    const route = buildRoute(async () => realAnalytics(driver));
    const res = await post(route, { dataset, selection: { measures: ['account_count'], dimensions: ['industry'] } });

    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ industry: 'tech', account_count: 1 }]);
    expect(warned.filter((m) => m.includes('[sql-driver] DATABASE_ERROR'))).toHaveLength(0);
  });

  // [#21177] The route's SAVED branch: `body.datasetName` loads the dataset from
  // metadata and calls the same `queryDataset`. [#21220] It parses the loaded
  // row through `DatasetSchema` first, exactly as it parses an inline one, so a
  // row stored before the contract narrowed is refused there. The expression
  // here is one SQLite can run, so without a refusal it would be served (200).
  it('[#21177 / #21220] a SAVED dataset (body.datasetName) whose dimension field is not a column reference is refused 400 VALIDATION_FAILED — nothing executed', async () => {
    const saved = {
      ...dataset,
      name: 'account_metrics_saved_expr',
      dimensions: [{ name: 'lowered_name', field: 'lower(name)', type: 'string' }],
    };
    const execute = vi.spyOn(driver, 'execute');
    const route = buildRoute(async () => realAnalytics(driver), [saved]);
    const res = await post(route, { datasetName: saved.name, selection: { measures: ['account_count'], dimensions: ['lowered_name'] } });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.detail).toMatch(/"code":\s*"invalid_format"/);
    expect(res.body.detail).toMatch(/"path":\s*\[\s*"dimensions",\s*0,\s*"field"\s*\]/);
    expect(execute).not.toHaveBeenCalled();
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/lower\(name\)/i);
  });

  it('[#21177] CONTROL: a SAVED plain-column dataset (body.datasetName) → 200 with rows', async () => {
    const execute = vi.spyOn(driver, 'execute');
    const route = buildRoute(async () => realAnalytics(driver), [dataset]);
    const res = await post(route, { datasetName: dataset.name, selection: { measures: ['account_count'], dimensions: ['industry'] } });

    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ industry: 'tech', account_count: 1 }]);
    expect(execute).toHaveBeenCalled();
  });
});

describe('[#16019] at the door: a declaration wins over the heuristic, and the heuristic stays as the fallback', () => {
  const selection = { measures: ['account_count'], dimensions: ['industry'] };
  const BARE = 'no such function: translate';
  const KNEX =
    `SELECT translate(name, 'ABC', 'abc') AS "folded_name", COUNT(*) AS "account_count" ` +
    `FROM "crm_account" GROUP BY translate(name, 'ABC', 'abc') - ${BARE}`;

  it("DECLARED, with a phrase the heuristic does not know → withheld, with the producer's code (the declared path wins)", async () => {
    // The control that makes this a test of the declaration and not of the list.
    expect(looksLikeInternalErrorLeak(BARE)).toBe(false);
    const declared = Object.assign(new Error(BARE), { code: 'DATABASE_ERROR', status: 500 });
    expect(declaresServerFault(declared)).toBe(true);

    const res = await post(buildRoute(async () => throwingAnalytics(declared)), { dataset, selection });

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('DATABASE_ERROR');
    expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    expect(JSON.stringify(res.body)).not.toContain('translate');
  });

  it('UNDECLARED, the knex shape → still withheld, by the fallback (the heuristic stays)', async () => {
    expect(looksLikeInternalErrorLeak(KNEX)).toBe(true);

    const res = await post(buildRoute(async () => throwingAnalytics(new Error(KNEX))), { dataset, selection });

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('ANALYTICS_QUERY_FAILED');
    expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    expect(JSON.stringify(res.body)).not.toContain('translate');
  });

  it("DECLARED, with a phrase the heuristic DOES know → the producer's code, not the fallback's (the ORDERING pin)", async () => {
    // The one shape that discriminates the order of the two arms: the message
    // trips `looksLikeInternalErrorLeak` AND the error declares. Declared-first
    // (③a before ③b, the door as written) answers the producer's code;
    // heuristic-first would answer `ANALYTICS_QUERY_FAILED` with the same
    // withheld text and this case alone would go red. The case above cannot
    // tell the two orders apart, because its message trips nothing.
    expect(looksLikeInternalErrorLeak(KNEX)).toBe(true);
    const declared = Object.assign(new Error(KNEX), { code: 'DATABASE_ERROR', status: 500 });
    expect(declaresServerFault(declared)).toBe(true);

    const res = await post(buildRoute(async () => throwingAnalytics(declared)), { dataset, selection });

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('DATABASE_ERROR');
    expect(res.body.code).not.toBe('ANALYTICS_QUERY_FAILED');
    expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    expect(JSON.stringify(res.body)).not.toContain('translate');
  });

  it("UNDECLARED, the bare shape → the fallback's coverage boundary, pinned as a live subject", async () => {
    // ⛔ Asserting the residual, not endorsing it — see the file header. A
    // producer that reaches this door with dialect text and no declaration is
    // outside every driver in this repo (an embedder's own `executeRawSql`);
    // the ruling's answer to it is a declaration, never a row in the list.
    expect(looksLikeInternalErrorLeak(BARE)).toBe(false);

    const res = await post(buildRoute(async () => throwingAnalytics(new Error(BARE))), { dataset, selection });

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('ANALYTICS_QUERY_FAILED');
    expect(res.body.error).toBe(BARE);
  });
});
