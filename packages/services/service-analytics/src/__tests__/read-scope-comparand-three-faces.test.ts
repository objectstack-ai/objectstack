// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20018] ONE read scope, ONE verdict on its comparands — on all three
 * analytics faces that serve it.
 *
 * #19995 taught the ObjectQL EXECUTE face to judge a `getReadScope` output with
 * the engine's two SHARED comparand faces (`@objectstack/spec/data`'s
 * `assertListComparandShapes` and `normalizeFilterComparandTypes`, through
 * `assertReadScopeComparandsRunnable`) and to refuse what they refuse as
 * `READ_SCOPE_COMPILE_FAILED` / 500, message withheld. The NativeSQL EXECUTE
 * face (`NativeSQLStrategy.applyReadScope`) and the `/analytics/sql` ECHO
 * (`ObjectQLStrategy.generateSql`) never meet that guard: both lower the scope
 * through `compileScopedFilterToSql`, whose own gates are narrower than the two
 * faces. So one scope got two answers, chosen by which face served it.
 *
 * ## MEASURED on the pre-fix tree, rows EXECUTED
 *
 * One `SqliteWasmDriver`, four fixture rows (`region` NULL on d3), a real
 * `ObjectQL` engine behind the ObjectQL face; the echo's SQL is run on the same
 * database, so "what the echo shows" is a row set and not a string. Measured on
 * `9d81af714f` (`origin/main`, before this change):
 *
 * | read-scope shape class                         | ObjectQL execute | echo (SQL run) | native execute          |
 * |------------------------------------------------|------------------|----------------|-------------------------|
 * | plain-object comparand under `$eq`             | 500 withheld     | compiles; DB refuses | `DATABASE_ERROR` / 500 |
 * | null member in `$in` (`['emea', null]`)        | 500 withheld     | d1             | d1 — the null member matches nothing |
 * | null member in `$in` under `$not`              | 500 withheld     | d3             | d3 — only the NULL row, which the scope excludes |
 * | null member in `$nin` (`['apac', null]`)       | 500 withheld     | d3             | d3 — only the NULL row, which the scope excludes |
 * | null comparand under `$gt` / `$lte`            | 500 withheld     | no rows        | no rows                 |
 * | null `$between` bound                          | 500 withheld     | no rows        | no rows                 |
 * | blank `$between` bound                         | 500 withheld     | d1 d2 d4       | d1 d2 d4                |
 * | plain-object comparand under `$ne` / `$gt`     | 500 withheld     | compiles; DB refuses | `DATABASE_ERROR` / 500 |
 * | bigint beyond 2^53                             | 500 withheld     | no rows        | no rows                 |
 * | binary comparand, binary `$in` member          | 500 withheld     | no rows        | no rows                 |
 * | non-plain object (`Map`) comparand             | 500 withheld     | compiles; DB refuses | `DATABASE_ERROR` / 500 |
 *
 * Every control below agreed on all three faces, row for row. The ObjectQL
 * column is the #5367 envelope the other two now give as well: the rulings
 * that refuse each shape (#7872's comparand types, the null-member ruling of
 * 2026-08-31, the null-ordering ruling of 2026-09-01, the blank-bound ruling of
 * 2026-09-20) are the shared faces' own, and this file does not re-argue them.
 *
 * ## Where the judgement stands, and why AFTER the lowering
 *
 * Inside `compileScopedFilterToSql`, once `compileNode` has returned — so it
 * holds for both faces and for any direct consumer of that public export. The
 * two walks are pure functions of the scope, so the ORDER cannot change which
 * scopes are refused, only which sentence a doubly-refused scope carries. After
 * the lowering, a shape the compiler already refused keeps its own message
 * (the `#13926` precedent); the shared faces add only what the compiler would
 * otherwise have lowered. Both halves of that are pinned below.
 *
 * ## What must NOT move
 *
 * - Well-formed scopes, including the null PREDICATE spellings, an emptied
 *   `$in` beside an own-rows grant (the live RLS composite), and the spelling
 *   the null-member ruling prescribes: served, the same rows on every face.
 * - The caller's own `where`. It never reaches this compiler, and it answers
 *   exactly as it answers with no scope at all.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { declaredRefusalMessage, resolveThrownHttpError, serverFaultProvenance } from '@objectstack/types';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { AnalyticsService } from '../analytics-service.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

