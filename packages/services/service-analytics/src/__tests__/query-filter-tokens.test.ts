// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';

/**
 * #12230 — `{current_user_id}` resolves on the DIRECT analytics door, on both
 * compiled surfaces, before either strategy compiles anything.
 *
 * framework#3582 gave the platform ONE evaluator of the `{token}` filter
 * vocabulary (`resolveFilterTokens`, `@objectstack/core`) and wired it into
 * the ObjectQL engine and into `DatasetExecutor` (the dashboard door). Two
 * gaps survived, both the same shape — one vocabulary, two verdicts:
 *
 *   1. The DIRECT door (`/api/v1/analytics/query` → `AnalyticsService.query`)
 *      resolved nothing itself. The ObjectQL strategy's engine bridge resolves
 *      downstream, but `NativeSQLStrategy` compiles a raw `SELECT … WHERE`
 *      and BOUND THE LITERAL — `owner = '{current_user_id}'` matches no row,
 *      and every user-scoped widget rendered a plausible zero ("you have no
 *      work") for every viewer, silently.
 *   2. The #10298 dataset-scope channel hands strategies the REGISTRY's
 *      compiled filter — shared across requests, never resolved. On the
 *      dashboard door the executor resolves its own copy into `where`, and
 *      the strategy then ANDed the unresolved twin as a conjunct:
 *      `owner = $viewer AND owner = '{current_user_id}'` selects nothing.
 *      The "redundant and idempotent" reasoning that justified the conjunct
 *      holds only for token-free filters.
 *
 * Both close at one seam: `AnalyticsService.query`/`generateSql` resolve the
 * query's own token positions (`where`, `timeDimensions[].dateRange`) and the
 * per-request dataset-scope getter, with one instant per call, BEFORE strategy
 * selection. The two compiled surfaces are asserted separately below:
 *
 *   - the SQL surface (`NativeSQLStrategy`) — assertions read the BOUND
 *     PARAMS, i.e. what the database actually compares against, and a real
 *     (sql.js) database returns real rows;
 *   - the in-memory surface (`ObjectQLStrategy` → the `executeAggregate`
 *     bridge to `engine.aggregate`) — assertions read the filter handed to
 *     the bridge, i.e. what the engine actually evaluates.
 *
 * ## The load-bearing pin: the per-viewer contrast
 *
 * This feature writes a VIEWER IDENTITY into a SQL `WHERE`. The failure that
 * matters is not "it didn't resolve" — it is resolving to the WRONG viewer: a
 * data leak wearing a working feature's clothes. So the pins here run the
 * SAME saved filter as two different users against the same service instance
 * and assert BOTH directions — A gets A's rows and none of B's, B gets B's
 * and none of A's. A single-user pin asserting "rows came back" cannot tell
 * correct per-request scoping from a token resolved once and served to
 * everyone (the registry-mutation shape `dataset-filter-tokens.test.ts`
 * already guards on the dashboard door).
 *
 * An unresolvable placeholder REFUSES loudly instead of charting zero, with
 * the resolver's ADR-0112 envelope asserted (`code` AND `status`): a refusal
 * an author can read beats a zero a rep believes.
 */

const CTX_A = { userId: 'usr_a', tenantId: 'org_9', timezone: 'UTC' } as ExecutionContext;
const CTX_B = { userId: 'usr_b', tenantId: 'org_9', timezone: 'UTC' } as ExecutionContext;
/** Authenticated org context with NO user — `{current_user_id}` cannot resolve. */
const CTX_ANON = { tenantId: 'org_9', timezone: 'UTC' } as ExecutionContext;

const THIS_YEAR_START = `${new Date().getUTCFullYear()}-01-01`;
const USER_TOKEN = '{current_user_id}';

const dataset = DatasetSchema.parse({
  name: 'my_open_cases',
  label: 'My Open Cases',
  object: 'case_record',
  dimensions: [
    { name: 'priority', field: 'priority', type: 'string' },
    { name: 'opened_at', field: 'opened_at', type: 'date' },
  ],
  measures: [{ name: 'open_cases', aggregate: 'count' }],
  filter: { owner: USER_TOKEN },
});

