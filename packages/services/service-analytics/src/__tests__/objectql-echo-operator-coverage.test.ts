// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5333] The echoed display SQL covers the WHOLE operator vocabulary.
 *
 * `ObjectQLStrategy.generateSql` is the third compiler of the same filter tree
 * — the one whose output goes to the browser as `/analytics/sql` — and its only
 * reason to exist is REPRODUCING execution. `buildFilterClauseSql` handled
 * `set` / `notSet` / `in` / `notIn` / `contains` / `notContains` explicitly and
 * sent everything else to `SCALAR_SQL_OPS`, whose six entries do not include
 * `startsWith` / `endsWith`; an unmapped operator hit `return null`, which every
 * compiler of this tree reads as "this node carries no constraint". So
 * `{stage: {$startsWith: 'w'}}` echoed a statement with NO `WHERE` while the
 * query it describes ran `stage LIKE 'w%'` — the echo was strictly WIDER than
 * execution, and an author debugging "why does this chart have fewer rows than I
 * expect" ran it, got MORE rows back, and concluded the filter was not applied.
 *
 * That is the #3601 / #3602 / #3650 class ("a rendering that contradicts
 * execution is worse than no rendering", this file's subject's own words) reached
 * through the operator table rather than through the read scope or a time window.
 *
 * Two things are pinned here, because the fix has two halves:
 *
 * 1. **Row-result cover for the issue's measured table.** The echoed statement
 *    is EXECUTED against the same fixture and its row ids compared to what the
 *    query actually returns. A dropped predicate cannot hide from that: the echo
 *    returns rows the filter excludes, which is the exact complaint. Asserting
 *    only the SQL string would have let the next unmapped operator through, the
 *    way `$between` sat behind `$startsWith` in #4128.
 * 2. **An enumeration over the CLOSED vocabulary.** `filter-normalizer.ts`
 *    refuses an operator it cannot map (`Unsupported filter operator …`), so the
 *    leaf operators that can ever reach this compiler are exactly what
 *    {@link fieldLeaves} emits for the spec's `FILTER_OPERATORS` — a finite,
 *    enumerable set. Driving all sixteen authorable spellings through the echo (#6520 added `$icontains`)
 *    turns "the two tables drifted" from something a reader has to notice into a
 *    failing test, which is what #4128 asked for and did not get for this third
 *    compiler.
 *
 * The same closure is what lets the unmapped-operator exit THROW instead of
 * returning `null` (last block): a caller cannot reach it — the normalizer
 * refuses first, with a 400 — so an arrival means our own two tables disagree,
 * and silently widening the author's query is the one answer that must not be
 * given. Same call `convertFilter`'s `default:` arm made in #4128.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import { FILTER_OPERATORS } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

/**
 * `stage` is the string column the LIKE family reads. `'won'` is the only row
 * that both starts with `w` and ends with `n`, and `'lost'` contains an `o`
 * without doing either — so a prefix/suffix anchor compiled as a substring
 * shows up as a wrong id rather than passing by luck. Rows 3/4 carry a NULL
 * `stage`, the rows a dropped predicate hands back.
 */
const FIXTURE = [
  { id: '1', stage: 'won', amount: 10 },
  { id: '2', stage: 'lost', amount: 20 },
  { id: '3', stage: null, amount: 30 },
  { id: '4', stage: null, amount: 40 },
];

const ALL_IDS = ['1', '2', '3', '4'];

const CUBE: Cube = {
  name: 'deals',
  title: 'Deals',
  sql: 'deal',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: Object.fromEntries(
    ['id', 'stage', 'amount'].map((n) => [
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

/*
 * [#5557] The stand-in engine below used to need one accommodation, and it was
 * NOT about #5333: `ObjectQLStrategy.convertFilter` sent the `contains` leaf to
 * the engine as `{$regex: <comparand>}` while its three siblings passed as the
 * canonical spec operators #4128 gave them, and `$regex` is not in
 * `filter.zod.ts`'s `FILTER_OPERATORS`, so `compileScopedFilterToSql` — a
 * `FilterCondition` consumer, not a driver — failed closed on it. An
 * `asCondition()` helper rewrote `$regex` back to `$contains` here so this file
 * could be about the echo.
 *
 * #5557 fixed the producer, so the helper is gone and `options.filter` reaches
 * `compileScopedFilterToSql` untouched. That makes this file the other half of
 * #5557's reverse verification: restore `case 'contains': return { $regex: … }`
 * in `convertFilter` and the `$contains` row of the measured table below throws
 * `unsupported operator "$regex" … (fail-closed)` from the stand-in engine.
 */

/** One authorable `$op` spelling, with a comparand this fixture can answer. */
const OPERATOR_CASES: Record<string, FilterCondition> = {
  $eq: { stage: { $eq: 'won' } },
  $ne: { stage: { $ne: 'won' } },
  $gt: { amount: { $gt: 10 } },
  $gte: { amount: { $gte: 20 } },
  $lt: { amount: { $lt: 40 } },
  $lte: { amount: { $lte: 20 } },
  $in: { stage: { $in: ['won', 'lost'] } },
  $nin: { stage: { $nin: ['won'] } },
  $between: { amount: { $between: [10, 20] } },
  $contains: { stage: { $contains: 'o' } },
  // [#6520] Upper-case on purpose: the fixture's `stage` values are lower-case,
  // so a comparand that only matches once the ASCII fold RUNS is the one that
  // tells a working fold from an absent one. A case-exact rendering returns no
  // rows here, which the row-result assertions below read as a wrong answer
  // rather than as a passing count.
  $icontains: { stage: { $icontains: 'O' } },
  $notContains: { stage: { $notContains: 'o' } },
  $startsWith: { stage: { $startsWith: 'w' } },
  $endsWith: { stage: { $endsWith: 'n' } },
  $null: { stage: { $null: true } },
  $exists: { stage: { $exists: false } },
};

describe('[#5333] `/analytics/sql` echo — every authorable operator renders a predicate', () => {
  let db: any;
  let nativeCtx: StrategyContext;
  let objectqlCtx: StrategyContext;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`CREATE TABLE "deal" ("id" TEXT PRIMARY KEY, "stage" TEXT, "amount" REAL);`);
    const insert = db.prepare(`INSERT INTO "deal" ("id","stage","amount") VALUES (?,?,?)`);
    for (const r of FIXTURE) insert.run([r.id, r.stage, r.amount]);
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

    // The ObjectQL path hands a `FilterCondition` to the engine, not SQL, so
    // `compileScopedFilterToSql` — this package's other FilterCondition consumer
    // — stands in for it, the way `filter-normalizer-not-null-safe.test.ts` does.
    // That makes "what the query returns" a real row set rather than a
    // re-reading of the same compiler the echo uses.
    objectqlCtx = {
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (
        _object: string,
        options: { groupBy?: string[]; filter?: Record<string, unknown> },
      ) => {
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

  /** The echoed display SQL for a `where`, as `/analytics/sql` returns it. */
  const echo = (where: unknown): Promise<{ sql: string; params: unknown[] }> =>
    new ObjectQLStrategy().generateSql(query(where), objectqlCtx);

  /** The statement `NativeSQLStrategy` actually EXECUTES for the same `where`. */
  const nativeSql = (where: unknown): Promise<{ sql: string; params: unknown[] }> =>
    new NativeSQLStrategy().generateSql(query(where), nativeCtx);

  /** Run a `$n`-dialect statement and return its `id` column, sorted. */
  const run = (sql: string, params: unknown[]): string[] => {
    const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
    stmt.bind(params as any[]);
    const out: string[] = [];
    while (stmt.step()) out.push(String(stmt.getAsObject().id));
    stmt.free();
    return out.sort((x, y) => x.localeCompare(y));
  };

  /** The rows the echoed statement returns — the author's "let me run this". */
  const echoIds = async (where: unknown): Promise<string[]> => {
    const { sql, params } = await echo(where);
    return run(sql, params);
  };

  /** The rows the ObjectQL path actually returns for the same `where`. */
  const executedIds = async (where: unknown): Promise<string[]> => {
    const result = await new ObjectQLStrategy().execute(query(where), objectqlCtx);
    return result.rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));
  };

  // ── The issue's measured table, one case per row ────────────────────────────

  describe("the issue's measured table", () => {
    /*
     * [#5567] Each pattern is now followed by a bound `ESCAPE` argument, so the
     * echo describes the comparand `driver-sql` actually compares (its
     * `applyLike` has always escaped and bound `ESCAPE`). None of these three
     * comparands carries a `_` or `%`, so the PATTERN is byte-identical to what
     * #5333 pinned — the second bind is the whole delta. The metacharacter cases,
     * where the pattern itself changes and the row set with it, are in
     * `like-metacharacter-escape.test.ts`.
     */
    it('`$startsWith` echoes `LIKE` with the prefix pattern — was no WHERE at all', async () => {
      const { sql, params } = await echo({ stage: { $startsWith: 'w' } });
      expect(sql).toContain('WHERE');
      expect(sql).toContain('stage LIKE $1 ESCAPE $2');
      expect(params).toEqual(['w%', '\\']);
    });

    it('`$endsWith` echoes `LIKE` with the suffix pattern — was no WHERE at all', async () => {
      const { sql, params } = await echo({ stage: { $endsWith: 'n' } });
      expect(sql).toContain('WHERE');
      expect(sql).toContain('stage LIKE $1 ESCAPE $2');
      expect(params).toEqual(['%n', '\\']);
    });

    it('`$contains` still echoes the substring pattern — the row that already worked', async () => {
      const { sql, params } = await echo({ stage: { $contains: 'o' } });
      expect(sql).toContain('stage LIKE $1 ESCAPE $2');
      expect(params).toEqual(['%o%', '\\']);
    });

    it('the LIKE patterns are the ones the EXECUTED statement binds', async () => {
      // `NativeSQLStrategy.buildFilterClause`'s `likePattern` table is the
      // reference: the echo exists to describe that query, so the same `where`
      // must bind the same pattern on both compilers.
      for (const where of [
        { stage: { $startsWith: 'w' } },
        { stage: { $endsWith: 'n' } },
        { stage: { $contains: 'o' } },
        { stage: { $notContains: 'o' } },
      ]) {
        const echoed = await echo(where);
        const executed = await nativeSql(where);
        expect(echoed.params, JSON.stringify(where)).toEqual(executed.params);
      }
    });

    it('running the echo returns the rows the query returns, not more', async () => {
      // The complaint itself: the author runs the echoed statement to reproduce
      // a result and gets a WIDER row set, so the filter reads as not applied.
      for (const [where, expected] of [
        [{ stage: { $startsWith: 'w' } }, ['1']],
        [{ stage: { $endsWith: 'n' } }, ['1']],
        [{ stage: { $contains: 'o' } }, ['1', '2']],
      ] as Array<[FilterCondition, string[]]>) {
        expect(await echoIds(where), `echo ${JSON.stringify(where)}`).toEqual(expected);
        expect(await executedIds(where), `executed ${JSON.stringify(where)}`).toEqual(expected);
        // Belt and braces: the whole fixture back is the one wrong answer that
        // looks like a working statement.
        expect(
          (await echoIds(where)).length,
          `${JSON.stringify(where)} echoed every row — the predicate was dropped`,
        ).toBeLessThan(ALL_IDS.length);
      }
    });
  });

  // ── The vocabulary, enumerated so the two tables cannot drift apart ─────────

  describe('the closed vocabulary, enumerated', () => {
    it('covers every operator the spec declares — no case is missing from the table', () => {
      expect(Object.keys(OPERATOR_CASES).sort()).toEqual([...FILTER_OPERATORS].sort());
    });

    for (const op of FILTER_OPERATORS) {
      it(`${op} renders a predicate in the echo`, async () => {
        const where = OPERATOR_CASES[op];
        const { sql, params } = await echo(where);
        // A missing predicate is not a missing feature: the statement stays
        // valid and simply describes a wider query than the one it documents.
        expect(sql, `${op} echoed no WHERE — the predicate was dropped`).toContain('WHERE');
        expect(sql).toMatch(/WHERE\s+\S/);
        // The placeholder/`params` alignment `renderFilterNodeSql` promises: a
        // clause dropped after its comparand was pushed leaves a binding with
        // no placeholder to consume it, which silently shifts every later one.
        const placeholders = new Set(sql.match(/\$\d+/g) ?? []);
        expect(placeholders.size, `${op} placeholder/params mismatch`).toBe(params.length);
      });
    }

    it('renders a predicate wherever the EXECUTED statement has one', async () => {
      for (const op of FILTER_OPERATORS) {
        const where = OPERATOR_CASES[op];
        const executed = await nativeSql(where);
        if (!executed.sql.includes('WHERE')) continue;
        const echoed = await echo(where);
        expect(echoed.sql, `${op}: executed has a WHERE, echo does not`).toContain('WHERE');
      }
    });
  });

  // ── The exit that used to drop a predicate in silence ──────────────────────

  describe('an operator this compiler cannot render THROWS rather than vanishing', () => {
    /**
     * Reached through the private compiler on purpose. The public door CANNOT
     * produce this call — `filter-normalizer.ts` refuses an operator outside
     * `MONGO_TO_CUBE_OP` with a 400 before a leaf is ever built, which is
     * exactly why the exit may throw: an arrival means the normalizer gained an
     * operator this renderer has no arm for, i.e. our own two tables drifted.
     * The alternative, `return null`, is read as "no constraint" by
     * `renderFilterNodeSql` and hands the author a wider statement than the
     * query — the #5333 defect, reproduced by the next operator to be added.
     */
    const renderLeaf = (operator: string): string | null => {
      const strategy = new ObjectQLStrategy() as unknown as {
        buildFilterClauseSql(
          col: string,
          operator: string,
          // [#5526] `unknown[]`: a leaf carries the author's comparand at its
          // own type, so this local mirror of the private signature does too.
          values: unknown[] | undefined,
          params: unknown[],
        ): string | null;
      };
      return strategy.buildFilterClauseSql('stage', operator, ['w'], []);
    };

    it('throws for an operator with no SQL spelling', () => {
      expect(() => renderLeaf('sortOf')).toThrow(/cannot render/i);
      expect(() => renderLeaf('sortOf')).toThrow(/sortOf/);
    });

    it('does not throw for anything the normalizer can actually emit', () => {
      // The leaf operators `fieldLeaves` produces: `MONGO_TO_CUBE_OP`'s thirteen,
      // plus `set` / `notSet` (the null predicates, `$eq: null` and a bare
      // `null`) — `$between` lowers to `gte` / `lte`, already in the thirteen.
      const EMITTABLE = [
        'equals', 'notEquals', 'gt', 'gte', 'lt', 'lte',
        'in', 'notIn', 'contains', 'notContains', 'startsWith', 'endsWith',
        // [#6520] `$icontains`' leaf. It renders through the same LIKE row as
        // `contains`, with the ASCII fold wrapped around both sides.
        'icontains',
        'set', 'notSet',
      ];
      for (const operator of EMITTABLE) {
        expect(() => renderLeaf(operator), operator).not.toThrow();
        expect(renderLeaf(operator), `${operator} rendered nothing`).not.toBeNull();
      }
    });

    it('a value-less scalar leaf is still "no predicate", not a throw', () => {
      // Unchanged: the empty-`values` exit mirrors `NativeSQLStrategy` and
      // `execute()`, which drop such a leaf too. #5134 made the one shape that
      // used to arrive here — an empty `$in` — a boolean CONSTANT upstream, so
      // this arm is about a value-less leaf, not about an unknown operator.
      const strategy = new ObjectQLStrategy() as unknown as {
        buildFilterClauseSql(
          col: string,
          operator: string,
          // [#5526] `unknown[]`: a leaf carries the author's comparand at its
          // own type, so this local mirror of the private signature does too.
          values: unknown[] | undefined,
          params: unknown[],
        ): string | null;
      };
      expect(strategy.buildFilterClauseSql('stage', 'equals', [], [])).toBeNull();
      expect(strategy.buildFilterClauseSql('stage', 'equals', undefined, [])).toBeNull();
    });
  });
});
