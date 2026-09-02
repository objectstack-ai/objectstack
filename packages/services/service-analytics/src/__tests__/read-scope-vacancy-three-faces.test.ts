// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13926] ONE read scope, ONE verdict — on all three faces that serve it.
 *
 * #13640 guarded the ObjectQL ENGINE path (`execute()`), and its dispatch
 * deliberately did not move the other two consumers of a `getReadScope`
 * output. The result it declared, and this card closes: for a vacating scope
 * spelling the ObjectQL EXECUTION refused while the `/analytics/sql` ECHO
 * (`ObjectQLStrategy.generateSql`) still compiled it into a predicate that
 * admits every row — and `NativeSQLStrategy.applyReadScope` built a real,
 * EXECUTED `WHERE` from the same compiler, so the native route was not an
 * echo-truthfulness gap but a latent whole-table read for any out-of-repo
 * producer (`StrategyContext.getReadScope` is a spec contract;
 * `NativeSQLStrategy.execute()` runs `generateSql`'s output through
 * `ctx.executeRawSql` with no other read-scope door in front of it).
 *
 * ## MEASURED, not read from the compiler
 *
 * The card flagged its own row consequence as derived from the emitted
 * predicate. This file measures it end-to-end on the pre-fix tree — one
 * `SqliteWasmDriver` (`driver-sqlite-wasm` over `driver-sql`), three fixture
 * rows, all three faces driven against it, echo SQL EXECUTED rather than
 * string-matched:
 *
 * | scope (spelling)                              | execute()   | echo (SQL run) | native execute() |
 * |-----------------------------------------------|-------------|----------------|------------------|
 * | `{ owner: { $nin: [] } }`                     | REFUSED     | refused (#13571 arm) | refused (#13571 arm) |
 * | `{ $not: { owner: { $in: [] } } }`            | REFUSED     | ALL THREE ROWS | ALL THREE ROWS   |
 * | `{ $not: { owner: [] } }`                     | REFUSED     | refused (bare-array arm) | refused (bare-array arm) |
 * | `{ $not: { owner: { $in: [], $ne: 'u_other' } } }` | REFUSED | ALL THREE ROWS | ALL THREE ROWS   |
 * | `{ $or: [{ $not: { owner: { $in: [] } } }, …] }`   | REFUSED | ALL THREE ROWS | ALL THREE ROWS   |
 * | `{ $not: { $not: { owner: { $nin: [] } } } }` | REFUSED     | refused (#13571 arm) | refused (#13571 arm) |
 *
 * Post-fix every row of that table reads REFUSED / REFUSED / REFUSED, in the
 * module's one envelope (`READ_SCOPE_COMPILE_FAILED` / 500) — which is the
 * whole card: the three faces may keep door-specific refusal MESSAGES (see
 * below), but never door-specific VERDICTS.
 *
 * ## Where the guard stands, and why AFTER the compiler
 *
 * `assertReadScopeCannotVacate` (the #13640 guard, exported from
 * `read-scope-sql.ts`) is now called at both remaining merge sites — the echo
 * scope merge in `ObjectQLStrategy.generateSql` and
 * `NativeSQLStrategy.applyReadScope` — AFTER `compileScopedFilterToSql`
 * returns. The ordering is deliberate: the shapes the compiler already
 * refuses (`$nin: []` at any depth, the bare array comparand) keep the
 * refusal messages #13571 pinned on these very routes
 * (`read-scope-empty-nin-refusal.test.ts` message pin stays green,
 * unedited), so each door stays distinguishable in the operator's log — the
 * property #13640's review called out — while the guard closes exactly the
 * shapes that COMPILE and vacate. Coverage is structural, not curated: the
 * guard is the same walk `execute()` trusts, so the three faces cannot drift
 * without one of them editing shared code this file pins.
 *
 * ## What must NOT move
 *
 * - `compileScopedFilterToSql` itself. The #13571 verdict's residue — `$not`
 *   over `$in: []` still COMPILES there — is ruled to stay until a
 *   polarity-aware compiler design is ruled first. The controls below assert
 *   the compiler still compiles all three leaking spellings: IMMOBILITY
 *   CONTROLS, not contracts — whoever lands the ruled compiler design should
 *   expect them to redden and rewrite them in that PR.
 * - The `$in: []` → zero-rows reduction and the live #13570 RLS composite
 *   (`{ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] }` — "own rows keep
 *   flowing"). Both are asserted on ALL THREE faces.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { AggregationNode, Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, DriverQuery, StrategyContext } from '@objectstack/spec/contracts';

import { AnalyticsService } from '../analytics-service.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

const OBJECT = 'deal';

/** `owner` is NULL on r3 so NULL-safety regressions show up as a wrong id set. */
const ROWS = [
  { id: 'r1', owner: 'u_me' },
  { id: 'r2', owner: 'u_other' },
  { id: 'r3', owner: null },
];
const ALL = ['r1', 'r2', 'r3'];

const OBJECT_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  owner: { type: 'string', name: 'owner' },
};

const CUBE: Cube = {
  name: 'deals',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    ['id', 'owner'].map((n) => [n, { name: n, label: n, type: 'string', sql: n }]),
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

describe('[#13926] one read scope, one verdict — execute / echo / native agree', () => {
  let driver: SqliteWasmDriver;
  /** The ObjectQL EXECUTE face — the #13640-guarded route, via the service. */
  let service: AnalyticsService;
  /** Swapped per case; the spec contract filled by hand, never by the RLS compiler. */
  let readScope: unknown = null;

  /** Run raw SQL (either strategy's `$N`-numbered output) on the REAL engine. */
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
    await driver.initObjects([{ name: OBJECT, fields: OBJECT_FIELDS } as any]);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });

    service = new AnalyticsService({
      cubes: [CUBE],
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (objectName, options) => {
        const query: DriverQuery = {
          where: options.filter as FilterCondition,
          groupBy: options.groupBy,
          aggregations: options.aggregations?.map(({ field, method, alias }) => ({
            field,
            function: method as AggregationNode['function'],
            alias,
          })),
        };
        return (await driver.aggregate(objectName, query)) as Record<string, unknown>[];
      },
      getReadScope: () => (readScope ?? undefined) as FilterCondition | undefined,
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
      executeRawSql: (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
    }) as unknown as StrategyContext;

  /** Face 1 — ObjectQL EXECUTE (engine lowering; #13640's door). */
  const executeFace = async (scope: unknown): Promise<Outcome> => {
    readScope = scope;
    try {
      const result = await service.query(QUERY);
      return { admitted: result.rows.map((r) => String(r.id)).sort() };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  /**
   * Face 2 — the `/analytics/sql` ECHO, its SQL then EXECUTED on the real
   * engine. Running the string is what turns "the predicate admits every row"
   * from a reading of the compiler into a measured row set: the echo's whole
   * contract is to be the SQL execution would run.
   */
  const echoFace = async (scope: unknown): Promise<Outcome> => {
    readScope = scope;
    try {
      const { sql, params } = await new ObjectQLStrategy().generateSql(QUERY, directCtx(false));
      const rows = await runRawSql(sql, params);
      return { admitted: rows.map((r) => String(r.id)).sort() };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  /** Face 3 — NativeSQL EXECUTE (`applyReadScope` → `ctx.executeRawSql`): real rows. */
  const nativeFace = async (scope: unknown): Promise<Outcome> => {
    readScope = scope;
    try {
      const result = await new NativeSQLStrategy().execute(QUERY, directCtx(true));
      return { admitted: result.rows.map((r) => String(r.id)).sort() };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  const FACES = [
    ['execute', executeFace],
    ['echo', echoFace],
    ['native', nativeFace],
  ] as const;

  const expectRefused = (face: string, o: Outcome): void => {
    expect(o.admitted, `${face}: expected a refusal, got rows`).toBeUndefined();
    expect(o.refusal, `${face}: expected an Error`).toBeInstanceOf(Error);
    expect(o.refusal?.code, `${face}: envelope code`).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(o.refusal?.status, `${face}: envelope status`).toBe(500);
  };

  // ── Fixture honesty ────────────────────────────────────────────────────────

  it('CONTROL: with no scope, every face serves the whole fixture', async () => {
    // Without this, every refusal assertion below could pass on a harness that
    // admits nothing — and the echo face would be executing SQL over no rows.
    for (const [face, run] of FACES) {
      const o = await run(null);
      expect(o.refusal?.message, `${face}: fixture control refusal`).toBeUndefined();
      expect(o.admitted, `${face}: fixture control`).toEqual(ALL);
    }
  });

  // ── The six vacating spellings #13640 measured — one verdict per scope ────

  const VACATING: Array<[string, unknown]> = [
    ['{ owner: { $nin: [] } }', { owner: { $nin: [] } }],
    ['{ $not: { owner: { $in: [] } } }', { $not: { owner: { $in: [] } } }],
    ['{ $not: { owner: [] } }', { $not: { owner: [] } }],
    ["{ $not: { owner: { $in: [], $ne: 'u_other' } } }", { $not: { owner: { $in: [], $ne: 'u_other' } } }],
    ["{ $or: [{ $not: { owner: { $in: [] } } }, { owner: 'u_me' }] }", { $or: [{ $not: { owner: { $in: [] } } }, { owner: 'u_me' }] }],
    ['{ $not: { $not: { owner: { $nin: [] } } } }', { $not: { $not: { owner: { $nin: [] } } } }],
  ];

  for (const [label, scope] of VACATING) {
    it(`${label} is REFUSED on all three faces, in the one envelope`, async () => {
      // Pre-fix, the echo and native faces ADMITTED ALL THREE ROWS for the
      // spellings the compiler compiles (header table) — the leak this card
      // closes. The verdict (code + status) is the cross-face contract; the
      // message may differ per door (asserted separately below).
      for (const [face, run] of FACES) {
        expectRefused(face, await run(scope));
      }
    });
  }

  // ── Door-distinguishable messages — same verdict, named doors ─────────────

  it('the compiler-refused spelling keeps #13571\'s OWN message on echo and native', async () => {
    // `read-scope-empty-nin-refusal.test.ts` pins this end-to-end for native;
    // asserted here beside the guard-message case so the ordering (compiler
    // first, guard after) is pinned as a choice rather than an accident.
    for (const run of [echoFace, nativeFace]) {
      const o = await run({ owner: { $nin: [] } });
      expect(String(o.refusal?.message)).toContain('$nin for "owner" is empty');
      expect(String(o.refusal?.message)).not.toContain('read scope for');
    }
    // The engine face has no compiler in front of it — the guard answers.
    const engine = await executeFace({ owner: { $nin: [] } });
    expect(String(engine.refusal?.message)).toContain('read scope for "deal"');
  });

  it('the compiling-but-vacating spelling is refused BY THE GUARD on echo and native', async () => {
    for (const run of [echoFace, nativeFace, executeFace]) {
      const o = await run({ $not: { owner: { $in: [] } } });
      expect(String(o.refusal?.message)).toContain('read scope for "deal"');
      expect(String(o.refusal?.message)).toContain('empty $in under negation at $not.owner.$in');
    }
  });

  // ── Ordinary scopes — same ADMISSION on all three faces ───────────────────

  const ORDINARY: Array<[string, unknown, string[]]> = [
    ["{ owner: 'u_me' }", { owner: 'u_me' }, ['r1']],
    ["{ owner: { $in: ['u_me', 'u_other'] } }", { owner: { $in: ['u_me', 'u_other'] } }, ['r1', 'r2']],
    // Non-empty exclusion keeps NULL-safety — r3 stays in the answer.
    ["{ owner: { $nin: ['u_other'] } }", { owner: { $nin: ['u_other'] } }, ['r1', 'r3']],
  ];

  for (const [label, scope, expected] of ORDINARY) {
    it(`ORDINARY: ${label} admits the same rows on every face`, async () => {
      for (const [face, run] of FACES) {
        const o = await run(scope);
        expect(o.refusal, `${face}: unexpected refusal`).toBeUndefined();
        expect(o.admitted, `${face}: admitted set`).toEqual(expected);
      }
    });
  }

  // ── Over-denial controls — the ruled reductions did not move, anywhere ────

  it('OVER-DENIAL CONTROL: `{ owner: { $in: [] } }` still means zero rows on every face', async () => {
    // The ruled #5322 / #5243 identity — narrowing at its own arm, load-bearing
    // for the RLS composite below. A guard that catches it is the availability
    // regression #13571's verdict rejected.
    for (const [face, run] of FACES) {
      const o = await run({ owner: { $in: [] } });
      expect(o.refusal, `${face}: unexpected refusal`).toBeUndefined();
      expect(o.admitted, `${face}: zero rows`).toEqual([]);
    }
  });

  it('OVER-DENIAL CONTROL: the #13570 RLS composite still admits exactly the own row, everywhere', async () => {
    // `{ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] }` is what the RLS
    // compiler really emits for an emptied membership beside an own-rows grant,
    // and it reaches ALL THREE faces through `security.getReadFilter`.
    for (const [face, run] of FACES) {
      const o = await run({ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] });
      expect(o.refusal, `${face}: unexpected refusal`).toBeUndefined();
      expect(o.admitted, `${face}: own row`).toEqual(['r1']);
    }
  });

  it('OVER-DENIAL CONTROL: the denies-by-itself `$and` composite still denies, everywhere', async () => {
    for (const [face, run] of FACES) {
      const o = await run({ $and: [{ owner: { $in: [] } }, { owner: 'u_me' }] });
      expect(o.refusal, `${face}: unexpected refusal`).toBeUndefined();
      expect(o.admitted, `${face}: zero rows`).toEqual([]);
    }
  });
});

// ── The joined-object door on the native strategy ───────────────────────────

describe('[#13926] `applyReadScope` guards the JOINED object\'s scope too', () => {
  /**
   * `applyReadScope` runs once per object in the statement — base table plus
   * every joined object (the ADR-0021 D-C per-hop RLS injection). A vacating
   * scope on the JOINED object silently un-scoped that hop while the base
   * stayed scoped, so this door gets its own pin, named for the joined object.
   * SQL-build level: the refusal fires before `executeRawSql`, so a stub
   * executor proves it can never be reached.
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

  const QUERY = {
    cube: 'sales',
    measures: ['revenue'],
    dimensions: ['region'],
    timezone: 'UTC',
  } as AnalyticsQuery;

  it('CONTROL: an ordinary joined-object scope still builds a per-hop-scoped statement', async () => {
    const ctx = ctxWith({ organization_id: 'org_A' });
    const { sql } = await new NativeSQLStrategy().generateSql(QUERY, ctx);
    expect(sql).toContain('"opportunity"."organization_id" =');
    expect(sql).toContain('"account"."organization_id" =');
  });

  it('a vacating joined-object scope is REFUSED, named for the JOINED object', async () => {
    let err: (Error & { code?: unknown; status?: unknown }) | undefined;
    try {
      await new NativeSQLStrategy().generateSql(QUERY, ctxWith({ $not: { organization_id: { $in: [] } } }));
    } catch (e) {
      err = e as Error & { code?: unknown; status?: unknown };
    }
    expect(err).toBeInstanceOf(Error);
    expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err?.status).toBe(500);
    // The BASE object's scope is ordinary, so only the joined hop can refuse.
    expect(String(err?.message)).toContain('read scope for "account"');
    expect(String(err?.message)).toContain('empty $in under negation');
  });
});

// ── Immobility: the compiler itself did not move ────────────────────────────

describe('[#13926] IMMOBILITY — `compileScopedFilterToSql` still compiles the residue', () => {
  /**
   * ⚠️ IMMOBILITY CONTROLS, not contracts (#13640's precedent, kept here on
   * purpose): the #13571 verdict's residue — `$not` over `$in: []` compiling
   * to constant TRUE at that lowering — stays exactly where that verdict left
   * it, because the polarity-aware COMPILER design is ruled to come first.
   * #13926 closed the two routes ABOVE the compiler; the compiler's own answer
   * is pinned unchanged so this PR can prove it did not sneak the residue shut
   * at the ruled-first site. Whoever lands the ruled design should EXPECT
   * these to redden and rewrite them in that PR.
   */
  const compiles = (scope: unknown): string =>
    compileScopedFilterToSql(scope as FilterCondition, 'deal').sql;

  it('`$not` over `$in: []` still compiles (to the negated FALSE constant)', () => {
    expect(compiles({ $not: { owner: { $in: [] } } })).toContain('NOT');
  });

  it('the multi-key spelling still compiles too', () => {
    expect(compiles({ $not: { owner: { $in: [], $ne: 'u_other' } } })).toContain('NOT');
  });

  it('the `$or`-nested spelling still compiles too', () => {
    expect(compiles({ $or: [{ $not: { owner: { $in: [] } } }, { owner: 'u_me' }] })).toContain('NOT');
  });

  it('an ordinary scope still compiles to the same bound predicate', () => {
    const { sql, params } = compileScopedFilterToSql({ owner: 'u_me' } as FilterCondition, 'deal');
    expect(sql).toBe('"deal"."owner" = ?');
    expect(params).toEqual(['u_me']);
  });
});
