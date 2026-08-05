// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5325] The analytics filter NORMALIZER answers `$not` and the boolean
 * identities the way the rest of the repo answers them.
 *
 * # Why a second file in this package
 *
 * `read-scope-not-null-safe.test.ts` (#5297) pins the same three squares for
 * `read-scope-sql.ts` — the RLS lowering. This file pins them for the OTHER
 * SQL-producing path in the package: the author's own `where`, normalized by
 * `filter-normalizer.ts` and compiled by BOTH strategies. The two are separate
 * functions; fixing one left the other carrying every defect, because
 * `buildNode` was written from `compileNode` and inherited them (that is why
 * `filter-normalizer.ts`'s own header says the two must not drift).
 *
 * `native-sql-filter-logic-conformance.test.ts` already runs the shared
 * `FILTER_LOGIC_CASES` table against a real SQLite engine and was green through
 * all three defects: that table deliberately carries no NULL rows and no
 * boolean-identity case (#5239 / the spec half of #5146 land those). These cases
 * are the pin until the shared table absorbs them.
 *
 * # The three defects, as measured on the fixture below
 *
 * | `where`                                       | was      | now (= JS family) |
 * |-----------------------------------------------|----------|-------------------|
 * | `{$not: {stage: 'won'}}`                      | `2`      | `2,3,4`           |
 * | `{$not: {stage: {$in: ['won']}}}`             | `2`      | `2,3,4`           |
 * | `{$not: {}}`                                  | ALL      | zero rows         |
 * | `{$or: [{stage: 'won'}, {}]}`                 | `1`      | ALL               |
 * | `{$not: {$or: [{stage:'won'},{owner:'u1'}]}}` | `2`      | `2,4`             |
 *
 *   - `$not` emitted a bare `NOT (…)`. SQL is three-valued and a `WHERE` keeps
 *     only TRUE, so every row whose column is NULL fell into UNKNOWN and
 *     vanished — while `driver-memory`, `formula` and (since #5296) `driver-sql`
 *     return those rows. One widget filter, two row sets, chosen by which
 *     backend answered.
 *   - `buildNode({})` returns `null` (= no constraint = TRUE) and the `$not`
 *     branch tested `if (inner)`, so `{$not: {}}` — the ZERO-row filter —
 *     produced no node, no `WHERE`, and a chart drawn over the entire dataset.
 *   - a `{}` disjunct was dropped by `.filter(n => n !== null)`, collapsing
 *     `$or` to its surviving branches. TRUE ABSORBS a disjunction; dropping it
 *     silently NARROWED the query instead.
 *
 * # Where the expected ids come from
 *
 * Measured, not reasoned: the fixture is row-for-row `driver-sql`'s
 * `sql-driver-not-null-safe.test.ts`, and every id set below is the answer that
 * file, `formula/src/matches-filter-not-null-safe.test.ts`,
 * `driver-memory/src/memory-matcher-not-null-safe.test.ts` and this package's
 * own `read-scope-not-null-safe.test.ts` assert for the same filter. Moving an
 * expectation here re-opens the divergence #5146 closed.
 *
 * `sql.js` (pure WASM) is the engine, for the reason spelled out at the top of
 * `native-sql-filter-logic-conformance.test.ts`: a native binding is loadable
 * only by the exact Node ABI it was built for and aborts the vitest worker on
 * CI's Node, taking the file's cases silently with it.
 *
 * # The FOURTH square, added by #5332
 *
 * The last block pins what #5325 could not: a `null` COMPARAND. `{stage: null}`
 * compiled to `IS NULL` while `{stage: {$eq: null}}` — the same predicate, and
 * literally what `driver-mongodb` rewrites `{$null: true}` into — compiled to
 * `stage = ''`, so the file's own emitter answered one question two ways.
 * Pinning the `$not` row set for it while that held would have frozen the wrong
 * answer, which is why the two ids in `'the OPERATOR spellings of a null
 * comparand are untouched too'` were deliberately absent until now.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

/**
 * Rows 3 and 4 are the point: `stage` is NULL in both, row 3 additionally
 * carries a NULL `amount` and row 4 a NULL `owner`, so a guard applied to the
 * wrong column shows up as a wrong id rather than passing by luck.
 */
const FIXTURE = [
  { id: '1', stage: 'won', owner: 'u1', amount: 10 },
  { id: '2', stage: 'lost', owner: 'u2', amount: 20 },
  { id: '3', stage: null, owner: 'u1', amount: null },
  { id: '4', stage: null, owner: null, amount: 40 },
];

const ALL = ['1', '2', '3', '4'];

const CUBE: Cube = {
  name: 'deals',
  title: 'Deals',
  sql: 'deal',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: Object.fromEntries(
    ['id', 'stage', 'owner', 'amount'].map((n) => [
      n,
      { name: n, label: n, type: n === 'amount' ? 'number' : 'string', sql: n },
    ]),
  ),
  public: false,
} as unknown as Cube;

/** Point sql.js at the `.wasm` shipped inside its own package (Node-safe). */
async function locateWasm(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    const dir = dirname(pkgJsonPath);
    return (file: string) => join(dir, 'dist', file);
  } catch {
    return undefined;
  }
}

describe('[#5325] analytics `where` — NULL-safe `$not` and the boolean identities', () => {
  let db: any;
  let nativeCtx: StrategyContext;
  /** The engine filter the ObjectQL path last handed to `executeAggregate`. */
  let lastEngineFilter: Record<string, unknown> | undefined;
  let objectqlCtx: StrategyContext;

  /** Run a statement in the strategy's `$n` dialect and return the id column. */
  const run = (sql: string, params: unknown[]): string[] => {
    const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
    stmt.bind(params as any[]);
    const out: string[] = [];
    while (stmt.step()) out.push(String(stmt.getAsObject().id));
    stmt.free();
    return out.sort((x, y) => x.localeCompare(y));
  };

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`CREATE TABLE "deal" ("id" TEXT PRIMARY KEY, "stage" TEXT, "owner" TEXT, "amount" REAL);`);
    const insert = db.prepare(`INSERT INTO "deal" ("id","stage","owner","amount") VALUES (?,?,?,?)`);
    for (const r of FIXTURE) insert.run([r.id, r.stage, r.owner, r.amount]);
    insert.free();

    nativeCtx = {
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
        const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
        stmt.bind(params as any[]);
        const out: Record<string, unknown>[] = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        return out;
      },
    } as StrategyContext;

    // The ObjectQL path hands a `FilterCondition` to the engine rather than SQL.
    // `compileScopedFilterToSql` — this package's OTHER FilterCondition consumer,
    // already NULL-safe since #5297 — stands in for the engine, so the condition
    // is EXECUTED rather than merely inspected, and the double guard the module
    // header predicts is exercised for real.
    objectqlCtx = {
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (
        _object: string,
        options: { groupBy?: string[]; filter?: Record<string, unknown> },
      ) => {
        lastEngineFilter = options.filter;
        const { sql, params } = compileScopedFilterToSql(
          (options.filter ?? {}) as FilterCondition,
          'deal',
        );
        const stmt = db.prepare(
          `SELECT "id" FROM "deal" AS "deal" WHERE ${sql.length > 0 ? sql : '1 = 1'}`,
        );
        stmt.bind(params as any[]);
        const out: Record<string, unknown>[] = [];
        while (stmt.step()) out.push({ ...stmt.getAsObject(), total: 1 });
        stmt.free();
        return out;
      },
    } as StrategyContext;
  });

  afterAll(() => {
    db?.close();
  });

  const query = (where: unknown): AnalyticsQuery => ({
    cube: 'deals',
    measures: ['total'],
    dimensions: ['id'],
    timezone: 'UTC',
    where,
  } as AnalyticsQuery);

  /**
   * The rows this `where` admits on the raw-SQL path, executed end to end
   * through `NativeSQLStrategy` — the seam, not the compiler in isolation. A
   * filter that compiles to nothing turns into a query with no `WHERE` HERE,
   * one call above the compiler, which is exactly how `{$not: {}}` used to
   * escape (#5297's lesson).
   */
  const ids = async (where: unknown): Promise<string[]> => {
    const result = await new NativeSQLStrategy().execute(query(where), nativeCtx);
    return result.rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));
  };

  const sqlFor = async (where: unknown): Promise<{ sql: string; params: unknown[] }> =>
    new NativeSQLStrategy().generateSql(query(where), nativeCtx);

  /** The same `where` through the ObjectQL path: normalizer → engine filter. */
  const engineIds = async (where: unknown): Promise<string[]> => {
    const result = await new ObjectQLStrategy().execute(query(where), objectqlCtx);
    return result.rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));
  };

  // ── The issue's measured table, one case per row ───────────────────────────

  describe('the five measured cases', () => {
    it('`{$not: {stage: "won"}}` returns the NULL-stage rows — was `2`', async () => {
      expect(await ids({ $not: { stage: 'won' } })).toEqual(['2', '3', '4']);
    });

    it('`{$not: {stage: {$in: ["won"]}}}` returns them too — was `2`', async () => {
      expect(await ids({ $not: { stage: { $in: ['won'] } } })).toEqual(['2', '3', '4']);
    });

    it('`{$not: {}}` matches NO row — was the whole dataset', async () => {
      expect(await ids({ $not: {} })).toEqual([]);
    });

    it('`{$or: [{stage: "won"}, {}]}` matches EVERY row — was `1`', async () => {
      expect(await ids({ $or: [{ stage: 'won' }, {}] })).toEqual(ALL);
    });

    it('`{$not: {$or: […]}}` excludes a NULL row whose OTHER branch matches — was `2`', async () => {
      // Row 3 has a NULL stage but owner = 'u1', so the inner `$or` IS satisfied
      // and the negation must reject it. A guard hoisted above the `$not` instead
      // of pushed to the leaves would hand row 3 back — the reason the rewrite is
      // per leaf.
      expect(await ids({ $not: { $or: [{ stage: 'won' }, { owner: 'u1' }] } })).toEqual(['2', '4']);
    });
  });

  // ── Defect: `{$not: {}}` emitted no WHERE at all ──────────────────────────

  describe('`{$not: {}}` is FALSE, and it reaches the generated SQL', () => {
    it('compiles to the constant-false clause inside a real WHERE', async () => {
      // Was: no `$not` node at all → `whereClauses` empty → `SELECT … FROM "deal"
      // GROUP BY …` with no `WHERE`, i.e. every row under a filter meaning "none".
      const { sql, params } = await sqlFor({ $not: {} });
      expect(sql).toContain('WHERE');
      expect(sql).toContain('1 = 0');
      expect(params).toEqual([]);
    });

    it('stays FALSE next to a real predicate, in either key order', async () => {
      expect(await ids({ $and: [{ owner: 'u1' }, { $not: {} }] })).toEqual([]);
      expect(await ids({ owner: 'u1', $not: {} })).toEqual([]);
      expect(await ids({ $not: {}, owner: 'u1' })).toEqual([]);
    });

    it('a `$not` of a FALSE filter is TRUE again', async () => {
      expect(await ids({ $not: { $not: {} } })).toEqual(ALL);
      // Folded to the constant rather than left as a `NOT (1 = 0)` that only
      // happens to evaluate right.
      const { sql } = await sqlFor({ $not: { $not: {} } });
      expect(sql).toContain('1 = 1');
      expect(sql).not.toContain('NOT (');
    });

    it('a FALSE disjunct does not absorb an `$or` — it is the OR identity', async () => {
      expect(await ids({ $or: [{ stage: 'won' }, { $not: {} }] })).toEqual(['1']);
    });
  });

  // ── Defect: the dropped `{}` disjunct ─────────────────────────────────────

  describe('a `{}` disjunct makes the whole `$or` TRUE', () => {
    it('binds NOTHING — the discarded branch takes its comparand with it', async () => {
      // Worse than a wide query: a value left in `params` with no `$n` to consume
      // it shifts every later placeholder onto the wrong value, so a filter binds
      // a comparand the author never wrote (#5297).
      const { sql, params } = await sqlFor({ $or: [{ stage: 'won' }, {}] });
      expect(params).toEqual([]);
      expect(sql).not.toContain('WHERE');
    });

    it('keeps the rest of the filter aligned when a later predicate follows', async () => {
      // The alignment case in full: an absorbed `$or` in front of a surviving
      // predicate. `owner = 'u1'` must bind `$1`, not `$2`.
      const { sql, params } = await sqlFor({ $and: [{ $or: [{ stage: 'won' }, {}] }, { owner: 'u1' }] });
      expect(params).toEqual(['u1']);
      expect(sql).toContain('$1');
      expect(sql).not.toContain('$2');
      expect(await ids({ $and: [{ $or: [{ stage: 'won' }, {}] }, { owner: 'u1' }] })).toEqual(['1', '3']);
    });

    it('holds at depth and in either order', async () => {
      expect(await ids({ $or: [{}, { stage: 'won' }] })).toEqual(ALL);
      expect(await ids({ $or: [{}, {}] })).toEqual(ALL);
      expect(await ids({ $or: [{ $or: [{ stage: 'won' }, {}] }, { owner: 'u2' }] })).toEqual(ALL);
    });

    it('a `{}` member of a `$and` is still just the identity', async () => {
      expect(await ids({ $and: [{}, { stage: 'won' }] })).toEqual(['1']);
      const { params } = await sqlFor({ $and: [{}, { stage: 'won' }] });
      expect(params).toEqual(['won']);
    });
  });

  // ── Defect: NULL-safe negation, per operator ──────────────────────────────

  describe('a NULL column does not satisfy the negated condition', () => {
    it('the guard rides the LEAF, so the emitted SQL negates a TOTAL predicate', async () => {
      const { sql } = await sqlFor({ $not: { stage: 'won' } });
      expect(sql).toBe(
        'SELECT id AS "id", COUNT(*) AS "total" FROM "deal" ' +
        'WHERE NOT ((stage IS NOT NULL AND stage = $1)) GROUP BY id',
      );
    });

    it('`$not` over MULTIPLE columns admits a row that is NULL in EITHER', async () => {
      expect(await ids({ $not: { stage: 'won', owner: 'u1' } })).toEqual(['2', '3', '4']);
    });

    it('`$not` of a `$and` admits every row failing either conjunct', async () => {
      expect(await ids({ $not: { $and: [{ stage: 'won' }, { owner: 'u1' }] } })).toEqual(['2', '3', '4']);
    });

    it('a double negation is the positive filter again, NULL rows excluded', async () => {
      expect(await ids({ $not: { $not: { stage: 'won' } } })).toEqual(['1']);
      expect(await ids({ $not: { $not: { stage: 'won' } } })).toEqual(await ids({ stage: 'won' }));
    });

    it('`$not` still ANDs with its sibling keys', async () => {
      expect(await ids({ $not: { stage: 'won' }, owner: 'u1' })).toEqual(['3']);
    });

    it('a `$not` nested inside a `$or` branch stays NULL-safe', async () => {
      expect(await ids({ $or: [{ $not: { stage: 'won' } }, { owner: 'u2' }] })).toEqual(['2', '3', '4']);
    });

    it('`$not` of `$ne` / `$nin` is NOT widened — polarity is per operator', async () => {
      // A blanket `OR stage IS NULL` would hand back rows 3 and 4, i.e. rows the
      // filter excludes. `{$not: {$ne: 'won'}}` means "stage IS won".
      expect(await ids({ $not: { stage: { $ne: 'won' } } })).toEqual(['1']);
      expect(await ids({ $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
      const { sql } = await sqlFor({ $not: { stage: { $ne: 'won' } } });
      expect(sql).toContain('NOT ((stage IS NULL OR stage != $1))');
    });

    it('`$not` of an ordering comparison returns the NULL rows', async () => {
      expect(await ids({ $not: { amount: { $gt: 15 } } })).toEqual(['1', '3']);
    });

    it('`$not` of `$between` returns the NULL rows', async () => {
      // `$between` lowers to `gte` + `lte` here; both are positive comparisons,
      // so the pair takes the same guard a single comparison does.
      expect(await ids({ $not: { amount: { $between: [15, 30] } } })).toEqual(['1', '3', '4']);
    });

    it('`$not` of `$contains` / `$startsWith` / `$endsWith` returns the NULL rows', async () => {
      expect(await ids({ $not: { stage: { $contains: 'w' } } })).toEqual(['2', '3', '4']);
      expect(await ids({ $not: { stage: { $startsWith: 'w' } } })).toEqual(['2', '3', '4']);
      expect(await ids({ $not: { stage: { $endsWith: 'n' } } })).toEqual(['2', '3', '4']);
    });

    it('`$not` of `$notContains` does NOT return them — the mirror case', async () => {
      // The one operator where the two JS backends disagree for a null-valued
      // field; `formula` is followed, as `driver-sql` and `read-scope-sql` follow
      // it, so this module casts no vote on a disagreement filed elsewhere.
      expect(await ids({ $not: { stage: { $notContains: 'w' } } })).toEqual(['1']);
    });

    it('`$not` of a null predicate is untouched — it was already two-valued', async () => {
      expect(await ids({ $not: { stage: { $null: true } } })).toEqual(['1', '2']);
      expect(await ids({ $not: { stage: { $null: false } } })).toEqual(['3', '4']);
      expect(await ids({ $not: { stage: { $exists: true } } })).toEqual(['3', '4']);
      expect(await ids({ $not: { stage: { $exists: false } } })).toEqual(['1', '2']);
      // No guard is wrapped around a predicate that can never be UNKNOWN.
      const { sql } = await sqlFor({ $not: { stage: { $null: true } } });
      expect(sql).toContain('WHERE NOT (stage IS NULL)');
    });

    it('`{field: null}` under a `$not` is untouched too', async () => {
      expect(await ids({ $not: { stage: null } })).toEqual(['1', '2']);
    });

    it('[#5332] the OPERATOR spellings of a `null` comparand are untouched too', async () => {
      // The pin this file deliberately WITHHELD. While `$eq: null` compiled to
      // `stage = ''` the guard table read it as an ordinary value comparison, so
      // `{$not: {stage: {$eq: null}}}` became `NOT (stage IS NOT NULL AND stage =
      // '')` — a negated always-false conjunction, i.e. EVERY row, for a filter
      // meaning "stage is not empty" — and `{$not: {stage: {$ne: null}}}` became
      // `NOT (stage IS NULL OR stage != '')`, i.e. NO row, for "stage is empty".
      // Pinning either then would have frozen the wrong answer, so #5325 left
      // both out and filed the comparand as #5332; these are its ids.
      //
      // Measured, not reasoned — the same two id sets the other three backends
      // already assert for these filters on this fixture:
      // `read-scope-not-null-safe.test.ts` (this package's other compiler),
      // `driver-sql/sql-driver-not-null-safe.test.ts` and
      // `formula/matches-filter-not-null-safe.test.ts`.
      expect(await ids({ $not: { stage: { $eq: null } } })).toEqual(['1', '2']);
      expect(await ids({ $not: { stage: { $ne: null } } })).toEqual(['3', '4']);
      // Total already, so NO guard conjunct is wrapped around either — the same
      // treatment `{$null: true}` gets two tests up.
      expect((await sqlFor({ $not: { stage: { $eq: null } } })).sql).toContain('WHERE NOT (stage IS NULL)');
      expect((await sqlFor({ $not: { stage: { $ne: null } } })).sql).toContain('WHERE NOT (stage IS NOT NULL)');
      expect((await sqlFor({ $not: { stage: { $eq: null } } })).params).toEqual([]);
    });

    it('an empty `$in` / `$nin` under a `$not` keeps its constant value', async () => {
      // Both are boolean CONSTANTS, so they are total and take no guard — and a
      // constant must survive the negation rather than be dropped from it.
      expect(await ids({ $not: { stage: { $in: [] } } })).toEqual(ALL);
      expect(await ids({ $not: { stage: { $nin: [] } } })).toEqual([]);
    });

    it('a guarded relation traversal guards the DOTTED member, not its alias', async () => {
      // `{account: {region: 'NA'}}` flattens to the member `account.region` (the
      // normalizer's own dotted-key flattening), so the guard has to flatten the
      // same way: guarding `account` would test the relation, not the column the
      // leaf reads. Asserted on the generated SQL only — `region` is not a column
      // of this fixture, which is the point: both halves resolve to ONE member.
      const { sql } = await sqlFor({ $not: { account: { region: 'NA' } } });
      expect(sql).toContain('NOT (("account"."region" IS NOT NULL AND "account"."region" = $1))');
      expect(sql).not.toContain('"deal"."account" IS NOT NULL');
    });
  });

  // ── An empty set is a constant, not an absent predicate ───────────────────

  describe('an empty `$in` / bare `[]` is the FALSE constant, not a dropped clause', () => {
    it('`{stage: {$in: []}}` matches no row — was the whole dataset', async () => {
      expect(await ids({ stage: { $in: [] } })).toEqual([]);
      const { sql } = await sqlFor({ stage: { $in: [] } });
      expect(sql).toContain('1 = 0');
    });

    it('`{stage: {$nin: []}}` excludes nothing', async () => {
      expect(await ids({ stage: { $nin: [] } })).toEqual(ALL);
    });

    it('a bare `[]` is the same constant its explicit spelling is', async () => {
      expect(await ids({ stage: [] })).toEqual([]);
    });

    it('it composes: FALSE absorbs an `$and`, is the identity of an `$or`', async () => {
      expect(await ids({ $and: [{ stage: { $in: [] } }, { owner: 'u1' }] })).toEqual([]);
      expect(await ids({ $or: [{ stage: { $in: [] } }, { owner: 'u1' }] })).toEqual(['1', '3']);
    });
  });

  // ── The ObjectQL path: the guard survives as STRUCTURE ────────────────────

  describe('the ObjectQL path gets the same rows, through a FilterCondition', () => {
    it('hands the engine a guard that is STRUCTURE, not SQL', async () => {
      expect(await engineIds({ $not: { stage: 'won' } })).toEqual(['2', '3', '4']);
      // The guard travels as one more conjunct inside the `$not`, so any driver
      // behind the engine — NULL-safe or not — admits the same rows. Rendering it
      // only in the SQL strategy would have made the answer depend on the driver.
      expect(JSON.stringify(lastEngineFilter)).toContain('$ne');
      expect(JSON.stringify(lastEngineFilter)).toContain('$not');
    });

    it('DOUBLE-guarding is idempotent — the stand-in engine guards again', async () => {
      // `compileScopedFilterToSql` runs its OWN `nullSafeNegationOperand` over
      // the condition this path already guarded, so the executed SQL carries the
      // guard twice. `NOT (c IS NOT NULL AND (c IS NOT NULL AND c = v))` is the
      // same predicate as the single-guarded form: redundant, not wrong. That is
      // the trade the module header names — one extra conjunct for portability.
      const { sql } = compileScopedFilterToSql(
        lastEngineFilter as FilterCondition,
        'deal',
      );
      expect(sql.match(/IS NOT NULL/g)?.length).toBeGreaterThanOrEqual(2);
      expect(run(`SELECT "id" FROM "deal" AS "deal" WHERE ${sql}`, ['won'])).toEqual(['2', '3', '4']);
    });

    it('`{$not: {}}` reaches the engine as the zero-row filter', async () => {
      expect(await engineIds({ $not: {} })).toEqual([]);
      // `{$not: {}}` is the spelling `driver-sql`, `formula` and driver-memory's
      // matcher already pin as FALSE (#5134); this strategy invents no second one.
      expect(lastEngineFilter).toEqual({ $and: [{ $not: {} }] });
    });

    it('a `{}` disjunct absorbs the `$or` on this path too', async () => {
      expect(await engineIds({ $or: [{ stage: 'won' }, {}] })).toEqual(ALL);
      // `withReadScope` maps an EMPTY filter to `undefined` — no constraint at
      // all, which is what an absorbed `$or` means. Was `{stage: 'won'}`.
      expect(lastEngineFilter).toBeUndefined();
    });

    it('the remaining measured cases agree row for row with the SQL path', async () => {
      for (const where of [
        { $not: { stage: { $in: ['won'] } } },
        { $not: { $or: [{ stage: 'won' }, { owner: 'u1' }] } },
        { $not: { stage: { $ne: 'won' } } },
        { $not: { amount: { $gt: 15 } } },
        { $not: { stage: { $null: true } } },
        { stage: { $in: [] } },
        { $or: [{ stage: { $in: [] } }, { owner: 'u1' }] },
      ]) {
        expect(await engineIds(where), JSON.stringify(where)).toEqual(await ids(where));
      }
    });
  });

  // ── The THIRD compiler: the display SQL `/analytics/sql` echoes ───────────

  describe('the echoed display SQL renders the identities too', () => {
    const echo = async (where: unknown): Promise<{ sql: string; params: unknown[] }> =>
      new ObjectQLStrategy().generateSql(query(where), objectqlCtx);

    it('`{$not: {}}` echoes a constant-false WHERE, not an unfiltered SELECT', async () => {
      // The echo exists to REPRODUCE execution. A statement with no `WHERE`
      // handed to whoever is debugging "why is this chart empty" returns the
      // whole table and cannot reproduce the result — the lie this rendering
      // block's own comment warns about, in the other direction.
      const { sql, params } = await echo({ $not: {} });
      expect(sql).toContain('WHERE');
      expect(sql).toContain('1 = 0');
      expect(params).toEqual([]);
    });

    it('an absorbed `$or` echoes no WHERE and binds nothing', async () => {
      const { sql, params } = await echo({ $or: [{ stage: 'won' }, {}] });
      expect(sql).not.toContain('WHERE');
      expect(params).toEqual([]);
    });

    it('an absorbed `$or` does not shift a later placeholder', async () => {
      const { sql, params } = await echo({ $and: [{ $or: [{ stage: 'won' }, {}] }, { owner: 'u1' }] });
      expect(params).toEqual(['u1']);
      expect(sql).toContain('$1');
      expect(sql).not.toContain('$2');
    });

    it('a NULL-safe `$not` echoes the guard it executes', async () => {
      const { sql } = await echo({ $not: { stage: 'won' } });
      expect(sql).toContain('NOT (');
      expect(sql).toContain('stage IS NOT NULL');
    });

    it('an empty `$in` echoes the constant', async () => {
      const { sql } = await echo({ stage: { $in: [] } });
      expect(sql).toContain('1 = 0');
    });
  });

  // ── Nothing that failed closed stopped failing closed ─────────────────────

  describe('the fail-closed guarantees survive the rewrite', () => {
    it('an empty `$and` / `$or` reduces to its boolean identity, inside a `$not` as well as outside (#5322)', async () => {
      // FLIPPED pin. When this file was written the empty-combinator square was
      // still an open ruling, so all five shapes were pinned on the THROWING
      // side (`toThrowError(/non-empty array/)`). The 2026-08-04 #5322 ruling
      // took the boolean identities, and the pins flipped with it: `{$and: []}`
      // is TRUE, `{$or: []}` is FALSE, and — the half that survives from the
      // old pin's intent — the `$not` negates the REDUCED operand rather than
      // quietly changing the answer on the way past.
      await expect(ids({ $and: [] })).resolves.toEqual(ALL); //  TRUE — the AND identity
      await expect(ids({ $or: [] })).resolves.toEqual([]); //    FALSE — the OR identity
      await expect(ids({ $not: { $and: [] } })).resolves.toEqual([]); //  NOT TRUE ≡ FALSE
      await expect(ids({ $not: { $or: [] } })).resolves.toEqual(ALL); // NOT FALSE ≡ TRUE
      // A `{$and: []}` disjunct is a TRUE branch and ABSORBS its `$or` —
      // exactly as the literal `{}` disjunct does two blocks up.
      await expect(ids({ $or: [{ stage: 'won' }, { $and: [] }] })).resolves.toEqual(ALL);
      // The other direction: a `{$or: []}` disjunct is FALSE, the OR identity —
      // the disjunction collapses to its real branch, NULL-safety intact.
      await expect(ids({ $not: { $or: [{ stage: 'won' }, { $or: [] }] } })).resolves.toEqual(['2', '3', '4']);
    });

    it('a non-array `$and` / `$or` still THROWS — #5322 loosened only the EMPTY array', async () => {
      await expect(ids({ $and: 'x' })).rejects.toThrowError(/requires an array/);
      await expect(ids({ $or: { stage: 'won' } })).rejects.toThrowError(/requires an array/);
    });

    it('an unknown operator inside a `$not` still THROWS rather than being guarded', async () => {
      await expect(ids({ $not: { stage: { $regex: '.*' } } })).rejects.toThrowError(/Unsupported filter operator/);
      await expect(ids({ $not: { $nor: [{ stage: 'won' }] } })).rejects.toThrowError(/Unsupported top-level filter operator/);
    });

    it('a non-object `$not` operand is REFUSED, not silently dropped', async () => {
      // Was: `typeof null === 'object'` → `buildNode` on a non-node → no node →
      // the negation vanished and the query widened to every row. A `$or` branch
      // of garbage is refused for the mirror reason: skipping it narrows, and
      // reading it as TRUE widens.
      await expect(ids({ $not: null })).rejects.toThrowError(/"\$not" requires a filter object/);
      await expect(ids({ $not: 'x' })).rejects.toThrowError(/"\$not" requires a filter object/);
      await expect(ids({ $not: [] })).rejects.toThrowError(/"\$not" requires a filter object/);
      await expect(ids({ $or: [{ stage: 'won' }, 'x'] })).rejects.toThrowError(/branches must be filter objects/);
      await expect(ids({ $and: [null] })).rejects.toThrowError(/branches must be filter objects/);
    });

    it('a zero-operator field constraint is REFUSED (#5240), not read as TRUE', async () => {
      // Forced by this change rather than chosen: `{a: {}}` produced no leaf,
      // "no leaf" IS the constant TRUE, and TRUE now absorbs a `$or` — so left
      // alone, `{$or: [{a: {}}, {b: 2}]}` would have gone from `b = 2` to every
      // row. #5240 already ruled the shape refused on every backend (driver-sql,
      // driver-memory, formula); this is the same refusal at the analytics door.
      await expect(ids({ stage: {} })).rejects.toThrowError(/zero operators/);
      await expect(ids({ $or: [{ stage: {} }, { owner: 'u1' }] })).rejects.toThrowError(/zero operators/);
      await expect(ids({ $not: { stage: {} } })).rejects.toThrowError(/zero operators/);
      // A nested relation is NOT this shape and still flattens.
      const { sql } = await sqlFor({ account: { region: 'NA' } });
      expect(sql).toContain('"account"."region" = $1');
    });

    it('an undefined value is still skipped, as it always was', async () => {
      expect(await ids({ stage: undefined, owner: 'u1' })).toEqual(['1', '3']);
      expect(await ids({ $not: undefined, owner: 'u1' })).toEqual(['1', '3']);
    });

    it('an ordinary filter compiles to exactly the SQL it always did', async () => {
      const { sql, params } = await sqlFor({ stage: 'won' });
      expect(sql).toContain('WHERE stage = $1');
      expect(params).toEqual(['won']);
      expect(await ids({ stage: 'won' })).toEqual(['1']);
      // Still three-valued OUTSIDE a negation: `!= 'won'` drops the NULL rows.
      // That divergence from the JS backends is real and out of #5146's scope.
      expect(await ids({ stage: { $ne: 'won' } })).toEqual(['2']);
      expect(await ids({})).toEqual(ALL);
    });
  });

  // ── [#5332] A `null` comparand is a null PREDICATE, not the empty string ───

  /**
   * [#5332] `{stage: {$eq: null}}` compiled to `stage = ''`, `{$ne: null}` to
   * `stage != ''`, while `{stage: null}` in the same file compiled to `IS NULL`.
   *
   * One meaning, two answers, one file. The measured table from the issue is the
   * first block below, asserted on the generated SQL and its bindings because
   * that is where the divergence lived; the row sets follow.
   *
   * `{$eq: null}` is not merely a near-synonym of `{$null: true}`:
   * `driver-mongodb`'s translator REWRITES the latter into the former
   * (`mongodb-filter.ts`'s `$null` arm), so the two are one predicate in the
   * contract, and `read-scope-sql.ts`, `driver-sql`, `driver-memory` and
   * `formula` all compile them alike. This module was the one dissenting half of
   * one package.
   */
  describe('[#5332] `$eq: null` / `$ne: null` are `IS NULL` / `IS NOT NULL`', () => {
    it("the issue's measured table: all four spellings, SQL and bindings", async () => {
      // | `where`                  | was              | now              |
      // |--------------------------|------------------|------------------|
      // | `{stage: null}`          | `IS NULL`    ✅  | unchanged        |
      // | `{stage: {$eq: null}}`   | `= $1` / `['']`  | `IS NULL`        |
      // | `{stage: {$ne: null}}`   | `!= $1` / `['']` | `IS NOT NULL`    |
      // | `{stage: {$null: true}}` | `IS NULL`    ✅  | unchanged        |
      const bare = await sqlFor({ stage: null });
      expect(bare.sql).toContain('WHERE stage IS NULL');
      expect(bare.params).toEqual([]);

      const eqNull = await sqlFor({ stage: { $eq: null } });
      expect(eqNull.sql).toContain('WHERE stage IS NULL');
      expect(eqNull.params).toEqual([]);

      const neNull = await sqlFor({ stage: { $ne: null } });
      expect(neNull.sql).toContain('WHERE stage IS NOT NULL');
      expect(neNull.params).toEqual([]);

      const nullTrue = await sqlFor({ stage: { $null: true } });
      expect(nullTrue.sql).toContain('WHERE stage IS NULL');
      expect(nullTrue.params).toEqual([]);
    });

    it('the row sets agree with the other three spellings', async () => {
      // Was `[]` for `$eq: null` — an "is empty" widget drew NOTHING, with no
      // error to read, because `stage = ''` cannot match a NULL column.
      expect(await ids({ stage: { $eq: null } })).toEqual(['3', '4']);
      expect(await ids({ stage: { $ne: null } })).toEqual(['1', '2']);
      // The four spellings of one predicate, row for row.
      expect(await ids({ stage: { $eq: null } })).toEqual(await ids({ stage: null }));
      expect(await ids({ stage: { $eq: null } })).toEqual(await ids({ stage: { $null: true } }));
      expect(await ids({ stage: { $ne: null } })).toEqual(await ids({ stage: { $null: false } }));
      expect(await ids({ stage: { $ne: null } })).toEqual(await ids({ stage: { $exists: true } }));
    });

    it('the tree carries the same two leaves the other spellings produce', async () => {
      // The emitter, without a database in the way: `notSet` / `set` with EMPTY
      // `values`, which is what makes every compiler of this tree — both
      // strategies AND the display-SQL echo — answer alike without a third arm.
      expect(normalizeAnalyticsFilterTree({ where: { stage: { $eq: null } } })).toEqual({
        kind: 'leaf', member: 'stage', operator: 'notSet', values: [],
      });
      expect(normalizeAnalyticsFilterTree({ where: { stage: { $ne: null } } })).toEqual({
        kind: 'leaf', member: 'stage', operator: 'set', values: [],
      });
      expect(normalizeAnalyticsFilterTree({ where: { stage: { $eq: null } } }))
        .toEqual(normalizeAnalyticsFilterTree({ where: { stage: null } }));
      expect(normalizeAnalyticsFilterTree({ where: { stage: { $ne: null } } }))
        .toEqual(normalizeAnalyticsFilterTree({ where: { stage: { $null: false } } }));
    });

    it('an EMPTY STRING comparand is still a value comparison — the fix does not over-reach', async () => {
      // The mirror danger. `''` and `null` are different facts, and the defect
      // was reading one as the other; conflating them in the other direction
      // would be the same mistake with the sign flipped.
      const { sql, params } = await sqlFor({ stage: { $eq: '' } });
      expect(sql).toContain('WHERE stage = $1');
      expect(params).toEqual(['']);
      expect(normalizeAnalyticsFilterTree({ where: { stage: { $eq: '' } } })).toEqual({
        kind: 'leaf', member: 'stage', operator: 'equals', values: [''],
      });
      // And a non-null comparand of the same operators is untouched.
      expect(await ids({ stage: { $eq: 'won' } })).toEqual(['1']);
      expect(await ids({ stage: { $ne: 'won' } })).toEqual(['2']);
    });

    it('the ObjectQL path hands the engine a null predicate, not `\'\'`', async () => {
      expect(await engineIds({ stage: { $eq: null } })).toEqual(['3', '4']);
      // `convertFilter` maps `notSet` to a bare `null` — `{stage: null}`, the
      // spelling every driver reads as IS NULL. It used to receive
      // `{stage: ''}` (via `coerceFilterValueForObjectQL('')`), i.e. the empty
      // string compared against stored `null` — never a match on any driver.
      expect(lastEngineFilter).toEqual({ stage: null });
      expect(await engineIds({ stage: { $ne: null } })).toEqual(['1', '2']);
      expect(lastEngineFilter).toEqual({ stage: { $ne: null } });
    });

    it('the echoed display SQL renders the predicate it executes', async () => {
      const echo = async (where: unknown) =>
        new ObjectQLStrategy().generateSql(query(where), objectqlCtx);
      // Was `stage = $1` / `['']` — an echo that could not reproduce the result
      // it was shown next to.
      const eqNull = await echo({ stage: { $eq: null } });
      expect(eqNull.sql).toContain('IS NULL');
      expect(eqNull.params).toEqual([]);
      const neNull = await echo({ stage: { $ne: null } });
      expect(neNull.sql).toContain('IS NOT NULL');
      expect(neNull.params).toEqual([]);
    });

    it('on a TEXT column the `$ne` direction stops excluding the `\'\'` rows', async () => {
      // The issue's severity argument, executed. In SQLite / MySQL `''` is a
      // REAL value a row can store, so `stage != ''` — what `{$ne: null}` used
      // to compile to — dropped exactly the rows "stage is not empty" keeps,
      // and `stage = ''` matched the one row that is NOT null.
      //
      // A table of its own because the shared FIXTURE is row-for-row
      // `driver-sql`'s and carries no empty string; adding one there would move
      // every other file's expectations.
      db.run(`CREATE TABLE "deal_text" ("id" TEXT PRIMARY KEY, "stage" TEXT);`);
      const insert = db.prepare(`INSERT INTO "deal_text" ("id","stage") VALUES (?,?)`);
      for (const r of [['e1', 'won'], ['e2', ''], ['e3', null]]) insert.run(r as any[]);
      insert.free();
      try {
        const textCube = { ...CUBE, name: 'deals_text', sql: 'deal_text' } as unknown as Cube;
        const textCtx = {
          ...nativeCtx,
          getCube: (name: string) => (name === 'deals_text' ? textCube : undefined),
        } as StrategyContext;
        const textIds = async (where: unknown): Promise<string[]> => {
          const result = await new NativeSQLStrategy().execute(
            { ...query(where), cube: 'deals_text' } as AnalyticsQuery,
            textCtx,
          );
          return result.rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));
        };
        // `IS NULL` picks the null row, NOT the empty-string one. Was `['e2']` —
        // the one row that is emphatically not empty of a value.
        expect(await textIds({ stage: { $eq: null } })).toEqual(['e3']);
        // `IS NOT NULL` keeps the empty-string row. Was `['e1']`.
        expect(await textIds({ stage: { $ne: null } })).toEqual(['e1', 'e2']);
        // …and an author who really means the empty string still gets it.
        expect(await textIds({ stage: { $eq: '' } })).toEqual(['e2']);
      } finally {
        db.run(`DROP TABLE "deal_text";`);
      }
    });
  });
});
