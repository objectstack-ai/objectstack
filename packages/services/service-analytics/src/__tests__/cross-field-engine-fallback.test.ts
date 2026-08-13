// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7598, maintainer ruling 2026-08-12 Q1 = B] A cross-field `{ $field }`
 * comparison is SERVED on the analytics face — by `NativeSQLStrategy.canHandle`
 * declining it, so the query routes to the ObjectQL/engine path where the driver
 * compiles it.
 *
 * ## What this file has to prove, and why "canHandle returned false" is not it
 *
 * The card is explicit that a routing assertion is not the deliverable: "a test
 * proving a `$field`-carrying `where` AND a `$field`-carrying read scope each
 * route to the engine path and RETURN THE RIGHT ROWS — not merely that
 * `canHandle` returned false. The capability working end-to-end is the point."
 *
 * A decline that routes to a path which then refuses, or mis-answers, or drops
 * the predicate, would satisfy every plausible routing test and none of the
 * card. So this suite runs the whole road with a REAL SQL engine at the end of
 * it — `SqliteWasmDriver` (`driver-sqlite-wasm`, one of the two drivers #5222
 * taught to compile the comparison) seeded with the shared corpus fixture — and
 * holds every answer to the corpus's own declared id lists.
 *
 * Three independent statements of the semantics have to agree for a case to
 * pass, which is what makes agreement worth something (the discipline
 * `sql-driver-cross-field-conformance.test.ts` states): the corpus's `expected`,
 * the analytics face's rows, and — since these are the same filters — the driver
 * suites that already run them one package away.
 *
 * ## The setup is the experiment
 *
 * `queryCapabilities` declares **both** `nativeSql` and `objectqlAggregate`, and
 * `executeRawSql` is supplied. That is deliberate and load-bearing: with those
 * three facts, `NativeSQLStrategy` (priority 10) wins `resolveStrategy` for
 * every query unless it declines. So `executeRawSql` never being called is a
 * measurement of the decline rather than of a missing capability, and the
 * literal-comparand controls — which DO reach it — are what stop that
 * measurement from being vacuous.
 *
 * ## Why a `where` arm AND a read-scope arm
 *
 * They are different producers with different authors, and only the second is
 * the one #5041 measured. A `where` is written by the caller; a read scope is
 * compiled by the platform from an ADMIN-authored CEL sharing rule, which is
 * exactly what `compileCelToFilter` emits `{ $field: path }` for. They also
 * travel different code: the `where` goes through `filter-normalizer` →
 * `convertFilter`, the scope through `ObjectQLStrategy.withReadScope`, which
 * ANDs the raw `FilterCondition` into what `engine.aggregate` receives. A test
 * of one says nothing about the other.
 *
 * ## And the refusal arm, on the SAME road
 *
 * Routing is only defensible while the four #5222 rulings still bite after it —
 * same-table columns only, declared-only enumeration, the tenant-isolation
 * column forbidden on BOTH sides, same comparison class. The whole of
 * `CROSS_FIELD_REFUSALS` is driven through the analytics face below and every
 * case is asserted to be refused with an ADR-0112 envelope. What differs is
 * WHICH component refuses, and the suite asserts that split rather than
 * flattening it — see the block's own comment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CROSS_FIELD_CASES,
  CROSS_FIELD_OBJECT_FIELDS,
  CROSS_FIELD_OPERAND_NAMES,
  CROSS_FIELD_REFUSALS,
  CROSS_FIELD_ROWS,
} from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { AggregationNode, Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, DriverQuery } from '@objectstack/spec/contracts';

import { AnalyticsService } from '../analytics-service.js';
import { findCrossFieldComparand } from '../comparand-shape.js';

const OBJECT = 'cross_field_deal';

/** Every column of the corpus fixture, as a plain cube dimension. */
const CUBE: Cube = {
  name: 'deals',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    ['id', 'amount', 'budget', 'stage', 'owner', 'starts_on', 'ends_on', 'organization_id'].map(
      (n) => [n, { name: n, label: n, type: 'string', sql: n }],
    ),
  ),
  public: false,
} as unknown as Cube;

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

