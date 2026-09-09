// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16019] `POST /analytics/dataset/query` — a driver fault on the raw-SQL path
 * reaches the caller by DECLARATION, and the declaration wins over the
 * phrasing heuristic.
 *
 * ## The two shapes, and why this file drives the real driver
 *
 * The card was filed on a hand-made `Error('no such function: translate')` and
 * re-scoped when the Clause-② review of PR #16020 measured the shape production
 * actually raises — knex's `<statement> - no such function: translate` — and
 * found it withheld already, by accident: `looksLikeInternalErrorLeak` fires on
 * the `select ` prefix, never on the phrase. On `origin/main`:
 *
 * | shape reaching the door                       | body                                                  |
 * |-----------------------------------------------|-------------------------------------------------------|
 * | bare `Error('no such function: translate')`   | `500 ANALYTICS_QUERY_FAILED`, raw engine text         |
 * | knex-shaped — what `SqlDriver.execute` raised | `500 ANALYTICS_QUERY_FAILED`, `Internal server error` |
 *
 * Both were UNDECLARED. Under the 2026-09-06 ruling (decision batch #57,
 * option 3) `SqlDriver.execute()` declares the fault — `DATABASE_ERROR`/500,
 * the dialect error under a non-enumerable `cause` — and this door's ③a arm
 * relays a declared 5xx with the producer's code and `INTERNAL_ERROR_MESSAGE`.
 * The first block drives that END TO END: a real `AnalyticsService` on the
 * native-SQL strategy, a real better-sqlite3 `SqlDriver` behind the exact
 * bridge `service-analytics`'s plugin wires (`engine.execute` → `driver.execute`),
 * and a dataset dimension whose expression calls `translate()` — the function
 * SQLite lacks, the #16028 fault verbatim — so the refusal is the ENGINE's,
 * not a fixture's, and the compiled statement is the real one.
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
 * Restore the bare `await builder` in `SqlDriver.execute()` and REBUILD
 * driver-sql: the first block's `DATABASE_ERROR` assertions go RED
 * (`ANALYTICS_QUERY_FAILED` returns) while its `INTERNAL_ERROR_MESSAGE`
 * assertion stays GREEN — the accident the re-scope measured, the heuristic's
 * `select ` limb — and the driver-log assertion goes RED (the driver no longer
 * logs; the route's `logError` becomes the only copy). The second block stays
 * GREEN throughout: it hands the door shapes that never touch the driver.
 *
 * The ORDERING pin in block 2 has its own leg: gate the door's ③a relay
 * behind `looksLikeInternalErrorLeak` being false (i.e. consult the heuristic
 * first) and only that case goes RED (`ANALYTICS_QUERY_FAILED` in place of the
 * producer's code); the neighbouring "phrase the heuristic does not know"
 * case stays GREEN, which is precisely why it could not stand in for this one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { AnalyticsService } from '@objectstack/service-analytics';
import { SqlDriver } from '@objectstack/driver-sql';
import { INTERNAL_ERROR_MESSAGE, declaresServerFault, looksLikeInternalErrorLeak } from '@objectstack/types';
import { RestServer } from './rest-server';

// ── harness (the shape `analytics-dataset-dimension-gate.test.ts` uses) ──────

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
function mockProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
  };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

function buildRoute(analyticsProvider?: any) {
  const rest = new RestServer(
    mockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
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
 * One plain dimension for the control, and one whose expression calls the
 * function SQLite lacks. The compiler passes an expression through verbatim
 * (`qualifyAndRegisterJoin` leaves anything that is not a bare identifier or
 * a dotted path alone) and the source-field gate judges bare identifiers only,
 * so this is the real statement the strategy emits, refused by the real engine.
 */
const dataset = {
  name: 'account_metrics',
  label: 'Account metrics',
  object: 'crm_account',
  dimensions: [
    { name: 'industry', field: 'industry', type: 'string' },
    { name: 'folded_name', field: "translate(name, 'ABC', 'abc')", type: 'string' },
  ],
  measures: [{ name: 'account_count', aggregate: 'count' }],
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

  it('the statement SQLite refuses answers 500 DATABASE_ERROR with the prose withheld — the ③a relay, not ③b', async () => {
    const route = buildRoute(async () => realAnalytics(driver));
    const res = await post(route, { dataset, selection: { measures: ['account_count'], dimensions: ['folded_name'] } });

    expect(res.statusCode).toBe(500);
    // The producer's code, relayed — where an undeclared fault answered the
    // route's generic one.
    expect(res.body.code).toBe('DATABASE_ERROR');
    expect(res.body.code).not.toBe('ANALYTICS_QUERY_FAILED');
    expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/translate/i);
    expect(body).not.toMatch(/no such function/i);
    expect(body).not.toMatch(/SELECT|GROUP BY|crm_account/i);
  });

  it('the operator keeps the whole diagnostic: the driver logged the statement and the engine text, the route logged the envelope', async () => {
    const route = buildRoute(async () => realAnalytics(driver));
    await post(route, { dataset, selection: { measures: ['account_count'], dimensions: ['folded_name'] } });

    // The driver's warn line is now the only copy of the dialect text.
    const driverLine = warned.find((m) => m.includes('[sql-driver] DATABASE_ERROR'));
    expect(driverLine).toBeDefined();
    expect(driverLine).toContain('no such function: translate');
    expect(driverLine).toMatch(/translate\(name, 'ABC', 'abc'\)/i);
    // The route still logs the fault it relayed — the composed envelope, which
    // names no statement (`logError` prints `error.message`).
    const routeLine = errored.find((m) => m.includes('[REST] Analytics dataset query error'));
    expect(routeLine).toBeDefined();
    expect(routeLine).toContain('refused to run a raw statement');
    expect(routeLine).not.toContain('no such function');
  });

  it('POSITIVE CONTROL: the same wiring with the plain dimension → 200 with rows', async () => {
    const route = buildRoute(async () => realAnalytics(driver));
    const res = await post(route, { dataset, selection: { measures: ['account_count'], dimensions: ['industry'] } });

    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ industry: 'tech', account_count: 1 }]);
    expect(warned.filter((m) => m.includes('[sql-driver] DATABASE_ERROR'))).toHaveLength(0);
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