const OBJECT = 'deal';

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  region: { type: 'text', name: 'region' },
  owner: { type: 'text', name: 'owner' },
  amount: { type: 'number', name: 'amount' },
};

/** `region` is NULL on d3, so a NULL-matching regression shows up as a wrong id set. */
const ROWS = [
  { id: 'd1', region: 'emea', owner: 'u_me', amount: 10 },
  { id: 'd2', region: 'apac', owner: 'u_other', amount: 20 },
  { id: 'd3', region: null, owner: 'u_me', amount: 30 },
  { id: 'd4', region: 'amer', owner: null, amount: null },
];
const ALL = ['d1', 'd2', 'd3', 'd4'];

const CUBE: Cube = {
  name: 'deals',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    ['id', 'region'].map((n) => [n, { name: n, label: n, type: 'string', sql: n }]),
  ),
  public: false,
} as unknown as Cube;

const QUERY = { cube: 'deals', dimensions: ['id'], measures: ['n'] } as AnalyticsQuery;

interface WireBearingError extends Error {
  code?: unknown;
  status?: unknown;
}

/** One face's outcome: a refusal, or the sorted ids the face actually served. */
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
 * Each row: a read-scope shape the shared comparand faces refuse and the
 * pre-fix `compileScopedFilterToSql` lowered. Class names only — what each
 * pre-fix face answered is the header's table.
 */
const REFUSED: Array<{ name: string; scope: unknown }> = [
  { name: 'a plain-object comparand under $eq', scope: { region: { $eq: { restricted_key: 1 } } } },
  { name: 'a null member in $in', scope: { region: { $in: ['emea', null] } } },
  { name: 'a null member in $in under $not', scope: { $not: { region: { $in: ['apac', null] } } } },
  { name: 'a null member in $nin', scope: { region: { $nin: ['apac', null] } } },
  { name: 'a null comparand under an ordering operator', scope: { amount: { $gt: null } } },
  { name: 'a null $between bound', scope: { amount: { $between: [null, 25] } } },
  { name: 'a blank $between bound', scope: { region: { $between: ['', 'f'] } } },
  { name: 'a plain-object comparand under $ne', scope: { region: { $ne: { restricted_key: 1 } } } },
  { name: 'a bigint comparand beyond 2^53', scope: { amount: 9007199254740993n } },
  { name: 'a binary comparand', scope: { region: { $eq: new Uint8Array([101]) } } },
  { name: 'a binary member in $in', scope: { region: { $in: [new Uint8Array([101])] } } },
  { name: 'a non-plain object comparand', scope: { region: { $eq: new Map([['k', 1]]) } } },
  {
    name: 'a null member nested in an $or beside a well-formed arm',
    scope: { $or: [{ owner: 'u_me' }, { region: { $in: ['emea', null] } }] },
  },
];

/** Well-formed scopes, and the rows each admits on every face. */
const SERVED: Array<{ name: string; scope: unknown; rows: string[] }> = [
  { name: 'a membership', scope: { region: { $in: ['emea', 'amer'] } }, rows: ['d1', 'd4'] },
  { name: 'an implicit equality', scope: { owner: 'u_me' }, rows: ['d1', 'd3'] },
  { name: 'an ordering comparison', scope: { amount: { $gt: 15 } }, rows: ['d2', 'd3'] },
  { name: 'a two-bound range', scope: { amount: { $between: [15, 30] } }, rows: ['d2', 'd3'] },
  { name: 'the null predicate (implicit)', scope: { region: null }, rows: ['d3'] },
  { name: 'the null predicate ($ne: null)', scope: { region: { $ne: null } }, rows: ['d1', 'd2', 'd4'] },
  { name: 'a non-empty exclusion (NULL-safe)', scope: { region: { $nin: ['apac'] } }, rows: ['d1', 'd3', 'd4'] },
  {
    name: 'an emptied membership beside an own-rows grant (the live RLS composite)',
    scope: { $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] },
    rows: ['d1', 'd3'],
  },
  {
    name: 'the spelling the null-member ruling prescribes for "one of these, or no value"',
    scope: { $or: [{ region: { $in: ['emea'] } }, { region: { $null: true } }] },
    rows: ['d1', 'd3'],
  },
];

