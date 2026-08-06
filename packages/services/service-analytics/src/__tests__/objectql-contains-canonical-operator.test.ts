// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5557] The `contains` leaf reaches the engine as the canonical `$contains`,
 * and its comparand is taken LITERALLY.
 *
 * `ObjectQLStrategy.convertFilter` handles the four LIKE-family operators in one
 * `switch`. Three of them — `notContains` / `startsWith` / `endsWith` — pass
 * through as the spec operators #4128 gave them; `contains` alone was
 * `{ $regex: values[0] }`, with the comparand inserted VERBATIM into a regex
 * position. Measured before this change:
 *
 * | `where`                            | engine filter                          |
 * |------------------------------------|----------------------------------------|
 * | `{stage: {$contains:    'a.b'}}`   | `{stage: {$regex:        'a.b'}}`      |
 * | `{stage: {$notContains: 'a.b'}}`   | `{stage: {$notContains:  'a.b'}}`      |
 * | `{stage: {$startsWith:  'a.b'}}`   | `{stage: {$startsWith:   'a.b'}}`      |
 * | `{stage: {$endsWith:    'a.b'}}`   | `{stage: {$endsWith:     'a.b'}}`      |
 *
 * Three consequences, all of them things the author never asked for:
 *
 * 1. **`$regex` is not in the contract.** `filter.zod.ts`'s `FILTER_OPERATORS`
 *    declares fifteen operators and `$regex` is not one of them, so this was a
 *    PRODUCER emitting an operator the schema does not declare — Prime Directive
 *    #12 says fix the producer, and the producer is one `case` label.
 * 2. **The same `FilterCondition` no longer travels between two consumers in
 *    this very package.** `compileScopedFilterToSql` (`read-scope-sql.ts`) is a
 *    `FilterCondition` consumer and fails closed on an operator it cannot
 *    compile, so it THREW on the filter this strategy produced.
 * 3. **The row set depends on which driver answers.** A backend that evaluates
 *    `$regex` as a real regex (driver-memory's `memory-matcher.ts`:
 *    `new RegExp(target, condition.$options || '')`, `catch { return false }`)
 *    reads `a.b` as "a, any character, b" and reads `50% (+)` as a SyntaxError →
 *    zero rows, in silence. `driver-sql` compiles the same `$regex` to a
 *    substring LIKE. One dashboard, two row sets.
 *
 * This file asserts BOTH halves, because either alone misses the defect:
 *
 * - The engine filter itself (below), sourced against the spec's own operator
 *   list rather than a hand-written copy of it, so the next arm that invents an
 *   undeclared operator fails here.
 * - ROW IDS through an evaluator that takes `$regex` as a real regex — the only
 *   face on which "the comparand is not escaped" is visible at all. Asserting
 *   the emitted filter/SQL string alone is exactly what let this sit behind
 *   #4128's fix for its three siblings.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import { ALL_OPERATORS } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

/**
 * `stage` values chosen so a regex reading and a literal reading DISAGREE:
 *
 * - `a.b` / `axb` — `new RegExp('a.b').test('axb')` is `true`, `'axb'.includes('a.b')`
 *   is `false`. The author wanted the literal `a.b` and a regex face hands them
 *   `axb` as well.
 * - `off 50% (+) today` — contains `50% (+)` literally. As a regex pattern that
 *   comparand does not compile at all (`Nothing to repeat`), so the arm that
 *   swallows the SyntaxError answers "no rows" for a filter that has a match.
 * - `off 50 (+) today` — the DECOY for the literal reading: it differs from the
 *   row above by exactly the `%`, so a face that treats `%` as a wildcard picks
 *   it up too. On the regex face below `%` is already a literal, so the decoy
 *   earns its place through the EXACT row set (`toEqual(['3'])`) rather than a
 *   wildcard assertion. The faces that do read `%` as a wildcard are the three
 *   analytics SQL compilers, and that is #5567, not this file.
 */
const FIXTURE = [
  { id: '1', stage: 'a.b' },
  { id: '2', stage: 'axb' },
  { id: '3', stage: 'off 50% (+) today' },
  { id: '4', stage: 'off 50 (+) today' },
  { id: '5', stage: null },
];

