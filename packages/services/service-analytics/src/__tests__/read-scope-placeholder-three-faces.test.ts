// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20075] ONE read scope, ONE placeholder verdict — the same resolved values
 * and rows, or the same withheld refusal, on all three analytics faces.
 *
 * The ObjectQL EXECUTE face hands a `getReadScope` output to the engine, which
 * resolves `{current_user_id}` and the date macros with the caller's context
 * (`ObjectQL.resolveWhereTokens` → `resolveFilterTokens`), and since #19995 a
 * placeholder the engine cannot resolve is refused as
 * `READ_SCOPE_COMPILE_FAILED` / 500, message withheld. The NativeSQL EXECUTE
 * face (`NativeSQLStrategy.applyReadScope`, every hop) and the
 * `/analytics/sql` ECHO (`ObjectQLStrategy.generateSql`) lower the scope
 * through `compileScopedFilterToSql`, which bound the placeholder as its
 * literal text.
 *
 * ## MEASURED on the pre-fix tree, rows EXECUTED
 *
 * One `SqliteWasmDriver`; a real `ObjectQL` behind the ObjectQL face; the
 * echo's SQL run on the same database; every face driven through
 * `AnalyticsService` with the caller `{ userId: 'u_me' }`. Measured on
 * `a8bcce69c8` (the branch's first commit carries the full table, the joined
 * hop and both HTTP doors):
 *
 * | read scope                              | ObjectQL execute | echo (SQL run)  | native execute  |
 * |-----------------------------------------|------------------|-----------------|-----------------|
 * | `owner = {current_user_id}`             | d1 d3            | none            | none            |
 * | `owner $ne {current_user_id}`           | d2 d4            | d1 d2 d3 d4     | d1 d2 d3 d4     |
 * | `owner $in [{current_user_id}, …]`      | d1 d3            | none            | none            |
 * | `closed_on $lt {today}`                 | d1 d3            | d1 d2 d3        | d1 d2 d3        |
 * | an unknown `{token}`                    | 500 withheld     | served, none    | served, none    |
 * | `{current_org_id}`, no active org       | 500 withheld     | served, none    | served, none    |
 *
 * The `$ne` row is a WIDENING on two faces: the literal matches nobody, so the
 * exclusion admitted the caller's own rows too.
 *
 * ## The fix, and what must NOT move
 *
 * `compileScopedFilterToSql` resolves the scope with the engine's resolver over
 * the strategy's `ctx.context` before lowering it, so every face binds the
 * value the engine resolves and refuses what it refuses. A scope without a
 * placeholder, and the caller's own `where`, are untouched: both are pinned
 * below. The ordering, and the context-less answer of the public export, are
 * pinned with them.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { declaredRefusalMessage, resolveThrownHttpError, serverFaultProvenance } from '@objectstack/types';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { FilterCondition } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';

import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

const BASE = 'deal';
const REF = 'account';

const BASE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  region: { type: 'text', name: 'region' },
  owner: { type: 'text', name: 'owner' },
  account: { type: 'text', name: 'account' },
  closed_on: { type: 'date', name: 'closed_on' },
};
const REF_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  tier: { type: 'text', name: 'tier' },
  owner: { type: 'text', name: 'owner' },
  closed_on: { type: 'date', name: 'closed_on' },
};

/** Dates far either side of any run date, so `{today}` splits them the same way on every day. */
const BASE_ROWS = [
  { id: 'd1', region: 'emea', owner: 'u_me', account: 'acc_gold', closed_on: '2020-01-10' },
  { id: 'd2', region: 'apac', owner: 'u_other', account: 'acc_silver', closed_on: '2099-02-10' },
  { id: 'd3', region: 'amer', owner: 'u_me', account: 'acc_gold', closed_on: '2020-03-10' },
  { id: 'd4', region: 'emea', owner: null, account: 'acc_silver', closed_on: null },
];
const REF_ROWS = [
  { id: 'acc_gold', tier: 'gold', owner: 'u_me', closed_on: '2020-01-01' },
  { id: 'acc_silver', tier: 'silver', owner: 'u_other', closed_on: '2099-01-01' },
];
const ALL = ['d1', 'd2', 'd3', 'd4'];

const dataset = DatasetSchema.parse({
  name: 'deal_pipeline',
  label: 'Deal pipeline',
  object: BASE,
  include: [REF],
  dimensions: [
    { name: 'id', field: 'id', type: 'string' },
    { name: 'account_tier', field: 'account.tier', type: 'string' },
  ],
  measures: [{ name: 'deal_count', aggregate: 'count' }],
});