/** A scope that admits every fixture row, so the caller's `where` is the only constraint. */
const ADMITS_ALL = { id: { $in: ALL } };

describe('[#20018] one read scope, one comparand verdict — ObjectQL / echo / native agree', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  /** The ObjectQL EXECUTE face — `withReadScope`'s door (#19995), via the service. */
  let service: AnalyticsService;
  /** Swapped per case; the `getReadScope` contract filled by hand, never by the RLS compiler. */
  let readScope: unknown = null;
  /** Statements the NATIVE face handed to the database — a refusal must precede execution. */
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
    await driver.initObjects([{ name: OBJECT, fields: FIELDS }] as never);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });

    engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: OBJECT, label: 'Deal', fields: FIELDS } as never);

    service = new AnalyticsService({
      cubes: [CUBE],
      logger: quiet,
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      getReadScope: () => (readScope ?? undefined) as FilterCondition | undefined,
      // The auto-bridge's own mapping (`plugin.ts`): the filter travels
      // verbatim, so what answers a served scope is the engine's lowering.
      executeAggregate: async (objectName, options) =>
        (await engine.aggregate(objectName, {
          where: options.filter,
          groupBy: options.groupBy,
          aggregations: options.aggregations?.map((a) => ({
            function: a.method,
            field: a.field,
            alias: a.alias,
          })),
          context: options.context,
        } as never)) as Record<string, unknown>[],
    });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  /** A hand-filled `StrategyContext` for driving one strategy directly. */
  const directCtx = (nativeSql: boolean): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql, objectqlAggregate: !nativeSql, inMemory: false }),
      getReadScope: () => (readScope ?? undefined) as FilterCondition | undefined,
      executeRawSql: (_object: string, sql: string, params: unknown[]) => {
        rawStatements += 1;
        return runRawSql(sql, params);
      },
    }) as unknown as StrategyContext;

  const ids = (rows: Array<Record<string, unknown>>): string[] => rows.map((r) => String(r.id)).sort();

  /** Face 1 — ObjectQL EXECUTE (engine lowering; #19995's door). */
  const objectqlFace = async (scope: unknown, where?: unknown): Promise<Outcome> => {
    readScope = scope;
    try {
      const result = await service.query({ ...QUERY, ...(where ? { where } : {}) } as AnalyticsQuery);
      return { admitted: ids(result.rows) };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  /** Face 2 — the `/analytics/sql` ECHO, its SQL then EXECUTED on the same database. */
  const echoFace = async (scope: unknown, where?: unknown): Promise<Outcome> => {
    readScope = scope;
    try {
      const q = { ...QUERY, ...(where ? { where } : {}) } as AnalyticsQuery;
      const { sql, params } = await new ObjectQLStrategy().generateSql(q, directCtx(false));
      return { admitted: ids(await runRawSql(sql, params)) };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  /** Face 3 — NativeSQL EXECUTE (`applyReadScope` → `ctx.executeRawSql`): real rows. */
  const nativeFace = async (scope: unknown, where?: unknown): Promise<Outcome> => {
    readScope = scope;
    try {
      const q = { ...QUERY, ...(where ? { where } : {}) } as AnalyticsQuery;
      const result = await new NativeSQLStrategy().execute(q, directCtx(true));
      return { admitted: ids(result.rows) };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  const FACES = [
    ['objectql', objectqlFace],
    ['echo', echoFace],
    ['native', nativeFace],
  ] as const;

  /**
   * The #5367 envelope, and the reads every analytics HTTP door takes before
   * relaying prose: a producer-declared 5xx that is not a declared refusal is
   * withheld.
   */
  const expectWithheldRefusal = (face: string, o: Outcome): void => {
    expect(o.admitted, `${face}: expected a refusal, got rows`).toBeUndefined();
    expect(o.refusal, `${face}: expected an Error`).toBeInstanceOf(Error);
    expect(o.refusal?.code, `${face}: envelope code`).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(o.refusal?.status, `${face}: envelope status`).toBe(500);
    expect(serverFaultProvenance(resolveThrownHttpError(o.refusal, 500)), `${face}: provenance`).toBe('declared');
    expect(declaredRefusalMessage(o.refusal), `${face}: relayed prose`).toBeUndefined();
  };

  // ── Fixture honesty ────────────────────────────────────────────────────────

  it('CONTROL: with no scope, every face serves the whole fixture', async () => {
    // Without this, every refusal below could pass on a harness that admits
    // nothing, and the echo face would be executing SQL over no rows.
    for (const [face, run] of FACES) {
      const o = await run(null);
      expect(o.refusal?.message, `${face}: fixture control refusal`).toBeUndefined();
      expect(o.admitted, `${face}: fixture control`).toEqual(ALL);
    }
  });

  // ── The refused shape classes — one verdict per scope ─────────────────────

  for (const c of REFUSED) {
    it(`${c.name} is refused on all three faces, in the one withheld envelope`, async () => {
      for (const [face, run] of FACES) {
        expectWithheldRefusal(face, await run(c.scope));
      }
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

  // ── Door-distinguishable messages — same verdict, truer sentence ─────────

  it('a shape the compiler already refused keeps ITS OWN sentence on echo and native', async () => {
    // The ordering is a choice (the lowering first, the shared faces after),
    // pinned here so a later move of the call is visible: both faces also refuse
    // a list under `$eq`, and the compiler's sentence names the `$in` remedy.
    for (const run of [echoFace, nativeFace]) {
      const o = await run({ region: { $eq: ['emea', 'amer'] } });
      expect(o.refusal?.code).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(String(o.refusal?.message)).toContain('array value for "region".$eq');
      expect(String(o.refusal?.message)).not.toContain('carries a comparand the engine refuses');
    }
  });

  it('a shape only the shared faces refuse carries their sentence, the same on all three faces', async () => {
    for (const [face, run] of FACES) {
      const o = await run({ region: { $in: ['emea', null] } });
      expect(String(o.refusal?.message), face).toContain('carries a comparand the engine refuses');
      expect(String(o.refusal?.message), face).toContain('does not accept null as a list member');
    }
  });

  // ── Served scopes — same ADMISSION on all three faces ────────────────────

  for (const c of SERVED) {
    it(`CONTROL: ${c.name} admits the same rows on every face`, async () => {
      for (const [face, run] of FACES) {
        const o = await run(c.scope);
        expect(o.refusal?.message, `${face}: unexpected refusal`).toBeUndefined();
        expect(o.admitted, `${face}: admitted set`).toEqual(c.rows);
      }
    });
  }

  // ── The caller's own `where` — untouched ─────────────────────────────────

  it('CONTROL: a well-formed caller `where` composes with a well-formed scope on every face', async () => {
    for (const [face, run] of FACES) {
      const o = await run({ owner: 'u_me' }, { amount: { $gt: 15 } });
      expect(o.refusal?.message, `${face}: unexpected refusal`).toBeUndefined();
      expect(o.admitted, `${face}: scope AND where`).toEqual(['d3']);
    }
  });

  it('CONTROL: a caller `where` in a refused scope shape answers exactly as it does with no scope', async () => {
    // The caller's filter never reaches the read-scope compiler, so its answer —
    // served or refused, by whichever door owns it — is the same beside a scope
    // that admits every row as beside no scope, and it is never attributed to
    // the read scope.
    const where = { region: { $in: ['emea', null] } };
    for (const [face, run] of FACES) {
      const alone = await run(null, where);
      const scoped = await run(ADMITS_ALL, where);
      expect(scoped.refusal?.code, `${face}: attributed to the read scope`).not.toBe('READ_SCOPE_COMPILE_FAILED');
      expect(scoped.admitted, `${face}: rows`).toEqual(alone.admitted);
      expect(scoped.refusal?.code, `${face}: refusal code`).toBe(alone.refusal?.code);
      expect(scoped.refusal?.status, `${face}: refusal status`).toBe(alone.refusal?.status);
    }
  });
});

// ── The joined-object hop on the native strategy ───────────────────────────

describe('[#20018] `applyReadScope` judges the JOINED object\'s scope too', () => {
  /**
   * `applyReadScope` lowers one scope per object in the statement — the base
   * table and every joined hop (ADR-0021 D-C per-hop injection) — each through
   * `compileScopedFilterToSql`. SQL-build level: the refusal fires before
   * `executeRawSql`, so a stub executor proves it can never be reached.
   */
  const joinCube: Cube = {
    name: 'sales',
    title: 'Sales',
    sql: 'opportunity',
    measures: { revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'amount' } },
    dimensions: { region: { name: 'region', label: 'Region', type: 'string', sql: 'account.region' } },
    public: false,
  };

  const ctxWith = (accountScope: unknown): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'sales' ? joinCube : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      getAllowedRelationships: () => new Set(['account']),
      getReadScope: (obj: string) =>
        (obj === 'opportunity' ? { organization_id: 'org_A' } : accountScope) as FilterCondition,
      executeRawSql: async () => {
        throw new Error('unreachable: the refusal must fire before execution');
      },
    }) as unknown as StrategyContext;

  const JOIN_QUERY = {
    cube: 'sales',
    measures: ['revenue'],
    dimensions: ['region'],
    timezone: 'UTC',
  } as AnalyticsQuery;

  it('CONTROL: a well-formed joined-object scope still builds a per-hop-scoped statement', async () => {
    const { sql } = await new NativeSQLStrategy().generateSql(JOIN_QUERY, ctxWith({ organization_id: 'org_A' }));
    expect(sql).toContain('"opportunity"."organization_id" =');
    expect(sql).toContain('"account"."organization_id" =');
  });

  it('a joined-object scope with a null membership member is refused, named for the joined hop', async () => {
    let err: WireBearingError | undefined;
    try {
      await new NativeSQLStrategy().generateSql(JOIN_QUERY, ctxWith({ organization_id: { $in: ['org_A', null] } }));
    } catch (e) {
      err = e as WireBearingError;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err?.status).toBe(500);
    // The BASE object's scope is well-formed, so only the joined hop can refuse.
    expect(String(err?.message)).toContain('read scope for "account"');
  });
});

// ── The public export itself ────────────────────────────────────────────────

describe('[#20018] `compileScopedFilterToSql` — the public export answers what the faces answer', () => {
  const compile = (scope: unknown) => compileScopedFilterToSql(scope as FilterCondition, 'deal');

  const verdict = (scope: unknown): string => {
    try {
      compile(scope);
      return 'compiled';
    } catch (e) {
      const err = e as WireBearingError;
      return `${String(err.code)}/${String(err.status)}`;
    }
  };

  it('refuses every class the shared faces refuse, in the module envelope', () => {
    for (const c of REFUSED) {
      expect(verdict(c.scope), c.name).toBe('READ_SCOPE_COMPILE_FAILED/500');
    }
  });

  it('CONTROL: a well-formed scope compiles to the same bound predicate as before', () => {
    expect(compile({ region: { $in: ['emea', 'amer'] } })).toEqual({
      sql: '"deal"."region" IN (?, ?)',
      params: ['emea', 'amer'],
    });
    expect(compile({ region: null })).toEqual({ sql: '"deal"."region" IS NULL', params: [] });
    expect(compile({ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] })).toEqual({
      sql: '(1 = 0 OR "deal"."owner" = ?)',
      params: ['u_me'],
    });
  });
});
