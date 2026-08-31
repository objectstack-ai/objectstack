// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13640] A read scope that does NOT BIND is refused before it reaches the
 * ObjectQL engine — the third route to the rows, and the one no read-scope
 * compiler ever saw.
 *
 * ## Why this file exists next to `read-scope-empty-nin-refusal.test.ts`
 *
 * That file (#13571) pins the empty-`$nin` refusal inside
 * `compileScopedFilterToSql`, and its own header says what that refusal can
 * cover: "a compile refusal there can only ever guard the NativeSQL path and
 * the echo". `ObjectQLStrategy.execute()` reaches the same rows without
 * calling that compiler at all — `withReadScope` ANDs the `getReadScope`
 * output into the `FilterCondition` handed to `engine.aggregate`, and the
 * ENGINE's own lowering answers it. `driver-sql` lowers `$nin: []` through
 * `whereNotIn(field, [])` wrapped null-safe, which is constant TRUE (live
 * in-repo pin of that semantics: `filter-normalizer-not-null-safe.test.ts`,
 * "`{stage: {$nin: []}}` excludes nothing").
 *
 * ## Why a NON-RLS provider, again
 *
 * `StrategyContext.getReadScope` is a spec contract
 * (`packages/spec/src/contracts/analytics-service.ts` carries a hand-written
 * example), so an out-of-repo provider is exactly what it exists for. In-repo
 * the only producer is the RLS compiler and since PR #13570 its polarity-aware
 * guard drops these shapes before emission — so an RLS-path regression would
 * exercise a route that cannot produce them and would measure nothing. Every
 * provider below is the contract filled BY HAND.
 *
 * ## The engine is real, because the claim is about a lowering
 *
 * `SqliteWasmDriver` (`driver-sqlite-wasm` over `driver-sql`) stands behind
 * `executeAggregate`, which is what `engine.aggregate` reaches in production.
 * A stub bridge would have made every expectation below a statement about the
 * stub. MEASURED on the pre-fix tree, this fixture, this driver — the whole
 * transcript is in the PR body:
 *
 * | read scope                                     | pre-fix rows | now      |
 * |------------------------------------------------|--------------|----------|
 * | `{ owner: { $nin: [] } }`                      | ALL THREE    | REFUSED  |
 * | `{ $not: { owner: { $in: [] } } }`             | ALL THREE    | REFUSED  |
 * | `{ $not: { owner: [] } }`                      | ALL THREE    | REFUSED  |
 * | `{ $not: { owner: { $in: [], $ne: 'u_other' } } }` | ALL THREE | REFUSED  |
 * | `{ $or: [{ $not: { owner: { $in: [] } } }, …] }`| ALL THREE    | REFUSED  |
 * | `{ $not: { $not: { owner: { $nin: [] } } } }`  | ALL THREE    | REFUSED  |
 * | `{ owner: { $in: [] } }`                       | none         | none     |
 * | `{ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] }` | own row | own row |
 * | `{ $and: [{ owner: { $in: [] } }, { owner: 'u_me' }] }`| none  | none     |
 * | `{ owner: 'u_me' }`                            | own row      | own row  |
 *
 * ## Both spellings, on purpose
 *
 * The card names two (`{ f: { $nin: [] } }` and `{ $not: { f: { $in: [] } } }`)
 * and a pin on one leaves the other open. Measuring found two more that reach
 * the engine and come back with the table — the bare `[]` comparand and the
 * multi-key operator object — so they are pinned here too rather than left as
 * a spelling nobody happened to try.
 *
 * ## What must NOT move, and how this file checks it
 *
 * The last block is an IMMOBILITY control over `compileScopedFilterToSql`
 * itself. Both other routes (`NativeSQLStrategy.applyReadScope` and the
 * `/analytics/sql` echo) consume that one function and have no other
 * read-scope translation, so pinning its answers pins theirs — and it does so
 * without a second copy of #13571's end-to-end fixture, which stays the
 * end-to-end pin for the NativeSQL route.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { AggregationNode, Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, DriverQuery, StrategyContext } from '@objectstack/spec/contracts';

import { DatasetSchema } from '@objectstack/spec/ui';

import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

const OBJECT = 'deal';

/** `owner` is NULL on r3 so a guard applied to the wrong polarity shows up. */
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

interface WireBearingError extends Error {
  code?: unknown;
  status?: unknown;
}

type Outcome = { refusal?: WireBearingError; admitted?: string[] };

describe('[#13640] ObjectQL ENGINE path — a read scope that does not bind is refused', () => {
  let driver: SqliteWasmDriver;
  let service: AnalyticsService;
  /** Swapped per case; the spec contract filled by hand, never by the RLS compiler. */
  let readScope: unknown = null;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: OBJECT, fields: OBJECT_FIELDS } as any]);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });

    service = new AnalyticsService({
      cubes: [CUBE],
      // ObjectQL only — this is the route `compileScopedFilterToSql` never sees.
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      // The production bridge is `engine.aggregate`; here it is the driver's own
      // `aggregate`, which is what that engine call reaches. The filter travels
      // VERBATIM — the claim under test is about the engine's lowering of it.
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

  /** Run one aggregate under `scope`; return the refusal or the admitted ids. */
  const outcome = async (scope: unknown): Promise<Outcome> => {
    readScope = scope;
    try {
      const result = await service.query({
        cube: 'deals',
        dimensions: ['id'],
        measures: ['n'],
      } as AnalyticsQuery);
      return { admitted: result.rows.map((r) => String(r.id)).sort() };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  /** Every refusal on this path carries the module's one envelope. */
  const expectRefused = (o: Outcome, messageFragment: string): void => {
    expect(o.admitted).toBeUndefined();
    expect(o.refusal).toBeInstanceOf(Error);
    expect(o.refusal?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(o.refusal?.status).toBe(500);
    expect(String(o.refusal?.message)).toContain(messageFragment);
  };

  // ── The leak, both spellings the card names ───────────────────────────────

  it('CONTROL: the fixture and the bridge are honest — no scope admits every row', async () => {
    // Without this, every "refused" assertion below could be passing because
    // the harness admits nothing in the first place.
    expect((await outcome(null)).admitted).toEqual(ALL);
  });

  it('`{ owner: { $nin: [] } }` is REFUSED — pre-fix it admitted the whole table', async () => {
    expectRefused(await outcome({ owner: { $nin: [] } }), 'has an empty $nin at owner.$nin');
  });

  it('`{ $not: { owner: { $in: [] } } }` — the other spelling — is REFUSED too', async () => {
    // The same constant by a different road: an empty membership matches
    // nothing, so its negation matches everything. Pre-fix: all three rows.
    expectRefused(
      await outcome({ $not: { owner: { $in: [] } } }),
      'has an empty $in under negation at $not.owner.$in',
    );
  });

  it('the bare `[]` comparand under `$not` is the same emptied membership, and is REFUSED', async () => {
    expectRefused(await outcome({ $not: { owner: [] } }), 'under negation at $not.owner: []');
  });

  it('a sibling operator does not rescue it: `{ $in: [], $ne }` under `$not` is REFUSED', async () => {
    // FALSE absorbs the AND a multi-key operator object forms, so this is the
    // single-key spelling. Measured pre-fix: all three rows, not two.
    expectRefused(
      await outcome({ $not: { owner: { $in: [], $ne: 'u_other' } } }),
      'has an empty $in under negation at $not.owner.$in',
    );
  });

  it('nested inside a composite it is still REFUSED — a TRUE `$or` arm absorbs the scope', async () => {
    expectRefused(
      await outcome({ $or: [{ $not: { owner: { $in: [] } } }, { owner: 'u_me' }] }),
      'at $or[0].$not.owner.$in',
    );
  });

  it('an empty `$nin` is refused at EVERY polarity, matching the compiler arm', async () => {
    // Deliberately polarity-INDEPENDENT: `compileScopedFilterToSql`'s `$nin`
    // arm throws whatever encloses it (#13571), and a weaker rule here would
    // give one read scope two answers depending on which strategy served the
    // query. Under one `$not` the clause is merely narrowing; under two it is
    // the whole-table fold again (measured pre-fix: all three rows).
    expectRefused(await outcome({ $not: { owner: { $nin: [] } } }), 'at $not.owner.$nin');
    expectRefused(await outcome({ $not: { $not: { owner: { $nin: [] } } } }), 'at $not.$not.owner.$nin');
    expectRefused(await outcome({ $and: [{ owner: { $nin: [] } }, { owner: 'u_me' }] }), 'at $and[0].owner.$nin');
  });

  // ── The asymmetry, and the bound the guard must not cross ────────────────

  it('ASYMMETRY: `{ owner: { $in: [] } }` still means zero rows — unchanged', async () => {
    // The ruled #5322 / #5243 identity. Narrowing at its own arm, the safe
    // direction on a read scope; refusing it would 500 a scope that already
    // denies correctly.
    const { refusal, admitted } = await outcome({ owner: { $in: [] } });
    expect(refusal).toBeUndefined();
    expect(admitted).toEqual([]);
  });

  it('OVER-DENIAL CONTROL: the #13570-pinned RLS composite still admits exactly the own row', async () => {
    // `{ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] }` is what
    // `RLSCompiler.compileFilter` returns for an emptied membership set beside
    // an own-rows grant, and it reaches THIS strategy too through
    // `security.getReadFilter`. A uniform empty-membership throw reddens here —
    // the availability regression #13571's verdict rejected, which this guard
    // must not reintroduce one strategy over.
    const { refusal, admitted } = await outcome({ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] });
    expect(refusal).toBeUndefined();
    expect(admitted).toEqual(['r1']);
  });

  it('OVER-DENIAL CONTROL: the denies-by-itself composite still denies, and is not a refusal', async () => {
    const { refusal, admitted } = await outcome({ $and: [{ owner: { $in: [] } }, { owner: 'u_me' }] });
    expect(refusal).toBeUndefined();
    expect(admitted).toEqual([]);
  });

  it('ORDINARY CASE: a non-empty scope still filters exactly as before', async () => {
    expect((await outcome({ owner: 'u_me' })).admitted).toEqual(['r1']);
    expect((await outcome({ owner: { $in: ['u_me', 'u_other'] } })).admitted).toEqual(['r1', 'r2']);
    // A non-empty EXCLUSION is untouched by the empty-`$nin` rule — including
    // its NULL-safety, which is why r3 is in the answer.
    expect((await outcome({ owner: { $nin: ['u_other'] } })).admitted).toEqual(['r1', 'r3']);
  });
});

// ── The second engine-bound merge on this strategy ─────────────────────────

describe('[#13640] the FK→attribute resolution is the same door, and is guarded too', () => {
  /**
   * `resolveFkAttr` ANDs the REFERENCED object's own scope into a filter handed
   * to `executeAggregate` — the second place on this strategy where a
   * `getReadScope` output reaches an engine without meeting a compiler. A
   * vacating scope there does not widen the aggregate: it widens the FK
   * ATTRIBUTE MAP, so ids the policy hides resolve to their labels instead of
   * bucketing under `(restricted)` (#3654's whole mechanism).
   *
   * A stub bridge is right HERE — the claim is about which merge site the
   * guard stands at, and the lowering it protects against is already measured
   * against a real driver in the first block. The dataset is the in-envelope
   * cross-object grouping from `objectql-crossobj-expand.test.ts`, which is
   * what makes the FK-expand path run at all.
   */
  const dataset = DatasetSchema.parse({
    name: 'sales_by_account',
    label: 'Sales by account',
    object: 'opportunity',
    include: ['account'],
    dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
  });

  const serviceWithRefScope = (refScope: unknown) => {
    const compiled = compileDataset(dataset);
    return new AnalyticsService({
      cubes: [compiled.cube],
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      getAllowedRelationships: () => compiled.allowedRelationships,
      // The BASE object's scope is ordinary; only the REFERENCED object's
      // vacates. So a failure here can only be the FK-resolution door.
      getReadScope: (o: string) =>
        (o === 'opportunity'
          ? { organization_id: 'org_A' }
          : refScope) as unknown as FilterCondition | undefined,
      executeAggregate: async (object: string) =>
        object === 'opportunity'
          ? [
              { account: 'acc_w', revenue: 100 },
              { account: 'acc_hidden', revenue: 5 },
            ]
          : [{ id: 'acc_w', region: 'West' }],
    });
  };

  const run = (refScope: unknown) =>
    serviceWithRefScope(refScope).query({
      cube: 'sales_by_account',
      dimensions: ['region'],
      measures: ['revenue'],
    } as AnalyticsQuery);

  it('CONTROL: an ordinary referenced-object scope still resolves and still buckets the hidden ref', async () => {
    const result = await run({ is_public: true });
    const byRegion = Object.fromEntries(result.rows.map((r) => [r.region, r.revenue]));
    expect(byRegion).toEqual({ West: 100, '(restricted)': 5 });
  });

  it('a vacating referenced-object scope is REFUSED at that merge too', async () => {
    let err: WireBearingError | undefined;
    try {
      await run({ is_public: { $nin: [] } });
    } catch (e) {
      err = e as WireBearingError;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err?.status).toBe(500);
    // Named for the REFERENCED object, which is the whole point of the second
    // call site: `withReadScope` never sees this scope.
    expect(String(err?.message)).toContain('read scope for "account"');
    expect(String(err?.message)).toContain('has an empty $nin at is_public.$nin');
  });
});

// ── Immobility: the two routes #13649 already settled ───────────────────────

describe('[#13640] IMMOBILITY — NativeSQL and the `/analytics/sql` echo did not move', () => {
  it('`compileScopedFilterToSql` still refuses an empty `$nin` with ITS OWN #13571 message', async () => {
    // Not the new guard's message. The two refusals stay distinguishable, which
    // is how a reader can tell which door turned a query away — and how this
    // file proves the guard was ADDED at a new door rather than moved.
    let err: WireBearingError | undefined;
    try {
      compileScopedFilterToSql({ owner: { $nin: [] } } as FilterCondition, 'deal');
    } catch (e) {
      err = e as WireBearingError;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(String(err?.message)).toContain('$nin for "owner" is empty');
    expect(String(err?.message)).not.toContain('read scope for');
  });

  it('`compileScopedFilterToSql` still COMPILES `$not` over `$in: []` — #13571 declared residue, unmoved', async () => {
    // ⚠️ An IMMOBILITY CONTROL, not a contract: #13571's verdict deliberately
    // left this shape unasserted at this lowering, and closing it there needs
    // the polarity-aware design that verdict asked for first. This block
    // asserts only that #13640 did not move it. Whoever closes the residue
    // should EXPECT this to redden and update it in that PR.
    const { sql } = compileScopedFilterToSql(
      { $not: { owner: { $in: [] } } } as FilterCondition,
      'deal',
    );
    expect(sql).toContain('NOT');
  });

  it('an ordinary scope still compiles to the same bound predicate', async () => {
    const { sql, params } = compileScopedFilterToSql({ owner: 'u_me' } as FilterCondition, 'deal');
    expect(sql).toBe('"deal"."owner" = ?');
    expect(params).toEqual(['u_me']);
  });

  it('the ObjectQL `/analytics/sql` echo refuses through the COMPILER, not the new guard', async () => {
    // `generateSql` renders the scope through `compileScopedFilterToSql`, and
    // that is deliberately untouched: the echo's disposition is #13571's.
    const ctx = {
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      getReadScope: () => ({ owner: { $nin: [] } }) as unknown as FilterCondition,
    } as unknown as StrategyContext;

    let err: WireBearingError | undefined;
    try {
      await new ObjectQLStrategy().generateSql(
        { cube: 'deals', dimensions: ['id'], measures: ['n'] } as AnalyticsQuery,
        ctx,
      );
    } catch (e) {
      err = e as WireBearingError;
    }
    expect(err).toBeInstanceOf(Error);
    expect(String(err?.message)).toContain('$nin for "owner" is empty');
  });

  it('the echo still renders an ordinary scope', async () => {
    const ctx = {
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      getReadScope: () => ({ owner: 'u_me' }) as unknown as FilterCondition,
    } as unknown as StrategyContext;

    const { sql } = await new ObjectQLStrategy().generateSql(
      { cube: 'deals', dimensions: ['id'], measures: ['n'] } as AnalyticsQuery,
      ctx,
    );
    expect(sql).toContain('"owner"');
  });
});