const CUBE: Cube = {
  name: 'deals',
  title: 'Deals',
  sql: 'deal',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    stage: { name: 'stage', label: 'Stage', type: 'string', sql: 'stage' },
  },
  public: false,
} as unknown as Cube;

const query = (where: unknown): AnalyticsQuery =>
  ({
    cube: 'deals',
    measures: ['total'],
    dimensions: ['id'],
    timezone: 'UTC',
    where,
  }) as AnalyticsQuery;

/**
 * An engine face that evaluates the four LIKE operators the way
 * `driver-memory`'s `memory-matcher.ts` does, `$regex` arm included.
 *
 * Mirrored rather than imported: `service-analytics` does not depend on any
 * driver (see its `package.json`), and the point is not "driver-memory is
 * broken" — driver-memory's `$regex` arm is deliberate and serves a real
 * producer (plugin-auth's ObjectQL adapter, see `filter-refusal.ts`'s
 * `SUPPORTED_FIELD_OPERATORS` note). The point is that a filter carrying
 * `$regex` MEANS something different on a regex-evaluating face than the
 * substring the analytics author wrote, and this strategy has no business
 * choosing between those readings on the author's behalf.
 */
function matchesLikeFamily(row: (typeof FIXTURE)[number], cond: Record<string, unknown>): boolean {
  const value = row.stage;
  for (const [op, target] of Object.entries(cond)) {
    switch (op) {
      // `memory-matcher.ts`: `new RegExp(target, condition.$options || '')`,
      // `catch (e) { return false; }` — an uncompilable pattern is zero rows.
      case '$regex':
        try {
          if (!new RegExp(String(target)).test(String(value))) return false;
        } catch {
          return false;
        }
        break;
      case '$contains':
        if (typeof value !== 'string' || !value.includes(String(target))) return false;
        break;
      case '$notContains':
        if (typeof value !== 'string' || value.includes(String(target))) return false;
        break;
      case '$startsWith':
        if (typeof value !== 'string' || !value.startsWith(String(target))) return false;
        break;
      case '$endsWith':
        if (typeof value !== 'string' || !value.endsWith(String(target))) return false;
        break;
      default:
        throw new Error(`[test] this face does not evaluate "${op}"`);
    }
  }
  return true;
}

/**
 * [#5298] Evaluate the whole `FilterCondition` the strategy hands the engine,
 * not just its `stage` entry.
 *
 * `$notContains` is NULL-safe now, so the strategy emits it as
 * `{$or: [{stage: null}, {stage: {$notContains: …}}]}` and the condition no
 * longer has `stage` at the top level. Reading `filter.stage` alone therefore
 * found `undefined`, handed {@link matchesLikeFamily} an EMPTY operator object,
 * and every row passed the empty loop — the whole fixture came back and the
 * assertion below would have been green for a filter that matched nothing in
 * particular. A stand-in engine that cannot read the shape under test measures
 * the stand-in, so it walks the tree.
 */
function matchesCondition(row: (typeof FIXTURE)[number], cond: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(cond)) {
    if (key === '$and') {
      if (!(value as Record<string, unknown>[]).every((c) => matchesCondition(row, c))) return false;
      continue;
    }
    if (key === '$or') {
      if (!(value as Record<string, unknown>[]).some((c) => matchesCondition(row, c))) return false;
      continue;
    }
    if (key !== 'stage') throw new Error(`[test] this face only scopes "stage", got "${key}"`);
    // A bare `null` comparand is the null PREDICATE — the guard's own disjunct,
    // and the spelling every driver reads as IS NULL.
    if (value === null) {
      if (row.stage !== null) return false;
      continue;
    }
    if (!matchesLikeFamily(row, value as Record<string, unknown>)) return false;
  }
  return true;
}

/**
 * Every operator key the condition carries for `stage`, at any depth.
 *
 * [#5298] Also a tree walk, for the same reason {@link matchesCondition} is: the
 * NULL-safe guard moves the operator object one level down, and a lookup that
 * stopped at `filter.stage` reported ZERO operators — which the "is it declared"
 * assertion would have passed vacuously had it not also demanded a non-empty
 * set. That non-empty demand is why this file caught the shape change instead
 * of quietly asserting nothing.
 */