describe('[#7598] cross-field `$field` on the analytics face — served via the engine fallback', () => {
  let driver: SqliteWasmDriver;
  let service: AnalyticsService;
  /** Every `executeRawSql` call the run made — the decline's measurement. */
  let rawSqlCalls: string[];
  /** The read scope `getReadScope` answers with, swapped per test. */
  let readScope: FilterCondition | null;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: OBJECT, fields: CROSS_FIELD_OBJECT_FIELDS } as any]);
    for (const row of CROSS_FIELD_ROWS) await driver.create(OBJECT, { ...row });

    rawSqlCalls = [];
    readScope = null;
    service = new AnalyticsService({
      cubes: [CUBE],
      // [#8286] The response-level SQL echo is now debug-gated and OFF by
      // default outside development. It is enabled here on purpose, and the
      // reason is the same one the header gives for declaring both
      // capabilities: an assertion has to be a MEASUREMENT. The pin below —
      // "`/analytics/query` serves the query while the echo declines" — would
      // pass against a service that never echoes anything at all, i.e. it would
      // stop measuring the renderer's decline and start measuring the gate.
      // With the echo on, `sql` being absent again means what this file says it
      // means: `generateSql` refused and `execute()` swallowed the refusal.
      debugSql: true,
      // BOTH paths available — see the header. Native SQL wins unless it declines.
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async (_object, sql) => {
        rawSqlCalls.push(sql);
        return [];
      },
      // The production bridge is `engine.aggregate`; here it is the driver's own
      // `aggregate`, which is what that engine call reaches. The filter is
      // forwarded VERBATIM — no normalisation, no stringification — because the
      // claim under test is that the reference survives this hop intact.
      executeAggregate: async (objectName, options) => {
        // `{field, method, alias}` → `{field, function, alias}`: the analytics
        // strategy speaks the contract's `method`, the Query Protocol's
        // `AggregationNodeSchema` spells it `function`, and `engine.aggregate`
        // is what renames it in production. Mapped here rather than worked
        // around, so the bridge stays the shape a real host writes.
        //
        // The query is typed `DriverQuery` — not `as any` — so this bridge stays
        // inside the contract it is standing in for. Only `method` needs a cast,
        // because the analytics contract types it a plain `string` while
        // `AggregationNode.function` is the closed `AggregationFunction` enum;
        // narrowing the cast to that one field keeps every other key checked.
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
      getReadScope: () => readScope ?? undefined,
    });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  /** Run one analytics query and return the matching ids, ascending. */
  const idsFor = async (query: Partial<AnalyticsQuery>): Promise<string[]> => {
    const result = await service.query({
      cube: 'deals',
      dimensions: ['id'],
      measures: ['n'],
      ...query,
    } as AnalyticsQuery);
    return result.rows.map((r) => String(r.id)).sort();
  };

  const errorFrom = async (run: () => Promise<unknown>): Promise<WireBearingError> => {
    let returned: unknown;
    try {
      returned = await run();
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error(
      `expected the analytics face to refuse this query, but it returned ${JSON.stringify(returned)}`,
    );
  };

  it('the fixture round-tripped with its NULLs intact', async () => {
    // The control every null case depends on. Asserted through THIS driver
    // rather than assumed from the corpus: rows 4-6 are the cells that decide
    // `$eq` / `$ne`, and a NULL that came back as `''` would turn them green
    // for the wrong reason.
    const rows = (await driver.find(OBJECT, {})) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(CROSS_FIELD_ROWS.length);
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    expect(byId.get('6')!.amount).toBeNull();
    expect(byId.get('6')!.budget).toBeNull();
    expect(byId.get('4')!.amount).toBeNull();
    expect(byId.get('5')!.budget).toBeNull();
  });

  // ── The capability, through the caller's `where` ────────────────────────────

  describe('a `$field`-carrying `where` routes to the engine and returns the right rows', () => {
    for (const testCase of CROSS_FIELD_CASES) {
      it(`${testCase.name} — the corpus's own row set`, async () => {
        rawSqlCalls = [];
        readScope = null;
        const note = testCase.note ? `\n${testCase.note}` : '';
        expect(await idsFor({ where: testCase.filter as FilterCondition }), `wrong rows${note}`)
          .toEqual([...testCase.expected].sort());
        // The decline is what put the query here. If native SQL had taken it,
        // the rows above would have come from a spy that returns nothing — so
        // this assertion and the one above are each other's control.
        expect(rawSqlCalls, 'NativeSQLStrategy did not decline').toEqual([]);
      });
    }
  });

  // ── The capability, through an RLS read scope ──────────────────────────────

  describe('a `$field`-carrying READ SCOPE routes to the engine and returns the right rows', () => {
    // The producer #5041 actually measured: `compileCelToFilter` emits this
    // shape for a field-to-field comparison in an admin-authored CEL rule, and
    // the scope reaches the engine down a different road than the `where`
    // (`withReadScope` ANDs the raw FilterCondition in, rather than going
    // through `convertFilter`). Same corpus, same expectations, other door.
    for (const testCase of CROSS_FIELD_CASES) {
      it(`${testCase.name} — the corpus's own row set, as a read scope`, async () => {
        rawSqlCalls = [];
        readScope = testCase.filter as FilterCondition;
        const note = testCase.note ? `\n${testCase.note}` : '';
        expect(await idsFor({}), `wrong rows${note}`).toEqual([...testCase.expected].sort());
        expect(rawSqlCalls, 'NativeSQLStrategy did not decline').toEqual([]);
        readScope = null;
      });
    }

    it('a read scope INTERSECTS the caller`s own where rather than replacing it', async () => {
      // `withReadScope` composes with `$and`, never by key merge — the property
      // that stops caller input overwriting a security predicate. Worth pinning
      // on THIS path because both operands now carry references: the scope is
      // `amount >= budget` (rows 1, 3) and the where is `stage = 'won'` (rows 1,
      // 5), so a composition failure shows as the wrong intersection rather than
      // as an error.
      rawSqlCalls = [];
      readScope = { amount: { $gte: { $field: 'budget' } } } as FilterCondition;
      expect(await idsFor({ where: { stage: 'won' } as FilterCondition })).toEqual(['1']);
      expect(rawSqlCalls).toEqual([]);
      readScope = null;
    });
  });

  // ── The four #5222 rulings still bite, one package over ────────────────────

  describe('the #5222 refusal arm still bites after the routing', () => {
    /**
     * Every corpus refusal is refused on the analytics face — that is the
     * invariant. WHICH component refuses is what the routing changed, and the
     * split is asserted rather than flattened, because flattening it would let a
     * blanket refusal pass as this suite's green.
     *
     *   - A refusal whose reference sits in a SCALAR comparand position is
     *     routed by `canHandle`, so `driver-sql`'s validation gate answers it —
     *     the four rulings, enforced with `initObjects` metadata the analytics
     *     layer never sees. These are the cases the card names: same-table
     *     columns only, declared-only enumeration, the tenant-isolation column
     *     on both sides, same comparison class.
     *   - Every other position (`$in`/`$nin` members, `$between` endpoints, the
     *     LIKE family) is refused by the analytics door itself and never routes.
     *     Those refusals CONVERGE with `driver-sql`'s own refusal arm, so
     *     routing them would swap one 400 for another 400 a package away while
     *     losing this package's more precise wording.
     */
    for (const refusal of CROSS_FIELD_REFUSALS) {
      const routed = findCrossFieldComparand(refusal.filter) !== null;
      it(`${refusal.name} → INVALID_FILTER / 400 (${routed ? 'routed, driver-enforced' : 'refused at the analytics door'})`, async () => {
        rawSqlCalls = [];
        readScope = null;
        const err = await errorFrom(() => idsFor({ where: refusal.filter as FilterCondition }));
        const note = refusal.note ? `\n${refusal.note}` : '';
        expect(err.code, `wrong code${note}`).toBe('INVALID_FILTER');
        expect(err.status, `wrong status${note}`).toBe(400);
        // Never a bind-layer accident dressed up as a refusal.
        expect(err).not.toBeInstanceOf(TypeError);
        expect(err.message).not.toContain('can only bind');
        // [#7929 — B, REWRITTEN by #8220 — A] These cases drive the CALLER's
        // own `where` with NO read scope in play, so under A they are the
        // AUTHOR's: `withReadScope` marks the strategy-built user filter
        // 'author', and the routed driver refusal names the operands again —
        // the corpus's `diagnosticIncludes` substrings are back ON THE WIRE
        // for exactly this caller. B's blanket redaction pin here is
        // superseded the same way the runtime byte-equality pin was
        // (`cross-field-refusal-operand-withhold.test.ts` carries the full
        // account). The withhold itself did not move: a POLICY-injected scope
        // stays redacted — pinned just below, on this same road.
        //
        // ⛔ The `routed === false` half is still deliberately NOT asserted
        // for disclosure the driver way. Those refusals never reach a driver:
        // this package answers them itself with wording that always named
        // both operands, before B and after A alike.
        if (routed) {
          for (const fragment of refusal.diagnosticIncludes) {
            expect(err.message, `author-restored refusal lost "${fragment}"${note}`).toContain(fragment);
          }
        }
        // The native-SQL emitter never saw it either way — declined, or refused
        // before a strategy was chosen.
        expect(rawSqlCalls).toEqual([]);
      });
    }

    it('a refused read scope is refused too, and does not degrade to an unscoped read', async () => {
      // The direction that matters on this door: a scope that cannot be served
      // must never become "no scope". Driven with the tenant-isolation case,
      // the named privilege-escalation surface of the four rulings.
      rawSqlCalls = [];
      readScope = { stage: { $eq: { $field: 'organization_id' } } } as FilterCondition;
      const err = await errorFrom(() => idsFor({}));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      // [#8220] …and it stays REDACTED: the scope is marked 'policy' at
      // `withReadScope`, so A's author-restore above must not leak here. The
      // fail-closed pair of the disclosure assertions in the loop.
      for (const column of CROSS_FIELD_OPERAND_NAMES) {
        expect(err.message, `policy refusal names "${column}"`).not.toContain(column);
      }
      expect(rawSqlCalls).toEqual([]);
      readScope = null;
    });

    it('the four rulings are each represented, so the loop above is not vacuous', () => {
      // The corpus is imported, so a case retired upstream arrives here
      // silently. Without this, a corpus that lost its scalar-position refusals
      // would leave the `routed` half of the loop green over an empty set
      // (#5821's empty-input-set class) — and the routed half IS the card's
      // acceptance criterion.
      const routed = CROSS_FIELD_REFUSALS.filter((r) => findCrossFieldComparand(r.filter));
      const covers = (fragment: string) =>
        routed.some((r) => r.diagnosticIncludes.some((m) => m.includes(fragment)));
      expect(covers('dotted path'), 'ruling 1: same-table columns only').toBe(true);
      expect(covers('not a declared field'), 'ruling 2: declared-only enumeration').toBe(true);
      expect(covers('tenant-isolation column'), 'ruling 2, security half').toBe(true);
      expect(covers('stored as'), 'the comparison-class rule').toBe(true);
      // Both SIDES of the tenant ban — `=` commutes, so a ban a swap walks
      // around is not a ban.
      expect(
        routed.filter((r) => r.diagnosticIncludes.includes('tenant-isolation column')).length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Routing controls: the decline is narrow ────────────────────────────────

  describe('the decline is narrow — a query without a reference still takes native SQL', () => {
    it('a literal comparand keeps the native-SQL path', async () => {
      rawSqlCalls = [];
      readScope = null;
      await idsFor({ where: { amount: { $gt: 5 } } as FilterCondition });
      expect(rawSqlCalls, 'the literal filter should NOT have declined').toHaveLength(1);
      expect(rawSqlCalls[0]).toContain('amount');
    });

    it('a literal read scope keeps the native-SQL path', async () => {
      rawSqlCalls = [];
      readScope = { organization_id: 'o1' } as FilterCondition;
      await idsFor({});
      expect(rawSqlCalls).toHaveLength(1);
      expect(rawSqlCalls[0]).toContain('organization_id');
      readScope = null;
    });

    it('a no-filter query keeps the native-SQL path', async () => {
      rawSqlCalls = [];
      readScope = null;
      await idsFor({});
      expect(rawSqlCalls).toHaveLength(1);
    });

    it('the AUTHORED array spelling declines too — the sugar lowers before the gate', async () => {
      // `['amount', '=', { $field: 'budget' }]` is what a client actually sends,
      // and `canHandle` reads the filter through `lowerAnalyticsWhere` precisely
      // so it sees the reference AFTER `parseFilterAST` has lowered the triple
      // to `{ amount: { $eq: … } }` (#7597). Scanning the raw array would have
      // missed it, and the query would have gone to native SQL and bound the
      // reference — the exact defect, entered through the front door.
      rawSqlCalls = [];
      readScope = null;
      expect(await idsFor({ where: ['amount', '=', { $field: 'budget' }] as unknown as FilterCondition }))
        .toEqual(['3', '6']);
      expect(rawSqlCalls).toEqual([]);
    });
  });

  // ── The one deployment where declining leaves nowhere to go ───────────────

  it('a host with NO aggregate bridge gets a diagnostic naming the reference, not a driver hunt', async () => {
    // The configuration this change creates: `nativeSql` advertised WITHOUT
    // `objectqlAggregate`, so the decline has no lower-priority strategy to
    // fall to. Not reachable from `AnalyticsServicePlugin` — its default
    // capabilities derive both flags from the bridges it wired, and it
    // auto-wires the aggregate bridge from the engine — so this is a host that
    // overrode `queryCapabilities` by hand. It still deserves to be told which
    // of its queries is affected and why, rather than a bare "no strategy can
    // handle this cube" that reads like a broken driver.
    const nativeOnly = new AnalyticsService({
      cubes: [CUBE],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [],
    });
    const run = (where?: unknown) =>
      nativeOnly.query({
        cube: 'deals', dimensions: ['id'], measures: ['n'],
        ...(where ? { where } : {}),
      } as AnalyticsQuery);

    const err = await errorFrom(() => run({ amount: { $gt: { $field: 'budget' } } }));
    expect(err.message).toContain('budget');
    expect(err.message).toContain('executeAggregate');
    expect(err.message).toContain('#7598');

    // …and the narrowness control, which is the half that makes the sentence
    // trustworthy: a literal filter on the SAME deployment still runs.
    await expect(run({ amount: { $gt: 5 } })).resolves.toBeDefined();
  });

  // ── `/analytics/sql` — the echo declines, loudly, with no half-rendering ───

  describe('the `/analytics/sql` echo declines rather than half-rendering', () => {
    const sqlFor = (query: Partial<AnalyticsQuery>) =>
      service.generateSql({
        cube: 'deals',
        dimensions: ['id'],
        measures: ['n'],
        ...query,
      } as AnalyticsQuery);

    it('a `$field`-carrying `where` is refused — INVALID_FILTER / 400', async () => {
      readScope = null;
      const err = await errorFrom(() =>
        sqlFor({ where: { amount: { $gt: { $field: 'budget' } } } as FilterCondition }),
      );
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('$field');
      expect(err.message).toContain('/analytics/query');
    });

    it('a `$field`-carrying READ SCOPE is refused — READ_SCOPE_COMPILE_FAILED / 500', async () => {
      // A different envelope on purpose, and the one the #5367 ruling fixed:
      // a read scope is not the caller's document, so it is not the caller's
      // 4xx. #7598 Q2 = A kept that verbatim — no new ADR-0112 code, no 4xx.
      readScope = { amount: { $gt: { $field: 'budget' } } } as FilterCondition;
      const err = await errorFrom(() => sqlFor({}));
      expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(err.status).toBe(500);
      expect(err.message).toContain('read-scope-sql');
      readScope = null;
    });

    it('the refusal is TOTAL — no partial statement is returned alongside it', async () => {
      // "No half-rendering" is the ruling's own wording. A renderer that emitted
      // the SELECT and dropped the predicate would be the #3601 / #3602 / #3650
      // failure: an echo describing a WIDER query than the one that ran.
      readScope = null;
      const err = await errorFrom(() =>
        sqlFor({ where: { amount: { $gt: { $field: 'budget' } } } as FilterCondition }),
      );
      expect(err.message).not.toContain('SELECT');
    });

    it('…while `/analytics/query` still SERVES the same query — the echo is the only thing that declines', async () => {
      // The pair that makes the point: one face returns rows, the other refuses,
      // and that is deliberate rather than an inconsistency. `execute()` calls
      // `generateSql` inside a try/catch precisely because the echo is a
      // debugging aid that must never fail a query that already ran, so the
      // response simply carries no `sql` string.
      readScope = null;
      rawSqlCalls = [];
      const result = await service.query({
        cube: 'deals',
        dimensions: ['id'],
        measures: ['n'],
        where: { amount: { $gt: { $field: 'budget' } } } as FilterCondition,
      } as AnalyticsQuery);
      expect(result.rows.map((r) => String(r.id))).toEqual(['1']);
      expect(result.sql, 'the echo must be absent, not half-rendered').toBeUndefined();
      expect(rawSqlCalls).toEqual([]);
    });

    it('a literal filter still renders an echo — the decline is narrow here too', async () => {
      readScope = null;
      const { sql } = await sqlFor({ where: { amount: { $gt: 5 } } as FilterCondition });
      expect(sql).toContain('SELECT');
      expect(sql).toContain('amount');
    });
  });
});
