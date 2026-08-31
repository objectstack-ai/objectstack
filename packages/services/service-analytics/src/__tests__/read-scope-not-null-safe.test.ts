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
 * fail-closed when this file was written; #5322 has since ruled them boolean
 * identities (TRUE / FALSE), and the fail-closed pin at the bottom of this
 * file flipped with that ruling.
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

    it('an empty `$in` under a `$not` keeps its constant value; an empty `$nin` refuses before `$not` matters (#13571)', () => {
      // `$in: []` keeps its #5322/#5243 reduction — constant FALSE, total, no
      // guard — and the negation flips it to TRUE: every row. That widened
      // composition is the #13571 verdict's DECLARED residue for a non-RLS
      // producer (the in-repo RLS compiler cannot emit the shape — #13570's
      // polarity guard drops it upstream); closing it is a ruled follow-up
      // design, not an edit to this pin.
      expect(ids({ $not: { stage: { $in: [] } } })).toEqual(ALL);
      // `$nin: []` no longer HAS a constant to keep: its reduction is TRUE —
      // scope-vacating on its own — so `compileOperator` refuses it whatever
      // the polarity above it. Deliberately asymmetric with the `$in` line
      // above ("shape errors throw, boolean identities reduce" is the #5322
      // boundary, and a scope-vacating reduction is on the THROW side) — see
      // read-scope-sql.ts's #13571 header section.
      let refusal: (Error & { code?: unknown; status?: unknown }) | undefined;
      try {
        ids({ $not: { stage: { $nin: [] } } });
      } catch (e) {
        refusal = e as Error & { code?: unknown; status?: unknown };
      }
      expect(refusal?.code).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(refusal?.status).toBe(500);
      expect(String(refusal?.message)).toContain('$nin for "stage" is empty');
    });
  });

  // ── Nothing outside `$not` moves, and nothing stopped failing closed ───────

  describe('POSITIVE comparisons are still compiled exactly as before', () => {
    it('a positive comparison compiles to exactly the SQL it always did', () => {
      expect(compileScopedFilterToSql({ stage: 'won' } as FilterCondition, ALIAS).sql)
        .toBe('"t"."stage" = ?');
      expect(compileScopedFilterToSql({ amount: { $gt: 15 } } as FilterCondition, ALIAS).sql)
        .toBe('"t"."amount" > ?');
    });

    /**
     * FLIPPED PIN (#5298). These two assertions used to pin the OPPOSITE
     * answer — `"t"."stage" <> ?` and the single row `['2']` — deliberately:
     * the non-negated `$ne` was explicitly outside #5146's scope, and pinning
     * the old behaviour is what would have caught a rewrite leaking past the
     * `$not` it was scoped to. The 2026-08-06 ruling on #5298 took the other
     * direction, so the pin flips with the ruling. The reverse-verification
     * anchor did its job; it is not a regression.
     *
     * This compiler moving in the SAME PR as `driver-sql` is the point rather
     * than a convenience: one RLS rule is lowered here for the read path and
     * evaluated by `formula` for the write-side `check`, so a batch that
     * aligned only one of them would leave a permission rule admitting two
     * different row sets — the defect, not a smaller version of the fix.
     */
    it('$ne / $nin / $notContains are NULL-safe outside a $not too (#5298)', () => {
      expect(compileScopedFilterToSql({ stage: { $ne: 'won' } } as FilterCondition, ALIAS).sql)
        .toBe('("t"."stage" IS NULL OR "t"."stage" <> ?)');
      expect(ids({ stage: { $ne: 'won' } })).toEqual(['2', '3', '4']);
      expect(ids({ stage: { $nin: ['won'] } })).toEqual(['2', '3', '4']);
      expect(ids({ stage: { $notContains: 'wo' } })).toEqual(['2', '3', '4']);
      expect(ids({})).toEqual(ALL);
    });

    it('a positive comparison returns the rows it always did', () => {
      expect(ids({ stage: 'won' })).toEqual(['1']);
      // `$ne: null` is a null PREDICATE, not a comparison — unchanged by #5298.
      expect(ids({ stage: { $ne: null } })).toEqual(['1', '2']);
    });
  });

  describe('the fail-closed guarantees survive the rewrite', () => {
    it('an empty `$and` / `$or` reduces to its boolean identity, inside a `$not` as well as outside (#5322)', () => {
      // FLIPPED pin. This block used to assert `toThrowError(/non-empty
      // array/)` four times: when it was written, the empty-combinator square
      // was still an open ruling (#5322) and the rewrite was required not to
      // change the answer on the way past. The 2026-08-04 ruling took the
      // boolean identities, so the pinned answers flipped with it — and the
      // second half of the old requirement still holds in its new form: the
      // `$not` negates the REDUCED operand.
      expect(ids({ $and: [] })).toEqual(ALL); //  TRUE — the AND identity
      expect(ids({ $or: [] })).toEqual([]); //    FALSE — the OR identity
      expect(compileScopedFilterToSql({ $or: [] } as FilterCondition, ALIAS))
        .toEqual({ sql: '1 = 0', params: [] });
      expect(ids({ $not: { $or: [] } })).toEqual(ALL); // NOT FALSE ≡ TRUE
      expect(ids({ $not: { $and: [] } })).toEqual([]); // NOT TRUE ≡ FALSE
    });

    it('reduction composes with the NULL-safe rewrite: identities first, surviving leaves stay guarded (#5322)', () => {
      // The FALSE disjunct drops out (the OR identity), leaving
      // `{$not: {$or: [{stage: 'won'}]}}` — whose leaf the #5146 rewrite still
      // totalises, so the NULL-stage rows 3 and 4 are returned exactly as the
      // plain `{$not: {stage: 'won'}}` pin above returns them.
      expect(ids({ $not: { $or: [{ stage: 'won' }, { $or: [] }] } })).toEqual(['2', '3', '4']);
      // The TRUE disjunct ABSORBS the `$or`, so the whole `$not` is NOT TRUE —
      // zero rows — and no leaf survives for the rewrite to guard.
      expect(ids({ $not: { $or: [{ stage: 'won' }, { $and: [] }] } })).toEqual([]);
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