/** The base table alone: one scope, on `deal`. */
const DIRECT: AnalyticsQuery = { cube: 'deal_pipeline', dimensions: ['id'], measures: ['deal_count'] };
/** A joined dimension: the NativeSQL face compiles the `account` hop's scope too. */
const CROSS: AnalyticsQuery = { cube: 'deal_pipeline', dimensions: ['account_tier'], measures: ['deal_count'] };

/** A caller with a user and no active organization. */
const MEMBER = { userId: 'u_me' } as ExecutionContext;

interface WireBearingError extends Error {
  code?: unknown;
  status?: unknown;
}

/** One face's outcome: a refusal, or what the face served. */
type Outcome = { refusal?: WireBearingError; admitted?: string[] };

const quiet = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return quiet;
  },
};

/**
 * Scopes whose placeholder the context resolves, each beside its literal
 * TWIN (the scope with the value written in) and the rows both admit. Every
 * field named exists on both tables, so each scope also serves as a hop scope.
 */
const RESOLVED: Array<{ name: string; scope: unknown; twin: unknown; rows: string[] }> = [
  {
    name: 'a context token in the equality slot',
    scope: { owner: '{current_user_id}' },
    twin: { owner: 'u_me' },
    rows: ['d1', 'd3'],
  },
  {
    name: 'a context token under $ne',
    scope: { owner: { $ne: '{current_user_id}' } },
    twin: { owner: { $ne: 'u_me' } },
    rows: ['d2', 'd4'],
  },
  {
    name: 'a context token as an $in member',
    scope: { owner: { $in: ['{current_user_id}', 'u_nobody'] } },
    twin: { owner: { $in: ['u_me', 'u_nobody'] } },
    rows: ['d1', 'd3'],
  },
  {
    name: 'a date macro',
    scope: { closed_on: { $lt: '{today}' } },
    twin: { closed_on: { $lt: '2050-01-01' } },
    rows: ['d1', 'd3'],
  },
];

/** Scopes whose placeholder the resolver refuses, and what its sentence names for the log. */
const REFUSED: Array<{ name: string; scope: unknown; secret: string }> = [
  { name: 'an unknown placeholder', scope: { owner: '{restricted_token}' }, secret: 'restricted_token' },
  { name: 'a near-miss spelling', scope: { owner: '{current_user}' }, secret: 'current_user' },
  {
    name: 'a known context token the request has no value for',
    scope: { owner: '{current_org_id}' },
    secret: 'current_org_id',
  },
  {
    name: 'an unknown placeholder as an $in member, nested in an $or beside a well-formed arm',
    scope: { $or: [{ owner: 'u_me' }, { owner: { $in: ['u_other', '{restricted_owner}'] } }] },
    secret: 'restricted_owner',
  },
  { name: 'an unknown placeholder under $ne', scope: { owner: { $ne: '{restricted_token}' } }, secret: 'restricted_token' },
];

