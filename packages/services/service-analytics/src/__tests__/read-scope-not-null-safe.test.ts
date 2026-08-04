// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5297] The read-scope SQL lowering answers `$not` the way the rest of the
 * repo answers it — and a `{$not: {}}` scope shows zero rows instead of the
 * whole table.
 *
 * # Why this file exists at all
 *
 * `read-scope-sql-conformance.test.ts` already runs the shared
 * `FILTER_LOGIC_CASES` table against a real SQLite engine, and it was green
 * through both defects: that table deliberately carries no NULL rows and no
 * boolean-identity case (those land with #5239 / the spec half of #5146). So the
 * gate that looks like it covers this compiler could not see either bug. These
 * cases are the pin until the shared table absorbs them.
 *
 * # The two defects
 *
 * **`{$not: {}}` ran the query completely unscoped.** `compileNode({})` returns
 * `''` (the constant TRUE), `if (inner)` was false, the `$not` emitted nothing,
 * `compileScopedFilterToSql` returned `''`, and `applyReadScope`'s
 * `if (!sql) return;` then added no `WHERE` — so a read scope whose meaning is
 * `NOT TRUE ≡ FALSE`, i.e. *show nothing*, showed **everything**. The seam is
 * what makes it a bypass rather than a wrong string, which is why the assertion
 * below goes through `NativeSQLStrategy.generateSql` and not only through
 * `compileScopedFilterToSql`. `$and: []` / `$or: []` in the same loop were
 * fail-closed all along; `$not` was the one uncovered square.
 *
 * **`$not` was not NULL-safe.** SQL is three-valued and a `WHERE` keeps only
 * TRUE, so `NOT (stage = 'won')` dropped every row whose `stage` is NULL, while
 * `driver-memory`, `formula` and (since #5296) `driver-sql` return them. Same
 * declared read scope, different visible set per backend — and a CEL `!expr` in
 * a permission rule lowers to exactly this shape (`cel-to-filter.ts`).
 *
 * # Where the expected ids come from
 *
 * Measured, not reasoned: the fixture is row-for-row the one in
 * `driver-sql`'s `sql-driver-not-null-safe.test.ts`, and every id set below is
 * the answer that file and the two JS-backend pins
 * (`formula/src/matches-filter-not-null-safe.test.ts`,
 * `driver-memory/src/memory-matcher-not-null-safe.test.ts`) assert for the same
 * filter — all three suites were run against this fixture while writing these
 * cases. Moving an expectation here re-opens the divergence #5146 closed.
 *
 * `sql.js` (pure WASM) is the engine, for the reason spelled out at the top of
 * `read-scope-sql-conformance.test.ts`: a native binding cannot be relied on to
 * load under CI's Node.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';

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
const ALIAS = 't';

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

// ── The read scope as the analytics strategy actually applies it ─────────────

const cube: Cube = {
  name: 'deals',
  title: 'Deals',
  sql: 'deal',
  measures: { revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'amount' } },
  dimensions: { stage: { name: 'stage', label: 'Stage', type: 'string', sql: 'stage' } },
  public: false,
};

const query: AnalyticsQuery = {
  cube: 'deals',
  measures: ['revenue'],
  dimensions: ['stage'],
  timezone: 'UTC',
};

/**
 * Generate the analytics SQL for a query whose only constraint is `scope`,
 * exercising `NativeSQLStrategy.applyReadScope` — the seam where a scope that
 * compiles to nothing turns into a query with no `WHERE`.
 */
async function generateScoped(scope: FilterCondition): Promise<{ sql: string; params: unknown[] }> {
  const ctx: StrategyContext = {
    getCube: (name) => (name === 'deals' ? cube : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [],
    getReadScope: (obj) => (obj === 'deal' ? scope : undefined),
  };
  return new NativeSQLStrategy().generateSql(query, ctx);
}

describe('[#5297] read-scope `$not` — boolean identities and NULL safety', () => {
  let db: any;

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
  });

  afterAll(() => {
    db?.close();
  });

  /**
   * The rows a read scope admits, executed rather than asserted as a string.
   *
   * `''` is the compiler's TRUE — the shape for which `applyReadScope` adds no
   * `WHERE` — so it is executed as the unconstrained query it stands for. That
   * substitution is exactly the production behaviour, which is why a scope that
   * MEANT `FALSE` had to stop compiling to `''`.
   */
  const ids = (scope: unknown): string[] => {
    const { sql, params } = compileScopedFilterToSql(scope as FilterCondition, ALIAS);
    const stmt = db.prepare(
      `SELECT "id" FROM "deal" AS "${ALIAS}" WHERE ${sql.length > 0 ? sql : '1 = 1'} ORDER BY "id"`,
    );
    stmt.bind(params as any[]);
    const got: string[] = [];
    while (stmt.step()) got.push(String(stmt.get()[0]));
    stmt.free();
    return got;
  };

  // ── Defect 2: the RLS bypass ───────────────────────────────────────────────

  describe('`{$not: {}}` is FALSE, and the strategy actually applies it', () => {
    it('compiles to a constant-false clause instead of the empty string', () => {
      expect(compileScopedFilterToSql({ $not: {} } as FilterCondition, ALIAS)).toEqual({
        sql: '1 = 0',
        params: [],
      });
    });

    it('admits zero rows — NOT TRUE ≡ FALSE', () => {
      expect(ids({ $not: {} })).toEqual([]);
    });

    it('reaches the generated analytics SQL as a real WHERE — the bypass seam', async () => {
      // Was: `compileScopedFilterToSql` → `''` → `applyReadScope`'s
      // `if (!sql) return;` → a query with NO `WHERE` at all, i.e. the whole
      // table returned under a scope that means "nothing is visible".
      const { sql } = await generateScoped({ $not: {} } as FilterCondition);
      expect(sql).toContain('WHERE');
      expect(sql).toContain('(1 = 0)');
    });

    it('stays FALSE nested inside a scope that also carries real predicates', () => {
      expect(ids({ $and: [{ owner: 'u1' }, { $not: {} }] })).toEqual([]);
      expect(ids({ owner: 'u1', $not: {} })).toEqual([]);
    });

    it('a `$not` of a FALSE clause is TRUE again', () => {
      // `NOT (1 = 0)` — the double-identity direction, so the constant is not
      // just a string that happens to appear.
      expect(ids({ $not: { $not: {} } })).toEqual(ALL);
    });
  });

  // ── Defect 2, mirror direction: the absorbed `$or` branch ──────────────────

  describe('a `{}` disjunct makes the whole `$or` TRUE', () => {
    it('compiles to no constraint, and binds nothing', () => {
      // Was `("t"."owner" = ?)` with one bound param: the TRUE branch was
      // filtered out and the scope silently NARROWED to the surviving branch.
      expect(compileScopedFilterToSql({ $or: [{}, { owner: 'u1' }] } as FilterCondition, ALIAS)).toEqual({
        sql: '',
        params: [],
      });
    });

    it('admits every row', () => {
      expect(ids({ $or: [{}, { owner: 'u1' }] })).toEqual(ALL);
      expect(ids({ $or: [{ owner: 'u1' }, {}] })).toEqual(ALL);
    });

    it('drops the discarded branch\'s bindings with it — no orphaned param', async () => {
      // The failure this guards is worse than a wide scope: a value left in
      // `params` with no `?` to consume it shifts every later placeholder onto
      // the wrong value, so a tenant predicate binds someone else's id.
      const { params } = await generateScoped({
        $or: [{}, { owner: 'u1' }],
      } as FilterCondition);
      expect(params).not.toContain('u1');
      expect(params).toEqual([]);
    });

    it('an all-`{}` `$or` is TRUE too, and a `$and` is unchanged by a `{}` member', () => {
      expect(ids({ $or: [{}, {}] })).toEqual(ALL);
      expect(compileScopedFilterToSql({ $and: [{}, { owner: 'u1' }] } as FilterCondition, ALIAS)).toEqual({
        sql: '("t"."owner" = ?)',
        params: ['u1'],
      });
    });
  });

  // ── Defect 1: NULL-safe negation ───────────────────────────────────────────

  describe('a NULL column does not satisfy the negated condition', () => {
    it('`$not` on an implicit equality returns the NULL rows', () => {
      // Was ['2'] — rows 3 and 4 fell into UNKNOWN and disappeared.
      expect(ids({ $not: { stage: 'won' } })).toEqual(['2', '3', '4']);
    });

    it('the guard rides the leaf, so the emitted SQL negates a TOTAL predicate', () => {
      const { sql } = compileScopedFilterToSql({ $not: { stage: 'won' } } as FilterCondition, ALIAS);
      expect(sql).toBe('NOT (("t"."stage" IS NOT NULL AND "t"."stage" = ?))');
    });

    it('`$not` over MULTIPLE columns admits a row that is NULL in EITHER', () => {
      expect(ids({ $not: { stage: 'won', owner: 'u1' } })).toEqual(['2', '3', '4']);
      const { sql } = compileScopedFilterToSql(
        { $not: { stage: 'won', owner: 'u1' } } as FilterCondition,
        ALIAS,
      );
      expect(sql).toContain('"t"."stage" IS NOT NULL');
      expect(sql).toContain('"t"."owner" IS NOT NULL');
    });

    it('the RLS shape: a CEL `!(stage == "won")` scope stops hiding stage-less rows', () => {
      expect(ids({ $not: { stage: 'won' } })).toHaveLength(3);
    });

    it('the same scope through the strategy binds one param and one NOT', async () => {
      const { sql, params } = await generateScoped({ $not: { stage: 'won' } } as FilterCondition);
      expect(sql).toContain('NOT (');
      expect(sql).toContain('"deal"."stage" IS NOT NULL');
      expect(params).toEqual(['won']);
    });
  });

  describe('the guard composes through nested combinators', () => {
    it('`$not` of a `$or` excludes a NULL row whose OTHER branch matches', () => {
      // Row 3 has a NULL stage but owner = 'u1', so the inner `$or` IS satisfied
      // and the negation must reject it. A `NOT (…) OR stage IS NULL` hoisted to
      // the top would hand row 3 back — the reason the guard is per leaf.
      expect(ids({ $not: { $or: [{ stage: 'won' }, { owner: 'u1' }] } })).toEqual(['2', '4']);
    });

    it('`$not` of a `$and` admits every row failing either conjunct', () => {
      expect(ids({ $not: { $and: [{ stage: 'won' }, { owner: 'u1' }] } })).toEqual(['2', '3', '4']);
    });

    it('a double negation is the positive scope again, NULL rows excluded', () => {
      expect(ids({ $not: { $not: { stage: 'won' } } })).toEqual(['1']);
      expect(ids({ $not: { $not: { stage: 'won' } } })).toEqual(ids({ stage: 'won' }));
    });

    it('`$not` still ANDs with its sibling keys', () => {
      expect(ids({ $not: { stage: 'won' }, owner: 'u1' })).toEqual(['3']);
    });

    it('a `$not` nested inside a `$or` branch stays NULL-safe', () => {
      expect(ids({ $or: [{ $not: { stage: 'won' } }, { owner: 'u2' }] })).toEqual(['2', '3', '4']);
    });
  });

  describe('each operator is guarded in the direction it answers for a missing value', () => {
    it('`$not` of `$ne` is NOT widened — it still means "the column IS that value"', () => {
      // A blanket `OR stage IS NULL` would hand back rows 3 and 4, i.e. rows the
      // scope excludes. On an RLS predicate that is the widening class outright.
      expect(ids({ $not: { stage: { $ne: 'won' } } })).toEqual(['1']);
      expect(compileScopedFilterToSql({ $not: { stage: { $ne: 'won' } } } as FilterCondition, ALIAS).sql)
        .toContain('"t"."stage" IS NULL');
    });

    it('`$not` of `$nin` is not widened either', () => {
      expect(ids({ $not: { stage: { $nin: ['won'] } } })).toEqual(['1']);
    });

    it('`$not` of `$in` returns the NULL rows', () => {
      expect(ids({ $not: { stage: { $in: ['won'] } } })).toEqual(['2', '3', '4']);
    });

    it('`$not` of an ordering comparison returns the NULL rows', () => {
      expect(ids({ $not: { amount: { $gt: 15 } } })).toEqual(['1', '3']);
    });

    it('`$not` of `$between` returns the NULL rows', () => {
      // `$between` is in this compiler's vocabulary but not in `driver-sql`'s
      // guard table; it is a positive comparison, so it takes the same default.
      expect(ids({ $not: { amount: { $between: [15, 30] } } })).toEqual(['1', '3', '4']);
    });

    it('`$not` of `$contains` / `$startsWith` / `$endsWith` returns the NULL rows', () => {
      expect(ids({ $not: { stage: { $contains: 'w' } } })).toEqual(['2', '3', '4']);
      expect(ids({ $not: { stage: { $startsWith: 'w' } } })).toEqual(['2', '3', '4']);
      expect(ids({ $not: { stage: { $endsWith: 'n' } } })).toEqual(['2', '3', '4']);
    });

    it('`$not` of `$notContains` does NOT return them — the mirror case', () => {
      // The one operator where the two JS backends disagree for a null-valued
      // field; `formula` is followed, as `driver-sql` follows it, so this
      // compiler casts no vote on a disagreement filed elsewhere.
      expect(ids({ $not: { stage: { $notContains: 'w' } } })).toEqual(['1']);
    });

    it('`$not` of a null predicate is untouched — it was already two-valued', () => {
      expect(ids({ $not: { stage: { $null: true } } })).toEqual(['1', '2']);
      expect(ids({ $not: { stage: { $null: false } } })).toEqual(['3', '4']);
      expect(ids({ $not: { stage: { $exists: true } } })).toEqual(['3', '4']);
      expect(ids({ $not: { stage: { $exists: false } } })).toEqual(['1', '2']);
      // No guard is wrapped around a predicate that can never be UNKNOWN.
      expect(compileScopedFilterToSql({ $not: { stage: { $null: true } } } as FilterCondition, ALIAS).sql)
        .toBe('NOT ("t"."stage" IS NULL)');
    });

    it('`$not` of an explicit `null` comparand is untouched', () => {
      expect(ids({ $not: { stage: null } })).toEqual(['1', '2']);
      expect(ids({ $not: { stage: { $eq: null } } })).toEqual(['1', '2']);
      expect(ids({ $not: { stage: { $ne: null } } })).toEqual(['3', '4']);
    });

    it('an empty `$in` / `$nin` under a `$not` keeps its constant value', () => {
      expect(ids({ $not: { stage: { $in: [] } } })).toEqual(ALL);
      expect(ids({ $not: { stage: { $nin: [] } } })).toEqual([]);
    });
  });

  // ── Nothing outside `$not` moves, and nothing stopped failing closed ───────

  describe('only the `$not` path is rewritten', () => {
    it('a plain comparison compiles to exactly the SQL it always did', () => {
      expect(compileScopedFilterToSql({ stage: 'won' } as FilterCondition, ALIAS).sql)
        .toBe('"t"."stage" = ?');
      expect(compileScopedFilterToSql({ stage: { $ne: 'won' } } as FilterCondition, ALIAS).sql)
        .toBe('"t"."stage" <> ?');
      expect(compileScopedFilterToSql({ amount: { $gt: 15 } } as FilterCondition, ALIAS).sql)
        .toBe('"t"."amount" > ?');
    });

    it('a plain comparison returns the rows it always did', () => {
      expect(ids({ stage: 'won' })).toEqual(['1']);
      // Still three-valued OUTSIDE a negation: `<> 'won'` drops the NULL rows.
      // That divergence from the JS backends is real and out of #5146's scope.
      expect(ids({ stage: { $ne: 'won' } })).toEqual(['2']);
      expect(ids({})).toEqual(ALL);
    });
  });

  describe('the fail-closed guarantees survive the rewrite', () => {
    it('an empty `$and` / `$or` still THROWS, inside a `$not` as well as outside', () => {
      expect(() => compileScopedFilterToSql({ $and: [] } as FilterCondition, ALIAS))
        .toThrowError(/non-empty array/);
      expect(() => compileScopedFilterToSql({ $or: [] } as FilterCondition, ALIAS))
        .toThrowError(/non-empty array/);
      // The empty-combinator square is its own ruling (#5322) — the rewrite must
      // not quietly turn either of them into a boolean identity on the way past.
      expect(() => compileScopedFilterToSql({ $not: { $or: [] } } as FilterCondition, ALIAS))
        .toThrowError(/non-empty array/);
      expect(() => compileScopedFilterToSql({ $not: { $and: [] } } as FilterCondition, ALIAS))
        .toThrowError(/non-empty array/);
    });

    it('an unknown operator inside a `$not` still THROWS rather than being guarded', () => {
      expect(() => compileScopedFilterToSql({ $not: { f: { $regex: '.*' } } } as FilterCondition, ALIAS))
        .toThrowError(/unsupported operator/);
    });

    it('a nested relation / bare array / zero-operator spec inside a `$not` still THROWS', () => {
      expect(() => compileScopedFilterToSql({ $not: { account: { region: 'NA' } } } as FilterCondition, ALIAS))
        .toThrowError(/nested\/relation value/);
      expect(() => compileScopedFilterToSql({ $not: { stage: ['won'] } } as FilterCondition, ALIAS))
        .toThrowError(/bare array value/);
      expect(() => compileScopedFilterToSql({ $not: { stage: {} } } as FilterCondition, ALIAS))
        .toThrowError(/nested\/relation value/);
    });

    it('a non-node `$not` operand is still refused, not rewritten', () => {
      expect(() => compileScopedFilterToSql({ $not: null } as unknown as FilterCondition, ALIAS))
        .toThrowError(/must be a filter object/);
      expect(() => compileScopedFilterToSql({ $not: 'x' } as unknown as FilterCondition, ALIAS))
        .toThrowError(/must be a filter object/);
      expect(() => compileScopedFilterToSql({ $not: [] } as unknown as FilterCondition, ALIAS))
        .toThrowError(/must be a filter object/);
    });

    it('an unsafe identifier inside a `$not` is still refused', () => {
      expect(() => compileScopedFilterToSql({ $not: { 'id; DROP TABLE x': 'v' } } as FilterCondition, ALIAS))
        .toThrowError(/unsafe field identifier/);
    });
  });
});
