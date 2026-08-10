// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5567] The analytics SQL compilers compare LIKE values LITERALLY.
 *
 * Three compilers in this package built a LIKE pattern by concatenating the
 * author's comparand straight into a wildcard position, with no escaping and no
 * `ESCAPE` clause:
 *
 *   - `read-scope-sql.ts`'s `compileOperator` — the ADR-0021 D-C read scope
 *     (tenant + RLS) lowering;
 *   - `native-sql-strategy.ts`'s `likePattern` — the statement that actually
 *     EXECUTES;
 *   - `objectql-strategy.ts`'s `LIKE_SQL_OPS` — the `/analytics/sql` echo, whose
 *     only reason to exist is reproducing execution (#5333).
 *
 * `_` is LIKE's single-character wildcard and `%` its multi-character one, so
 * every comparand carrying one meant something other than what the author wrote.
 * Measured on real SQLite before the fix, through `compileScopedFilterToSql`:
 *
 * | `where`                             | got            | should be |
 * |-------------------------------------|----------------|-----------|
 * | `{name: {$contains: '_admin'}}`     | `['1','2']`    | `['1']`   |
 * | `{name: {$contains: '50%'}}`        | `['3','4']`    | `['3']`   |
 * | `{name: {$startsWith: 'x_'}}`       | `['1','2']`    | `['1']`   |
 * | `{name: {$endsWith: '0% now'}}`     | `['3','4']`    | `['3']`   |
 * | `{name: {$notContains: '_admin'}}`  | `['3','4','5','6']` | `['2','3','4','5','6']` |
 *
 * On the read scope that WIDENING is a permission bypass, not a loose filter —
 * the same "amplification is over-reach, not a degraded filter" ruling #5347 /
 * #5324 made on this very file. And Prime Directive #3 forces machine names to
 * `snake_case`, which guarantees that essentially every machine-name comparand
 * carries at least one `_`.
 *
 * ## The direction this file pins, per case
 *
 * Four of the five rows above are plain **before-red / after-green**: the
 * pre-fix compilers hand back rows the author excluded (or, for `$notContains`,
 * exclude rows the author kept), and the exact-set assertions below fail on the
 * pre-fix tree.
 *
 * The literal-backslash case is **deliberately NOT claimed as before-red on
 * SQLite**, and saying so is the point rather than a caveat. `\` is only a
 * metacharacter once an escape character is in force: SQLite has no default one
 * (which is why `driver-sql` binds an explicit `ESCAPE`), so a pre-fix pattern
 * `%a\b%` matched the literal `a\b` there by accident. The same pre-fix pattern
 * on Postgres/MySQL — where `\` IS the default escape character — reads `\b` as
 * a literal `b` and matches `ab` instead: a miss AND a false hit, in one
 * comparand. So the backslash row is pinned at the layer where the fix is
 * visible on the engine this suite can run (the bound pattern string) plus a
 * row-set non-regression, and the dialect half is argued from the documentation
 * quoted in the PR rather than asserted here.
 *
 * That asymmetry is also why the two halves of the fix must land together: the
 * escaping ALONE would break SQLite (`%\_admin%` with no escape character in
 * force is a search for a literal backslash), and the `ESCAPE` clause alone
 * changes nothing. Both, or neither.
 *
 * ## Why `sql.js`
 *
 * Same reason as `read-scope-sql-conformance.test.ts` and
 * `native-sql-filter-logic-conformance.test.ts`: `better-sqlite3`'s native
 * binding is loadable only by the exact Node ABI it was built for and aborts the
 * vitest worker on CI's Node. `sql.js` is the pure-WASM engine `driver-sql`
 * itself falls back to.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { escapeLikePattern, likePattern, LIKE_ESCAPE_CHAR } from '../like-pattern.js';
import { isBindableComparand, isRenderableTextComparand } from '../comparand-shape.js';

/** A label for a comparand that survives `undefined`, a `Date` and a buffer. */
function describe1(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  if (ArrayBuffer.isView(v)) return 'Uint8Array';
  if (typeof v === 'bigint') return `${v}n`;
  return JSON.stringify(v) ?? String(v);
}

/**
 * The issue's four measured rows, plus a pair for the escape character itself.
 *
 * Each metacharacter row is paired with a DECOY that differs from it by exactly
 * the metacharacter's wildcard reading, so every assertion is an exact set and
 * cannot pass by luck:
 *
 *   - `x_admin` / `xyadmin` — `_` as "any single character".
 *   - `off 50% now` / `off 5012 now` — `%` as "any run of characters".
 *   - `p a\b q` / `p ab q` — `\` as an escape PREFIX, which drops itself and
 *     makes the next character literal.
 */
const FIXTURE = [
  { id: '1', name: 'x_admin' },
  { id: '2', name: 'xyadmin' },
  { id: '3', name: 'off 50% now' },
  { id: '4', name: 'off 5012 now' },
  { id: '5', name: 'p a\\b q' },
  { id: '6', name: 'p ab q' },
];

const ALL_IDS = ['1', '2', '3', '4', '5', '6'];

const CUBE: Cube = {
  name: 'people',
  title: 'People',
  sql: 'person',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    name: { name: 'name', label: 'Name', type: 'string', sql: 'name' },
  },
  public: false,
} as unknown as Cube;

const query = (where: unknown): AnalyticsQuery =>
  ({
    cube: 'people',
    measures: ['total'],
    dimensions: ['id'],
    timezone: 'UTC',
    where,
  }) as AnalyticsQuery;

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

describe('[#5567] analytics LIKE compilers escape their comparand', () => {
  let db: any;
  /** `ctx` for the raw-SQL strategy: `$n` → `?`, exactly as `plugin.ts` bridges. */
  let nativeCtx: StrategyContext;
  /** `ctx` for the ObjectQL strategy — used for its `generateSql` echo only. */
  let echoCtx: StrategyContext;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
    db = new SQL.Database();
    db.run(`CREATE TABLE "person" ("id" TEXT PRIMARY KEY, "name" TEXT);`);
    const insert = db.prepare(`INSERT INTO "person" ("id","name") VALUES (?,?)`);
    for (const r of FIXTURE) insert.run([r.id, r.name]);
    insert.free();

    const base = {
      getCube: (name: string) => (name === 'people' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    };
    nativeCtx = {
      ...base,
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => run(sql, params).rows,
    } as StrategyContext;
    echoCtx = { ...base } as StrategyContext;
  });

  afterAll(() => {
    db?.close();
  });

  /** Run a `$n`-placeholder statement on the fixture, as every consumer does. */
  const run = (sql: string, params: unknown[]): { rows: Record<string, unknown>[]; ids: string[] } => {
    const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
    stmt.bind(params as any[]);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return { rows, ids: rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b)) };
  };

  // ── The helper the three compilers now share ────────────────────────────────

  describe('escapeLikePattern', () => {
    it('escapes the two wildcards and the escape character itself', () => {
      expect(escapeLikePattern('_admin')).toBe('\\_admin');
      expect(escapeLikePattern('50%')).toBe('50\\%');
      expect(escapeLikePattern('a_b')).toBe('a\\_b');
      expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
    });

    it('leaves a comparand with no metacharacter byte-identical', () => {
      expect(escapeLikePattern('plain')).toBe('plain');
      expect(escapeLikePattern('a.b')).toBe('a.b');
    });

    it('is the same transform `driver-sql`\'s `applyLike` applies', () => {
      // Mirrored, not imported: `service-analytics` depends on no driver (see
      // its package.json). The expression is duplicated HERE, in a test, so the
      // two implementations are held to each other by a failing assertion
      // rather than by two TSDoc comments alone.
      const driverSqlEscape = (v: unknown) => String(v).replace(/[\\%_]/g, '\\$&');
      for (const v of ['_admin', '50%', 'a\\b', 'plain', '%_\\', '']) {
        expect(escapeLikePattern(v), JSON.stringify(v)).toBe(driverSqlEscape(v));
      }
    });

    it('positions the wildcard by shape', () => {
      expect(likePattern('contains', '_admin')).toBe('%\\_admin%');
      expect(likePattern('starts', '_admin')).toBe('\\_admin%');
      expect(likePattern('ends', '_admin')).toBe('%\\_admin');
    });
  });

  // ── [#5234] Which comparands may reach that transform at all ────────────────

  /**
   * The escape expression above answers "how is a comparand rendered"; this
   * block answers "which comparands are rendered at all", and the two must move
   * together. `escapeLikePattern` still takes `unknown` and still calls
   * `String()` unconditionally — that is only safe while both packages agree on
   * the fence in front of it, so the fence is mirrored here exactly the way
   * `driverSqlEscape` mirrors the transform.
   *
   * Why it is a fence and not a tolerant `String()`: `String({})` is the literal
   * `'[object Object]'`, which builds a valid, parameterised `LIKE` pattern
   * nobody wrote — and against a row storing that text it MATCHES. The
   * `$notContains` direction then excludes a real row. Measured before the fix
   * on `driver-sql`, `driver-memory` and both faces here.
   */
  describe('[#5234] the comparand fence in front of that transform', () => {
    /**
     * `driver-sql`'s `isRenderableTextComparand`, mirrored — same reason the
     * escape expression is mirrored above. If either package widens or narrows
     * its allow-list, this assertion is what goes red.
     */
    const driverSqlRenderable = (v: unknown): boolean => {
      if (v === null || v === undefined) return true;
      const kind = typeof v;
      if (kind === 'string' || kind === 'number' || kind === 'bigint' || kind === 'boolean') return true;
      return v instanceof Date;
    };

    /** `driver-sql`'s `isBindableComparand`, mirrored — the `$in`-member half. */
    const driverSqlBindable = (v: unknown): boolean => {
      if (v === null || v === undefined) return true;
      const kind = typeof v;
      if (kind === 'string' || kind === 'number' || kind === 'bigint' || kind === 'boolean') return true;
      return v instanceof Date || ArrayBuffer.isView(v);
    };

    /**
     * One table, both predicates, spanning every branch of each: the primitives
     * #5526 deliberately kept, the `Date` `driver-turso`'s allow-list keeps as
     * its one object conversion, the binary that binds but does not render, and
     * the object shapes #5234 refuses.
     */
    const VALUES: unknown[] = [
      '_admin', '', 'plain', 0, 5, -1.5, 9n, true, false, null, undefined,
      new Date('2026-01-01T00:00:00.000Z'), new Uint8Array([1, 2]),
      {}, { foo: 1 }, { $field: 'other' }, ['al', 'be'], [],
    ];

    it('`isRenderableTextComparand` matches `driver-sql`, value for value', () => {
      for (const v of VALUES) {
        expect(isRenderableTextComparand(v), `renderable(${describe1(v)})`).toBe(driverSqlRenderable(v));
      }
    });

    it('`isBindableComparand` matches `driver-sql`, value for value', () => {
      for (const v of VALUES) {
        expect(isBindableComparand(v), `bindable(${describe1(v)})`).toBe(driverSqlBindable(v));
      }
    });

    it('every value the fence admits, `String()` renders faithfully', () => {
      // The property that makes the unconditional `String()` in
      // `escapeLikePattern` correct rather than merely unexercised.
      for (const v of VALUES.filter(isRenderableTextComparand)) {
        expect(String(v), describe1(v)).not.toBe('[object Object]');
      }
      // …and the refused ones are exactly the values that would have produced a
      // pattern nobody wrote.
      expect(String({})).toBe('[object Object]');
      expect(String(['al', 'be'])).toBe('al,be');
    });

    it('the array case is a SPLIT this fence closes, not a behaviour it invents', () => {
      // `read-scope-sql` bound `%al,be%` (String of the whole array) while the
      // analytics `where` door bound `%al%` (it reads `values[0]`), for one
      // filter. Both doors now refuse it, so there is no third answer to pick.
      expect(isRenderableTextComparand(['al', 'be'])).toBe(false);
      expect(likePattern('contains', 'al')).toBe('%al%');
      expect(likePattern('contains', ['al', 'be'] as unknown as string)).toBe('%al,be%');
    });
  });

  // ── Binding layer: the issue's measured table, all three compilers ──────────

  describe("the issue's binding table — every compiler binds the ESCAPED pattern", () => {
    /** The pattern + escape char `read-scope-sql` binds for one operator. */
    const readScopeBinds = (op: string, value: string): unknown[] =>
      compileScopedFilterToSql({ name: { [op]: value } } as FilterCondition, 'person').params;

    /** The params the EXECUTED statement binds. */
    const nativeBinds = async (op: string, value: string): Promise<unknown[]> =>
      (await new NativeSQLStrategy().generateSql(query({ name: { [op]: value } }), nativeCtx)).params;

    /** The params the `/analytics/sql` echo shows. */
    const echoBinds = async (op: string, value: string): Promise<unknown[]> =>
      (await new ObjectQLStrategy().generateSql(query({ name: { [op]: value } }), echoCtx)).params;

    const TABLE: Array<{ op: string; value: string; pattern: string }> = [
      { op: '$contains', value: '_admin', pattern: '%\\_admin%' },
      { op: '$startsWith', value: '_admin', pattern: '\\_admin%' },
      { op: '$endsWith', value: '_admin', pattern: '%\\_admin' },
      { op: '$contains', value: '50%', pattern: '%50\\%%' },
      { op: '$contains', value: 'a_b', pattern: '%a\\_b%' },
      { op: '$notContains', value: '_admin', pattern: '%\\_admin%' },
      { op: '$contains', value: 'a\\b', pattern: '%a\\\\b%' },
    ];

    for (const { op, value, pattern } of TABLE) {
      it(`${op} ${JSON.stringify(value)} binds ${JSON.stringify(pattern)} + the escape char, on all three`, async () => {
        const expected = [pattern, LIKE_ESCAPE_CHAR];
        expect(readScopeBinds(op, value), 'read-scope-sql').toEqual(expected);
        expect(await nativeBinds(op, value), 'native-sql-strategy').toEqual(expected);
        expect(await echoBinds(op, value), 'objectql-strategy echo').toEqual(expected);
      });
    }

    it('declares the ESCAPE clause in the SQL of all three — escaping alone breaks SQLite', () => {
      // Half a fix is a different bug: a pattern carrying `\_` with no escape
      // character in force is a search for a literal backslash, so on SQLite
      // (no default escape char) escaping without the clause returns NO rows.
      const { sql } = compileScopedFilterToSql({ name: { $contains: 'x' } } as FilterCondition, 'person');
      expect(sql).toBe('"person"."name" LIKE ? ESCAPE ?');
    });

    it('a comparand with no metacharacter binds the pattern it always did', async () => {
      // Zero-regression: the only change for an ordinary value is the appended
      // ESCAPE clause, which is a no-op for a pattern that carries no `\`.
      for (const [op, pattern] of [
        ['$contains', '%plain%'],
        ['$startsWith', 'plain%'],
        ['$endsWith', '%plain'],
        ['$notContains', '%plain%'],
      ] as Array<[string, string]>) {
        expect(readScopeBinds(op, 'plain')[0], `read-scope ${op}`).toBe(pattern);
        expect((await nativeBinds(op, 'plain'))[0], `native ${op}`).toBe(pattern);
        expect((await echoBinds(op, 'plain'))[0], `echo ${op}`).toBe(pattern);
      }
    });
  });

  // ── Row sets: the issue's measured table, on real SQLite ────────────────────

  describe("the issue's row table — read-scope-sql, exact sets", () => {
    /** Rows a read scope admits — `compileScopedFilterToSql` + the fixture. */
    const scopedIds = (scope: FilterCondition): string[] => {
      const { sql, params } = compileScopedFilterToSql(scope, 'person');
      return run(`SELECT "id" FROM "person" AS "person" WHERE ${sql}`, params).ids;
    };

    const CASES: Array<{ where: FilterCondition; expected: string[]; was: string }> = [
      // The two rows the issue measured.
      { where: { name: { $contains: '_admin' } }, expected: ['1'], was: "['1','2'] — `_` matched the `y` of `xyadmin`" },
      { where: { name: { $contains: '50%' } }, expected: ['3'], was: "['3','4'] — `%` matched the `12` of `off 5012 now`" },
      // The three operators the issue measured only at the binding layer.
      { where: { name: { $startsWith: 'x_' } }, expected: ['1'], was: "['1','2']" },
      { where: { name: { $endsWith: '0% now' } }, expected: ['3'], was: "['3','4']" },
      {
        where: { name: { $notContains: '_admin' } },
        // The one operator whose direction is NARROWING: it excluded row 2 as
        // well, so the author lost a row they kept rather than gaining one.
        expected: ['2', '3', '4', '5', '6'],
        was: "['3','4','5','6'] — row 2 wrongly excluded",
      },
    ];

    for (const { where, expected, was } of CASES) {
      it(`${JSON.stringify(where)} → ${JSON.stringify(expected)} (was ${was})`, () => {
        expect(scopedIds(where)).toEqual(expected);
        // Belt and braces on the widening direction: the whole fixture back is
        // the shape a read scope must never produce (#5347 / #5324).
        expect(scopedIds(where).length).toBeLessThan(ALL_IDS.length);
      });
    }

    it('the escape character itself compares literally', () => {
      // Pinned as a pattern-level fact plus a row-set NON-regression, not as a
      // before-red row set: see this file's header. On SQLite `\` is literal
      // either way, because there is no default escape character to make it a
      // metacharacter; the pre-fix pattern `%a\b%` reads as a literal `b` on
      // Postgres/MySQL, where `\` IS the default, and matches row 6 instead.
      const { sql, params } = compileScopedFilterToSql(
        { name: { $contains: 'a\\b' } } as FilterCondition,
        'person',
      );
      expect(params).toEqual(['%a\\\\b%', LIKE_ESCAPE_CHAR]);
      expect(run(`SELECT "id" FROM "person" AS "person" WHERE ${sql}`, params).ids).toEqual(['5']);
    });

    it('an ordinary substring still finds its rows', () => {
      expect(scopedIds({ name: { $contains: 'admin' } })).toEqual(['1', '2']);
      expect(scopedIds({ name: { $startsWith: 'off' } })).toEqual(['3', '4']);
      expect(scopedIds({ name: { $endsWith: 'now' } })).toEqual(['3', '4']);
    });
  });

  // ── Why the two halves cannot be separated ──────────────────────────────────

  /**
   * The engine's own answers, measured directly rather than through a compiler.
   *
   * These four rows are why `likePattern` and the `ESCAPE` binding are one fix
   * and not two independent improvements. They are asserted here so a later
   * "simplification" that drops either half fails with a reason attached instead
   * of just moving a row count.
   */
  describe('SQLite itself: escaping and the ESCAPE clause are one fix', () => {
    const ids = (pattern: string, escape?: string): string[] =>
      run(
        `SELECT "id" FROM "person" WHERE "name" LIKE ?${escape === undefined ? '' : ' ESCAPE ?'}`,
        escape === undefined ? [pattern] : [pattern, escape],
      ).ids;

    it('neither half alone: raw+no-clause widens, escaped+no-clause returns NOTHING', () => {
      // What the compilers did before this change — the issue's measured row.
      expect(ids('%_admin%')).toEqual(['1', '2']);
      // Escaping ALONE: with no escape character in force, `\_` is a search for
      // a literal backslash followed by `_`, which no row contains. Silently
      // zero rows is a worse failure than the widening it replaces.
      expect(ids('%\\_admin%')).toEqual([]);
      // The clause ALONE: nothing in the pattern is escaped, so nothing changes.
      expect(ids('%_admin%', '\\')).toEqual(['1', '2']);
      // Both: the comparand compares literally.
      expect(ids('%\\_admin%', '\\')).toEqual(['1']);
    });

    it('a BOUND escape argument is accepted — it need not be a SQL literal', () => {
      // The premise of binding rather than writing `ESCAPE '\'` into the text.
      expect(ids('%50\\%%', '\\')).toEqual(['3']);
    });

    it('why `\\` is a dialect divergence pre-fix, simulated on this engine', () => {
      // Postgres and MySQL both DEFAULT to `\` as the escape character, so a
      // pre-fix `LIKE '%a\b%'` there behaves exactly as the SQLite statement
      // with the clause supplied — the middle row below. This is a simulation of
      // the documented default, not a run against those engines (this suite has
      // neither), and it is the reason the backslash case is not claimed as
      // before-red on SQLite.
      expect(ids('%a\\b%'), 'SQLite pre-fix: no default escape char, `\\` literal').toEqual(['5']);
      expect(ids('%a\\b%', '\\'), 'PG/MySQL pre-fix: `\\b` reads as a literal `b`').toEqual(['6']);
      expect(ids('%a\\\\b%', '\\'), 'post-fix: the same row on every dialect').toEqual(['5']);
    });
  });

  // ── Row sets through the statement that actually executes ───────────────────

  describe('NativeSQLStrategy — the statement that runs', () => {
    const ids = async (where: unknown): Promise<string[]> => {
      const result = await new NativeSQLStrategy().execute(query(where), nativeCtx);
      return result.rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
    };

    it("the issue's two rows, through the executed statement", async () => {
      expect(await ids({ name: { $contains: '_admin' } })).toEqual(['1']);
      expect(await ids({ name: { $contains: '50%' } })).toEqual(['3']);
    });

    it('the three operators the issue measured only at the binding layer', async () => {
      expect(await ids({ name: { $startsWith: 'x_' } })).toEqual(['1']);
      expect(await ids({ name: { $endsWith: '0% now' } })).toEqual(['3']);
      expect(await ids({ name: { $notContains: '_admin' } })).toEqual(['2', '3', '4', '5', '6']);
    });

    it('an ordinary substring is unaffected', async () => {
      expect(await ids({ name: { $contains: 'admin' } })).toEqual(['1', '2']);
    });
  });

  // ── The echo reproduces execution (#3601 / #3602 / #3650, #5333) ────────────

  describe('the `/analytics/sql` echo agrees with execution', () => {
    const echoed = async (where: unknown) =>
      new ObjectQLStrategy().generateSql(query(where), echoCtx);

    const METACHAR_CASES = [
      { name: { $contains: '_admin' } },
      { name: { $contains: '50%' } },
      { name: { $startsWith: 'x_' } },
      { name: { $endsWith: '0% now' } },
      { name: { $notContains: '_admin' } },
      { name: { $contains: 'a\\b' } },
    ];

    it('binds the same pattern the executed statement binds', async () => {
      for (const where of METACHAR_CASES) {
        const echo = await echoed(where);
        const native = await new NativeSQLStrategy().generateSql(query(where), nativeCtx);
        expect(echo.params, JSON.stringify(where)).toEqual(native.params);
      }
    });

    it('and running the echo returns the rows the query returns, not more', async () => {
      for (const [where, expected] of [
        [{ name: { $contains: '_admin' } }, ['1']],
        [{ name: { $contains: '50%' } }, ['3']],
        [{ name: { $startsWith: 'x_' } }, ['1']],
        [{ name: { $endsWith: '0% now' } }, ['3']],
        [{ name: { $notContains: '_admin' } }, ['2', '3', '4', '5', '6']],
      ] as Array<[unknown, string[]]>) {
        const { sql, params } = await echoed(where);
        expect(run(sql, params).ids, `echo ${JSON.stringify(where)}`).toEqual(expected);
      }
    });

    it('renders the ESCAPE clause, so the statement an author copies out runs the same', async () => {
      const { sql } = await echoed({ name: { $contains: 'x' } });
      expect(sql).toMatch(/name LIKE \$\d+ ESCAPE \$\d+/);
    });
  });

  /**
   * [#6518] The dialect assumption `like-pattern.ts` now writes down, made
   * FALSIFIABLE.
   *
   * #6518 moved the driver family off a plain `LIKE` — SQLite's folds ASCII
   * case, MySQL's follows its collation, and #4706 Q2 = A rules the family
   * case-SENSITIVE — while these three compilers kept `LIKE`. That is correct
   * only because what they emit is Postgres-shaped, and on Postgres `LIKE` IS
   * case-exact. A comment saying so rots silently; this block goes red.
   *
   * Two claims, and both have to hold for the file's reasoning to survive:
   *
   *   1. the emitted statement really is Postgres-shaped (`$N` placeholders,
   *      `"double quoted"` identifiers) — so a change that started emitting for
   *      SQLite or MySQL trips here first;
   *   2. the `$contains` family compiles CASE-EXACTLY — no `ILIKE`, no
   *      `LOWER()`, no fold of any kind wrapped around either operand.
   *
   * On `read-scope-sql.ts`'s output the second claim is a permission boundary,
   * not a filter preference: a wider predicate there is ADR-0021 read-scope
   * over-reach (#3948).
   */
  describe('[#6518] the case-sensitivity assumption these compilers rest on', () => {
    const TEXT_FAMILY = ['$contains', '$notContains', '$startsWith', '$endsWith'] as const;

    it('read-scope-sql compiles the family case-EXACTLY — no ILIKE, no fold', () => {
      for (const op of TEXT_FAMILY) {
        const { sql } = compileScopedFilterToSql(
          { name: { [op]: 'Admin' } } as FilterCondition,
          'person',
        );
        expect(sql, op).toMatch(/LIKE/);
        expect(sql, op).not.toMatch(/ILIKE|LOWER\s*\(|lower\s*\(|translate\s*\(|GLOB/);
      }
    });

    it('read-scope-sql emits `?` for its consumers to renumber, and quotes identifiers', () => {
      const { sql, params } = compileScopedFilterToSql(
        { name: { $contains: 'Admin' } } as FilterCondition,
        'person',
      );
      // `?` here, `$N` after the consumers rewrite it — the shape both
      // `applyReadScope` and `generateSql` depend on, and the reason the escape
      // character can be a bound value rather than a per-dialect literal.
      expect(sql).toContain('?');
      expect(sql).toContain('"person"."name"');
      expect(params).toEqual(['%Admin%', LIKE_ESCAPE_CHAR]);
    });

    it('both executing compilers number their placeholders Postgres-style', async () => {
      const native = await new NativeSQLStrategy().generateSql(query({ name: { $contains: 'x' } }), nativeCtx);
      const echo = await new ObjectQLStrategy().generateSql(query({ name: { $contains: 'x' } }), echoCtx);
      for (const [label, sql] of [['native', native.sql], ['echo', echo.sql]] as const) {
        expect(sql, label).toMatch(/\$\d+/);
        // `?` is SQLite's and MySQL's placeholder. Its appearance would mean the
        // statement stopped being Postgres-shaped, which is exactly the premise
        // `like-pattern.ts`'s #6518 section says to re-open.
        expect(sql, label).not.toMatch(/[^$\w]\?/);
        expect(sql, label).not.toMatch(/ILIKE|LOWER\s*\(/);
      }
    });

    /**
     * [#6520] This case used to pin `$icontains` as REFUSED at both doors — the
     * state #6518 deliberately left it in, because implementing it belonged with
     * the vocabulary admission rather than with a driver-lane case-folding fix.
     * #6520 did that, so the case is REPLACED rather than re-spelled: an
     * assertion that the operator throws would now be pinning a refusal that no
     * longer exists, and it would keep passing for the wrong reason if the arm
     * were deleted in one compiler but not the other.
     *
     * What it pins instead is the property the refusal was standing in for —
     * that the predicate is EMITTED, folded on BOTH sides, and folded with the
     * construct the ruling names.
     */
    it('$icontains compiles at both doors, folding ASCII on both sides', async () => {
      const scoped = compileScopedFilterToSql(
        { name: { $icontains: 'admin' } } as FilterCondition, 'person',
      );
      const native = await new NativeSQLStrategy().generateSql(
        query({ name: { $icontains: 'admin' } }), nativeCtx,
      );

      for (const [label, sql] of [['scoped', scoped.sql], ['native', native.sql]] as const) {
        // BOTH sides: folding only the comparand matches just the rows that were
        // already lower-case — a wrong row set that looks like a working filter.
        expect(sql.match(/translate\(/g) ?? [], label).toHaveLength(2);
        expect(sql, label).toContain('LIKE');
        expect(sql, label).toContain("'ABCDEFGHIJKLMNOPQRSTUVWXYZ'");
        // NOT `LOWER()`: Postgres folds Unicode with it, and the contract is
        // ASCII-only (#4706 Q1 = A). This is the same assertion the neighbouring
        // Postgres-shape case makes, aimed at the one operator that folds.
        expect(sql, label).not.toMatch(/LOWER\s*\(|ILIKE/i);
      }
      // The comparand is still ESCAPED and its ESCAPE character still bound —
      // the fold rides ON TOP of the literal-comparand rule, it does not replace
      // it (this file's whole subject).
      expect(scoped.params).toEqual(['%admin%', '\\']);
      expect(native.params).toEqual(['%admin%', '\\']);
    });

    /**
     * [#6520] The comparand rule survives the new arm: `$icontains` is a
     * LITERAL substring search, so a `%` in the comparand is a percent sign.
     */
    it('$icontains escapes LIKE metacharacters like its case-exact twin', () => {
      const { params } = compileScopedFilterToSql(
        { name: { $icontains: '100%' } } as FilterCondition, 'person',
      );
      expect(params).toEqual(['%100\\%%', '\\']);
    });
  });
});