// ─────────────────────────────────────────────────────────────────────────────
// The SQL surface — what NativeSQLStrategy binds
// ─────────────────────────────────────────────────────────────────────────────

function sqlCaptureService(captured: { sql: string; params: unknown[] }[]) {
  return new AnalyticsService({
    datasets: [dataset],
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_o, sql, params) => {
      captured.push({ sql, params });
      return [{ priority: 'high', open_cases: 1 }];
    },
  });
}

const directQuery = (where: Record<string, unknown>): AnalyticsQuery => ({
  cube: 'my_open_cases',
  measures: ['open_cases'],
  dimensions: ['priority'],
  where,
});

describe('direct analytics door — SQL surface binds the viewer, never the literal (#12230)', () => {
  it('resolves {current_user_id} in a direct query where', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    await sqlCaptureService(captured).query(directQuery({ owner: USER_TOKEN }), CTX_A);

    expect(captured).toHaveLength(1);
    expect(captured[0].params).toContain('usr_a');
    expect(captured[0].params).not.toContain(USER_TOKEN);
  });

  it('per-viewer contrast at the binding seam: each call binds ITS caller, both directions', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const svc = sqlCaptureService(captured);

    await svc.query(directQuery({ owner: USER_TOKEN }), CTX_A);
    await svc.query(directQuery({ owner: USER_TOKEN }), CTX_B);

    expect(captured[0].params).toContain('usr_a');
    expect(captured[0].params).not.toContain('usr_b');
    expect(captured[1].params).toContain('usr_b');
    expect(captured[1].params).not.toContain('usr_a');
    for (const c of captured) expect(c.params).not.toContain(USER_TOKEN);
  });

  it('resolves a date macro in a direct query timeDimensions dateRange', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    await sqlCaptureService(captured).query(
      {
        cube: 'my_open_cases',
        measures: ['open_cases'],
        timeDimensions: [
          { dimension: 'opened_at', dateRange: ['{current_year_start}', '{today}'] },
        ],
      } as AnalyticsQuery,
      CTX_A,
    );

    const all = captured.flatMap((c) => c.params);
    expect(all).toContain(THIS_YEAR_START);
    expect(all).not.toContain('{current_year_start}');
    expect(all).not.toContain('{today}');
  });

  it("the #10298 dataset-scope conjunct binds the VIEWER's id on the direct door", async () => {
    // No `where` at all: the only token in play is the registered dataset's
    // own intrinsic filter, which reaches the strategy through
    // `getDatasetScope` — the channel that used to hand out the raw registry
    // copy.
    const captured: { sql: string; params: unknown[] }[] = [];
    const svc = sqlCaptureService(captured);

    await svc.query({ cube: 'my_open_cases', measures: ['open_cases'], dimensions: ['priority'] }, CTX_A);
    await svc.query({ cube: 'my_open_cases', measures: ['open_cases'], dimensions: ['priority'] }, CTX_B);

    expect(captured[0].params).toContain('usr_a');
    expect(captured[1].params).toContain('usr_b');
    expect(captured[1].params).not.toContain('usr_a');
    for (const c of captured) expect(c.params).not.toContain(USER_TOKEN);
  });

  it('the dashboard door never binds the literal beside the resolved id (the double-predicate hole)', async () => {
    // Before the fix this door bound BOTH: the executor's resolved copy in
    // `where` and the registry's literal through the dataset-scope conjunct —
    // `owner = $viewer AND owner = '{current_user_id}'`, zero rows, silently.
    // `toContain('usr_a')` alone stayed green through that; the absence
    // assertion is the pin.
    const captured: { sql: string; params: unknown[] }[] = [];
    await sqlCaptureService(captured).queryDataset(
      dataset,
      { dimensions: ['priority'], measures: ['open_cases'] },
      CTX_A,
    );

    expect(captured.length).toBeGreaterThan(0);
    for (const c of captured) {
      expect(c.params).toContain('usr_a');
      expect(c.params).not.toContain(USER_TOKEN);
    }
  });

  it('generateSql (the dry-run door) shows the statement that would really run', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const { params } = await sqlCaptureService(captured).generateSql(
      directQuery({ owner: USER_TOKEN }),
      CTX_A,
    );

    expect(params).toContain('usr_a');
    expect(params).not.toContain(USER_TOKEN);
  });
});