function stageOperators(cond: Record<string, unknown>): string[] {
  const found: string[] = [];
  const walk = (node: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$and' || key === '$or') {
        for (const child of value as Record<string, unknown>[]) walk(child);
        continue;
      }
      // `{stage: null}` is the null predicate, not an operator object.
      if (value === null || typeof value !== 'object') continue;
      found.push(...Object.keys(value as Record<string, unknown>));
    }
  };
  walk(cond);
  return found;
}

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

describe('[#5557] `contains` reaches the engine as `$contains`, comparand taken literally', () => {
  // ── What the strategy hands the engine ──────────────────────────────────────

  /**
   * The engine filter for a `where`, captured at the `executeAggregate` seam —
   * the exact object `engine.aggregate()` receives.
   */
  const engineFilter = async (where: unknown): Promise<Record<string, unknown>> => {
    let captured: Record<string, unknown> | undefined;
    const ctx = {
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (
        _object: string,
        options: { filter?: Record<string, unknown> },
      ) => {
        captured = options.filter ?? {};
        return [];
      },
    } as unknown as StrategyContext;
    await new ObjectQLStrategy().execute(query(where), ctx);
    return captured!;
  };

  describe("the issue's measured table", () => {
    it('`$contains` is forwarded as `$contains` — was the undeclared `$regex`', async () => {
      expect(await engineFilter({ stage: { $contains: 'a.b' } })).toEqual({
        stage: { $contains: 'a.b' },
      });
    });

    it('the three siblings are unchanged — the family is uniform now', async () => {
      // [#5298] `$notContains` is NULL-safe, so it reaches the engine wrapped in
      // the null-predicate disjunct. What THIS case asserts is unaffected and
      // still exact: the operator key is the declared `$notContains` and the
      // comparand is the author's literal `'a.b'`, not a `$regex` pattern.
      expect(await engineFilter({ stage: { $notContains: 'a.b' } })).toEqual({
        $and: [{ $or: [{ stage: null }, { stage: { $notContains: 'a.b' } }] }],
      });
      expect(await engineFilter({ stage: { $startsWith: 'a.b' } })).toEqual({
        stage: { $startsWith: 'a.b' },
      });
      expect(await engineFilter({ stage: { $endsWith: 'a.b' } })).toEqual({
        stage: { $endsWith: 'a.b' },
      });
    });

    it('every operator key it emits is one the spec DECLARES', async () => {
      // Sourced from `filter.zod.ts` rather than listed here: a private copy of
      // the vocabulary agrees with the contract on the day it is typed and never
      // again (`filter-refusal.ts` says the same about its own set). `$regex` is
      // not in `ALL_OPERATORS`, which is the whole of reason 1.
      const declared = new Set<string>(ALL_OPERATORS);
      for (const [op, comparand] of [
        ['$contains', 'a.b'],
        ['$notContains', 'a.b'],
        ['$startsWith', 'a.b'],
        ['$endsWith', 'a.b'],
      ] as const) {
        const filter = await engineFilter({ stage: { [op]: comparand } });
        const emitted = stageOperators(filter);
        expect(emitted.length, `${op} emitted no operator`).toBeGreaterThan(0);
        for (const key of emitted) {
          expect(declared.has(key), `${op} emitted undeclared operator "${key}"`).toBe(true);
        }
      }
    });
  });

  // ── The comparand is a literal substring, not a pattern ─────────────────────

  describe('on a face that evaluates `$regex` as a real regex', () => {
    /**
     * Row ids the ObjectQL path returns when the engine reads the LIKE family
     * the way `memory-matcher.ts` does.
     */
    const ids = async (where: unknown): Promise<string[]> => {
      const ctx = {
        getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
        queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
        executeAggregate: async (
          _object: string,
          options: { filter?: Record<string, unknown> },
        ) => {
          const cond = (options.filter ?? {}) as Record<string, unknown>;
          return FIXTURE.filter((r) => matchesCondition(r, cond)).map((r) => ({
            id: r.id,
            total: 1,
          }));
        },
      } as unknown as StrategyContext;
      const result = await new ObjectQLStrategy().execute(query(where), ctx);
      return result.rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
    };

    it('a `.` in the comparand matches a literal dot, not any character', async () => {
      // Pre-fix: `{$regex: 'a.b'}` → `['1', '2']`. Row 2 is `axb`; the author
      // asked for the substring `a.b` and got a wildcard match they cannot see.
      expect(await ids({ stage: { $contains: 'a.b' } })).toEqual(['1']);
    });

    it('a comparand that is not a valid regex still finds its rows — exactly its rows', async () => {
      // Pre-fix: `new RegExp('50% (+)')` throws `Nothing to repeat`, the matcher
      // catches it and answers `false` for every row → `[]`. A filter with a
      // real match reported as "no data", with nothing for the author to read.
      //
      // `toEqual` and not `toContain`, deliberately: the pre-fix answer was the
      // EMPTY set, and an assertion that only checks row 3 is absent-or-present
      // one way would have been satisfiable by producing nothing at all. The
      // exact set also excludes the decoy row 4 (row 3 minus the `%`), which is
      // what "the comparand is a literal, character for character" means here.
      expect(await ids({ stage: { $contains: '50% (+)' } })).toEqual(['3']);
    });

    it('the anchored siblings stay anchored on the same fixture', async () => {
      expect(await ids({ stage: { $startsWith: 'a.' } })).toEqual(['1']);
      expect(await ids({ stage: { $endsWith: '.b' } })).toEqual(['1']);
      // [#5298] Row 5 has no `stage`, and "has no value" now satisfies "does not
      // contain a.b" — the JS family's answer, reached here through the guard's
      // null-predicate disjunct rather than through the matcher, whose LIKE arms
      // still reject a non-string. The anchored pair above is the control: they
      // are positive-polarity, take no guard, and row 5 stays out of both.
      expect(await ids({ stage: { $notContains: 'a.b' } })).toEqual(['2', '3', '4', '5']);
    });
  });

  // ── The other `FilterCondition` consumer in this package ────────────────────

  describe("this package's other `FilterCondition` consumer accepts it", () => {
    let db: any;

    beforeAll(async () => {
      const mod: any = await import('sql.js');
      const initSqlJs = mod.default ?? mod;
      const locateFile = await locateWasm();
      const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
      db = new SQL.Database();
      db.run(`CREATE TABLE "deal" ("id" TEXT PRIMARY KEY, "stage" TEXT);`);
      const insert = db.prepare(`INSERT INTO "deal" ("id","stage") VALUES (?,?)`);
      for (const r of FIXTURE) insert.run([r.id, r.stage]);
      insert.free();
    });

    afterAll(() => {
      db?.close();
    });

    it('compiles every LIKE-family filter the strategy produces — `$regex` threw', async () => {
      // Reason 2, as a drift tripwire rather than prose: `compileOperator`'s
      // `default` is fail-closed, so a strategy that re-invents an undeclared
      // operator breaks a consumer sitting in the same directory.
      for (const op of ['$contains', '$notContains', '$startsWith', '$endsWith'] as const) {
        const filter = await engineFilter({ stage: { [op]: 'a.b' } });
        expect(
          () => compileScopedFilterToSql(filter as FilterCondition, 'deal'),
          `${op} does not compile on read-scope-sql`,
        ).not.toThrow();
      }
    });

    it('and returns the same row the regex-evaluating face returns', async () => {
      // `a.b` only: `.` is a literal in both a substring match and in LIKE, so
      // the two faces are comparable on it. `50% (+)` is NOT used here — this
      // compiler interpolates the comparand into a LIKE pattern without escaping
      // `%` / `_`, which is its own defect (#5567, filed while measuring this
      // one) and asserting it from this file would pin someone else's bug.
      const filter = await engineFilter({ stage: { $contains: 'a.b' } });
      const { sql, params } = compileScopedFilterToSql(filter as FilterCondition, 'deal');
      const stmt = db.prepare(`SELECT "id" FROM "deal" AS "deal" WHERE ${sql}`);
      stmt.bind(params as any[]);
      const got: string[] = [];
      while (stmt.step()) got.push(String(stmt.getAsObject().id));
      stmt.free();
      expect(got.sort((a, b) => a.localeCompare(b))).toEqual(['1']);
    });
  });
});