describe('[#20075] one read scope, one placeholder verdict — ObjectQL / echo / native agree', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  /** The ObjectQL face and its echo: `ObjectQLStrategy`, the engine behind it. */
  let objectql: AnalyticsService;
  /** The NativeSQL face: `NativeSQLStrategy`, statements run on the same database. */
  let native: AnalyticsService;
  /** Swapped per case; the `getReadScope` contract filled by hand, never by the RLS compiler. */
  let scopes: Record<string, unknown> = {};
  /** Statements the NativeSQL face handed to the database — a refusal must precede execution. */
  let rawStatements = 0;

  const runRawSql = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
    const result = await driver.execute(sql.replace(/\$\d+/g, '?'), params as unknown[]);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
      return (result as { rows: Record<string, unknown>[] }).rows;
    }
    return [];
  };

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([
      { name: BASE, fields: BASE_FIELDS },
      { name: REF, fields: REF_FIELDS },
    ] as never);
    for (const row of BASE_ROWS) await driver.create(BASE, { ...row });
    for (const row of REF_ROWS) await driver.create(REF, { ...row });

    engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: BASE, label: 'Deal', fields: BASE_FIELDS } as never);
    engine.registerObject({ name: REF, label: 'Account', fields: REF_FIELDS } as never);

    const compiled = compileDataset(dataset);
    const common = {
      cubes: [compiled.cube],
      logger: quiet,
      getAllowedRelationships: () => compiled.allowedRelationships,
      getReadScope: (object: string) => (scopes[object] ?? undefined) as FilterCondition | undefined,
      // The auto-bridge's own mapping (`plugin.ts`), the request context
      // forwarded: the context the engine's placeholder resolver reads.
      executeAggregate: async (objectName: string, options: Record<string, any>) =>
        (await engine.aggregate(objectName, {
          where: options.filter,
          groupBy: options.groupBy,
          aggregations: options.aggregations?.map((a: Record<string, unknown>) => ({
            function: a.method,
            field: a.field,
            alias: a.alias,
          })),
          context: options.context,
        } as never)) as Record<string, unknown>[],
    };
    objectql = new AnalyticsService({
      ...common,
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    } as never);
    native = new AnalyticsService({
      ...common,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
        rawStatements += 1;
        return runRawSql(sql, params);
      },
    } as never);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  afterEach(() => {
    scopes = {};
  });

  const ids = (rows: Array<Record<string, unknown>>): string[] => rows.map((r) => String(r.id)).sort();
  /** `tier=count`, order-free: a hop's answer in the shape its face gives it. */
  const tiers = (rows: Array<Record<string, unknown>>): string[] =>
    rows.map((r) => `${String(r.account_tier)}=${String(r.deal_count)}`).sort();

  const query = (base: AnalyticsQuery, where?: unknown): AnalyticsQuery =>
    ({ ...base, ...(where ? { where } : {}) }) as AnalyticsQuery;

  // Each face takes `null` for "the request has no context": an explicit
  // `undefined` would select the default caller instead.

  /** Face 1 — ObjectQL EXECUTE (the engine resolves; #19995's door). */
  const objectqlFace = async (scope: unknown, where?: unknown, context: ExecutionContext | null = MEMBER): Promise<Outcome> => {
    scopes = scope == null ? {} : { [BASE]: scope };
    try {
      return { admitted: ids((await objectql.query(query(DIRECT, where), context ?? undefined)).rows) };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  /** Face 2 — the `/analytics/sql` ECHO of the ObjectQL strategy, its SQL then EXECUTED. */
  const echoFace = async (scope: unknown, where?: unknown, context: ExecutionContext | null = MEMBER): Promise<Outcome> => {
    scopes = scope == null ? {} : { [BASE]: scope };
    try {
      const { sql, params } = await objectql.generateSql(query(DIRECT, where), context ?? undefined);
      return { admitted: ids(await runRawSql(sql, params)) };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  /** Face 3 — NativeSQL EXECUTE (`applyReadScope` → `executeRawSql`): real rows. */
  const nativeFace = async (scope: unknown, where?: unknown, context: ExecutionContext | null = MEMBER): Promise<Outcome> => {
    scopes = scope == null ? {} : { [BASE]: scope };
    try {
      return { admitted: ids((await native.query(query(DIRECT, where), context ?? undefined)).rows) };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  const FACES = [
    ['objectql', objectqlFace],
    ['echo', echoFace],
    ['native', nativeFace],
  ] as const;

  /** The joined hop: the `account` scope, on the face `service` serves. */
  const hop = async (service: AnalyticsService, scope: unknown): Promise<Outcome> => {
    scopes = { [REF]: scope };
    try {
      return { admitted: tiers((await service.query(CROSS, MEMBER)).rows) };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  /** The #5367 envelope, and the reads every analytics HTTP door takes before relaying prose. */
  const expectWithheldRefusal = (face: string, o: Outcome, secret?: string): void => {
    expect(o.admitted, `${face}: expected a refusal, got rows`).toBeUndefined();
    expect(o.refusal, `${face}: expected an Error`).toBeInstanceOf(Error);
    expect(o.refusal?.code, `${face}: envelope code`).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(o.refusal?.status, `${face}: envelope status`).toBe(500);
    expect(serverFaultProvenance(resolveThrownHttpError(o.refusal, 500)), `${face}: provenance`).toBe('declared');
    expect(declaredRefusalMessage(o.refusal), `${face}: relayed prose`).toBeUndefined();
    // Relocated, not deleted: the operator's log still has the detail.
    if (secret) expect(String(o.refusal?.message), `${face}: log detail`).toContain(secret);
  };

  // ── Fixture honesty ────────────────────────────────────────────────────────

  it('CONTROL: with no scope, every face serves the whole fixture', async () => {
    for (const [face, run] of FACES) {
      const o = await run(null);
      expect(o.refusal?.message, `${face}: fixture control refusal`).toBeUndefined();
      expect(o.admitted, `${face}: fixture control`).toEqual(ALL);
    }
  });

  // ── Resolved placeholders — the rows of the literal twin, on every face ───

  for (const c of RESOLVED) {
    it(`${c.name}: every face admits exactly what its literal twin admits`, async () => {
      for (const [face, run] of FACES) {
        const twin = await run(c.twin);
        expect(twin.admitted, `${face}: twin control`).toEqual(c.rows);
        const o = await run(c.scope);
        expect(o.refusal?.message, `${face}: unexpected refusal`).toBeUndefined();
        expect(o.admitted, `${face}: admitted set`).toEqual(c.rows);
      }
    });
  }

  it('both echoes print the value that ran, never the placeholder', async () => {
    for (const service of [objectql, native]) {
      scopes = { [BASE]: { owner: { $ne: '{current_user_id}' } } };
      const scoped = await service.generateSql(DIRECT, MEMBER);
      scopes = { [BASE]: { owner: { $ne: 'u_me' } } };
      const twin = await service.generateSql(DIRECT, MEMBER);
      expect(scoped).toEqual(twin);
      scopes = { [BASE]: { closed_on: { $lt: '{today}' } } };
      const { params } = await service.generateSql(DIRECT, MEMBER);
      expect(params).toHaveLength(1);
      expect(String(params[0])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('the joined hop: each face answers a placeholder scope exactly as its literal twin', async () => {
    // The two strategies shape a hop differently by design (NativeSQL filters
    // the base rows; the ObjectQL cross-object path buckets an out-of-scope
    // referent as RESTRICTED), so each is held to its own twin.
    for (const c of RESOLVED) {
      for (const [face, service] of [['native', native], ['objectql', objectql]] as const) {
        const twin = await hop(service, c.twin);
        const o = await hop(service, c.scope);
        expect(twin.refusal?.message, `${face} hop / ${c.name}: twin refusal`).toBeUndefined();
        expect(o.refusal?.message, `${face} hop / ${c.name}: refusal`).toBeUndefined();
        expect(o.admitted, `${face} hop / ${c.name}`).toEqual(twin.admitted);
      }
    }
  });

  // ── Refused placeholders — the one withheld envelope, on every face ──────

  for (const c of REFUSED) {
    it(`${c.name} is refused on all three faces and both hops, in the one withheld envelope`, async () => {
      for (const [face, run] of FACES) {
        expectWithheldRefusal(face, await run(c.scope), c.secret);
      }
      expectWithheldRefusal('native hop', await hop(native, c.scope), c.secret);
      expectWithheldRefusal('objectql hop', await hop(objectql, c.scope), c.secret);
    });
  }

  it('the native face refuses before any statement reaches the database', async () => {
    for (const c of REFUSED) {
      const before = rawStatements;
      const o = await nativeFace(c.scope);
      expect(o.refusal?.code, c.name).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(rawStatements - before, `${c.name}: statements executed`).toBe(0);
    }
  });

  // ── No context — the engine's context-less answer, on every face ─────────

  it('with no request context, a context token is refused and a date macro is served, on every face', async () => {
    for (const [face, run] of FACES) {
      expectWithheldRefusal(face, await run({ owner: '{current_user_id}' }, undefined, null), 'current_user_id');
      const o = await run({ closed_on: { $lt: '{today}' } }, undefined, null);
      expect(o.refusal?.message, `${face}: unexpected refusal`).toBeUndefined();
      expect(o.admitted, face).toEqual(['d1', 'd3']);
    }
  });

  // ── Door-distinguishable messages — the refusal is raised after the gates ─

  it('a scope another gate also refuses keeps that gate’s sentence', async () => {
    // The lowering's own gate, on the two faces that lower.
    for (const run of [echoFace, nativeFace]) {
      const o = await run({ region: { $eq: ['emea', 'amer'] }, owner: '{restricted_token}' });
      expect(o.refusal?.code).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(String(o.refusal?.message)).toContain('array value for "region".$eq');
      expect(String(o.refusal?.message)).not.toContain('filter placeholder');
    }
    // The shared comparand faces, on all three: the engine runs them before it resolves.
    for (const [face, run] of FACES) {
      const o = await run({ region: { $in: ['emea', null] }, owner: '{restricted_token}' });
      expect(String(o.refusal?.message), face).toContain('carries a comparand the engine refuses');
      expect(String(o.refusal?.message), face).not.toContain('filter placeholder');
    }
  });

  it('a placeholder alone carries the resolver’s sentence, the same on all three faces', async () => {
    for (const [face, run] of FACES) {
      const o = await run({ owner: '{restricted_token}' });
      expect(String(o.refusal?.message), face).toContain('carries a filter placeholder the engine cannot resolve');
    }
  });

  // ── The caller's own `where` — untouched ─────────────────────────────────

  it('CONTROL: a caller `where` placeholder resolves, beside a scope placeholder, on every face', async () => {
    for (const [face, run] of FACES) {
      const o = await run({ owner: '{current_user_id}' }, { closed_on: { $lt: '{today}' } });
      expect(o.refusal?.message, `${face}: unexpected refusal`).toBeUndefined();
      expect(o.admitted, face).toEqual(['d1', 'd3']);
    }
  });

  it('CONTROL: a caller `where` with an unknown placeholder stays FILTER_TOKEN_UNKNOWN / 400, scope or none', async () => {
    for (const [face, run] of FACES) {
      for (const scope of [null, { owner: { $in: ['u_me', 'u_other'] } }]) {
        const o = await run(scope, { owner: '{caller_token}' });
        expect(o.refusal?.code, face).toBe('FILTER_TOKEN_UNKNOWN');
        expect(o.refusal?.status, face).toBe(400);
        expect(String(o.refusal?.message), face).toContain('caller_token');
      }
    }
  });
});

// ── The public export itself ────────────────────────────────────────────────

describe('[#20075] `compileScopedFilterToSql` — the public export', () => {
  const compile = (scope: unknown, options: Parameters<typeof compileScopedFilterToSql>[2] = {}) =>
    compileScopedFilterToSql(scope as FilterCondition, 'deal', options);

  const refusalOf = (run: () => unknown): WireBearingError | undefined => {
    try {
      run();
      return undefined;
    } catch (e) {
      return e as WireBearingError;
    }
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Placeholder-free scopes, with the exact SQL and parameters they compiled to
   * before this change. A value that merely CONTAINS braces is not a
   * placeholder and is bound as written.
   */
  const UNCHANGED: Array<{ scope: unknown; sql: string; params: unknown[] }> = [
    { scope: { owner: 'u_me' }, sql: '"deal"."owner" = ?', params: ['u_me'] },
    {
      scope: { owner: { $ne: 'u_me' } },
      sql: '("deal"."owner" IS NULL OR "deal"."owner" <> ?)',
      params: ['u_me'],
    },
    { scope: { region: { $in: ['emea', 'amer'] } }, sql: '"deal"."region" IN (?, ?)', params: ['emea', 'amer'] },
    {
      scope: { $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] },
      sql: '(1 = 0 OR "deal"."owner" = ?)',
      params: ['u_me'],
    },
    { scope: { region: 'emea {q3}' }, sql: '"deal"."region" = ?', params: ['emea {q3}'] },
    { scope: { closed_on: { $lt: '2050-01-01' } }, sql: '"deal"."closed_on" < ?', params: ['2050-01-01'] },
  ];

  it('a scope with no placeholder compiles byte-for-byte as before, with a context or without one', () => {
    for (const c of UNCHANGED) {
      expect(compile(c.scope), JSON.stringify(c.scope)).toEqual({ sql: c.sql, params: c.params });
      expect(compile(c.scope, { context: MEMBER }), JSON.stringify(c.scope)).toEqual({ sql: c.sql, params: c.params });
    }
  });

  it('with a context, a placeholder binds its resolved value', () => {
    expect(compile({ owner: { $ne: '{current_user_id}' } }, { context: MEMBER })).toEqual({
      sql: '("deal"."owner" IS NULL OR "deal"."owner" <> ?)',
      params: ['u_me'],
    });
  });

  it('a date macro resolves on the context’s calendar, and on UTC without a context', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T23:30:00.000Z'));
    const scope = { closed_on: { $lt: '{today}' } };
    expect(compile(scope).params).toEqual(['2026-03-15']);
    expect(compile(scope, { context: { timezone: 'Asia/Shanghai' } as ExecutionContext }).params).toEqual(['2026-03-16']);
  });

  it('without a context, a context token is refused in the withheld envelope, never bound as its text', () => {
    for (const scope of [{ owner: '{current_user_id}' }, { owner: '{current_org_id}' }, { owner: '{restricted_token}' }]) {
      const err = refusalOf(() => compile(scope));
      expect(err, JSON.stringify(scope)).toBeInstanceOf(Error);
      expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(err?.status).toBe(500);
      expect(declaredRefusalMessage(err)).toBeUndefined();
    }
  });
});