describe('direct analytics door — unresolvable placeholders refuse loudly (#12230, ADR-0112)', () => {
  it('an unknown token refuses with FILTER_TOKEN_UNKNOWN / 400 before any SQL runs', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const err = await sqlCaptureService(captured)
      .query(directQuery({ owner: '{current_user}' }), CTX_A)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe('FILTER_TOKEN_UNKNOWN');
    expect((err as { status?: number }).status).toBe(400);
    // The near-miss suggestion is the actionable half of the message.
    expect((err as Error).message).toContain('{current_user_id}');
    expect(captured).toHaveLength(0);
  });

  it('a vocabulary token with no value refuses with FILTER_TOKEN_UNRESOLVED / 400, never IS NULL', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const err = await sqlCaptureService(captured)
      .query(directQuery({ owner: USER_TOKEN }), CTX_ANON)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe('FILTER_TOKEN_UNRESOLVED');
    expect((err as { status?: number }).status).toBe(400);
    expect(captured).toHaveLength(0);
  });

  it('generateSql refuses identically — the dry run answers what the real run would', async () => {
    const err = await sqlCaptureService([])
      .generateSql(directQuery({ owner: '{current_user}' }), CTX_A)
      .catch((e: unknown) => e);

    expect((err as { code?: string }).code).toBe('FILTER_TOKEN_UNKNOWN');
    expect((err as { status?: number }).status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The in-memory surface — what the ObjectQL aggregate bridge receives
// ─────────────────────────────────────────────────────────────────────────────

interface CaseRow {
  id: string;
  owner: string;
  priority: string;
  [key: string]: unknown;
}

const ROWS: CaseRow[] = [
  { id: 'c1', owner: 'usr_a', priority: 'high' },
  { id: 'c2', owner: 'usr_a', priority: 'high' },
  { id: 'c3', owner: 'usr_b', priority: 'low' },
];

/**
 * Just enough of the engine's filter semantics for this fixture: `$and`
 * arrays, direct equality, `$eq`. Anything else in the captured condition
 * would fail the equality assertions below rather than silently pass.
 */
function rowMatches(row: CaseRow, cond: unknown): boolean {
  if (cond == null || typeof cond !== 'object') return true;
  return Object.entries(cond as Record<string, unknown>).every(([k, v]) => {
    if (k === '$and') return (v as unknown[]).every((c) => rowMatches(row, c));
    if (v !== null && typeof v === 'object' && '$eq' in (v as object)) {
      return row[k] === (v as { $eq: unknown }).$eq;
    }
    return row[k] === v;
  });
}

describe('direct analytics door — in-memory surface (ObjectQL aggregate bridge) (#12230)', () => {
  function bridgeService(captured: { object: string; filter: unknown }[]) {
    return new AnalyticsService({
      datasets: [dataset],
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (object, opts) => {
        captured.push({ object, filter: opts.filter });
        const matched = ROWS.filter((r) => rowMatches(r, opts.filter));
        const buckets = new Map<string, number>();
        for (const r of matched) buckets.set(r.priority, (buckets.get(r.priority) ?? 0) + 1);
        return [...buckets].map(([priority, n]) => ({ priority, open_cases: n }));
      },
    });
  }

  it('per-viewer contrast over real rows: each viewer sees exactly their own, both directions', async () => {
    const captured: { object: string; filter: unknown }[] = [];
    const svc = bridgeService(captured);

    const asA = await svc.query(directQuery({ owner: USER_TOKEN }), CTX_A);
    const asB = await svc.query(directQuery({ owner: USER_TOKEN }), CTX_B);

    // The bridge — what `engine.aggregate` would evaluate — carries the
    // resolved viewer, never the literal, and never the OTHER viewer.
    expect(JSON.stringify(captured[0].filter)).toContain('usr_a');
    expect(JSON.stringify(captured[0].filter)).not.toContain('usr_b');
    expect(JSON.stringify(captured[1].filter)).toContain('usr_b');
    expect(JSON.stringify(captured[1].filter)).not.toContain('usr_a');
    for (const c of captured) expect(JSON.stringify(c.filter)).not.toContain(USER_TOKEN);

    // Row-level, both directions: A's two high-priority cases and nothing of
    // B's; B's one low-priority case and nothing of A's.
    expect(asA.rows).toEqual([{ priority: 'high', open_cases: 2 }]);
    expect(asA.rows.some((r) => r.priority === 'low')).toBe(false);
    expect(asB.rows).toEqual([{ priority: 'low', open_cases: 1 }]);
    expect(asB.rows.some((r) => r.priority === 'high')).toBe(false);
  });

  it('refuses an unknown token before the bridge is reached', async () => {
    const captured: { object: string; filter: unknown }[] = [];
    const err = await bridgeService(captured)
      .query(directQuery({ owner: '{current_user}' }), CTX_A)
      .catch((e: unknown) => e);

    expect((err as { code?: string }).code).toBe('FILTER_TOKEN_UNKNOWN');
    expect((err as { status?: number }).status).toBe(400);
    expect(captured).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End to end — a real database, real rows, two real viewers
// ─────────────────────────────────────────────────────────────────────────────

/** Point sql.js at the `.wasm` shipped inside its own package (Node-safe). */
async function locateWasm(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    return (file: string) => join(dirname(pkgJsonPath), 'dist', file);
  } catch {
    return undefined;
  }
}

describe('per-viewer contrast on a real database — the same saved filter, two users (#12230)', () => {
  let db: any;
  let svc: AnalyticsService;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`CREATE TABLE "case_record" ("id" TEXT PRIMARY KEY, "owner" TEXT, "priority" TEXT);`);
    const insert = db.prepare(`INSERT INTO "case_record" ("id","owner","priority") VALUES (?,?,?)`);
    for (const r of ROWS) insert.run([r.id, r.owner, r.priority]);
    insert.free();

    svc = new AnalyticsService({
      datasets: [dataset],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_object, sql, params) => {
        const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
        stmt.bind(params as any[]);
        const out: Record<string, unknown>[] = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        return out;
      },
    });
  });

  afterAll(() => {
    db?.close();
  });

  it('the dashboard door: one saved dataset, each viewer gets their rows and none of the other viewer\'s', async () => {
    const asA = await svc.queryDataset(dataset, { dimensions: ['priority'], measures: ['open_cases'] }, CTX_A);
    const asB = await svc.queryDataset(dataset, { dimensions: ['priority'], measures: ['open_cases'] }, CTX_B);

    expect(asA.rows).toEqual([{ priority: 'high', open_cases: 2 }]);
    expect(asA.rows.some((r) => r.priority === 'low')).toBe(false);
    expect(asB.rows).toEqual([{ priority: 'low', open_cases: 1 }]);
    expect(asB.rows.some((r) => r.priority === 'high')).toBe(false);
  });

  it('the direct door: same contrast through AnalyticsService.query', async () => {
    const asA = await svc.query(directQuery({ owner: USER_TOKEN }), CTX_A);
    const asB = await svc.query(directQuery({ owner: USER_TOKEN }), CTX_B);

    expect(asA.rows).toEqual([{ priority: 'high', open_cases: 2 }]);
    expect(asB.rows).toEqual([{ priority: 'low', open_cases: 1 }]);
  });
});
