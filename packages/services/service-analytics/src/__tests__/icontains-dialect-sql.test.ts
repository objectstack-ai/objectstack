// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15780] `$icontains` on this package's three SQL compilers, per DIALECT —
 * `NativeSQLStrategy.buildFilterClause` (the query's own `where`),
 * `compileScopedFilterToSql` (`read-scope-sql.ts`, the ADR-0021 D-C read scope)
 * and the `ObjectQLStrategy` echo of that statement.
 *
 * ## The defect this closes
 *
 * All three compiled the #6520 fold as `translate(col, 'ABC…', 'abc…') LIKE
 * translate(?, …) ESCAPE ?` on EVERY dialect. `translate()` is a
 * PostgreSQL/Oracle function; SQLite has none. So this is not the #15684
 * failure mode restated — that family answered the WRONG ROWS. This one does
 * not answer at all: measured on sql.js 1.14.1 (SQLite 3.49.1, the engine
 * `driver-sqlite-wasm` runs), `SELECT translate('ABC','ABC','abc')` is `no such
 * function: translate`, so the statement fails to PARSE. Asserted below as the
 * `unknown`-dialect control rather than argued.
 *
 * `read-scope-sql.ts` is the compiler that makes this more than a broken chart:
 * an RLS read scope carrying `$icontains` over a SQLite datasource compiles to
 * a statement the engine refuses, so the scope cannot be evaluated at all.
 *
 * ## Why the pins are per dialect, and what each cell's evidence is
 *
 *   - **sqlite → EXECUTED.** Every assertion below that names row ids ran on
 *     sql.js. The construct is `lower(col) GLOB lower(?)`, and SQLite's
 *     `lower()` is ASCII-only — measured, `lower('CAFÉ')` is `cafÉ` — which is
 *     exactly the #4706 Q1 = A boundary this operator is ruled to.
 *   - **postgres → byte-identical text.** `translate()` is correct there today,
 *     so the correct diff is no diff: the emitted SQL and params are asserted
 *     verbatim against the pre-#15780 bytes, for all three compilers.
 *   - **[#16028] `unknown` (no hook wired) → the portable `REPLACE` chain,
 *     EXECUTED.** #15780 left this arm on `translate()` and called it
 *     unbroken, which held only for the dialects the arm was PICTURED as
 *     (mssql, oracle, which have `translate()`). `unknown` is not a dialect:
 *     `normalizeSqlDialect` routes EVERYTHING it cannot name here, SQLite
 *     included, so the residue arm carried the whole defect forward for the
 *     four embedder compositions #16028 lists — among them a public
 *     `AnalyticsService` constructed with its OPTIONAL `sqlDialect` left out.
 *     The arm now folds with one nested `REPLACE` per ASCII letter, which every
 *     SQL dialect parses, and the rows it answers on this engine are asserted
 *     below from the same shared table the `sqlite` arm answers.
 *
 *     ⛔ NOT `LOWER()`, which is what `driver-sql`'s `unknown` arm folds with:
 *     `LOWER()` follows the collation, so adopting it would trade this parse
 *     failure for SILENTLY wrong rows on PostgreSQL — the Unicode fold #4706
 *     Q1 = A rules out. ⚠️ And measuring `LOWER()` HERE proves nothing about
 *     that, because SQLite's `lower()` is ASCII-only and answers the shared
 *     table correctly: the trap is a green SQLite reading standing in for a
 *     PostgreSQL one, so the `REPLACE` chain is pinned as ASCII-only BY
 *     CONSTRUCTION (over every ASCII code point, below) rather than by a fold
 *     that happens to behave on the one engine in this container.
 *   - **mysql → NOT MEASURED.** The nested-`REPLACE`-over-`CAST(… AS BINARY)`
 *     arm is asserted as TEXT only. No MySQL server is provisionable in this
 *     container — the same declared skip `driver-sql`'s #6518 suite and this
 *     package's #15684 suite both record, not a claimed pass.
 *
 * ## What holds this package's table to `driver-sql`'s
 *
 * The last describe runs the SAME `FILTER_TEXT_CASES` rows through a real
 * `SqliteWasmDriver` (a devDependency, never a runtime one) and requires the
 * same row sets from both faces — the anti-drift mechanism #15684 established,
 * extended to the fold row. A third hand-copy of the table is the thing to
 * refuse.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { FILTER_TEXT_CASES, FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import type { DatasetScopedStrategyContext } from '../strategies/types.js';

/**
 * The shared table's rows that aim `$icontains` at the TEXT column.
 *
 * Taken from `FILTER_TEXT_CASES` rather than restated, so this suite answers
 * the same standard the five drivers answer, and the count is asserted below: a
 * row added upstream must reach this face too.
 */
const NAME_ICONTAINS = FILTER_TEXT_CASES.filter(
  (c): c is Extract<typeof c, { expected: readonly string[] }> => {
    if (c.expectRejection === true) return false;
    const entries = Object.entries(c.filter as Record<string, unknown>);
    if (entries.length !== 1) return false;
    const [field, predicate] = entries[0];
    if (field !== 'name' || typeof predicate !== 'object' || predicate === null) return false;
    return Object.keys(predicate as Record<string, unknown>)[0] === '$icontains';
  },
);

const CUBE: Cube = {
  name: 'texts',
  title: 'Texts',
  sql: 'rows',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    name: { name: 'name', label: 'Name', type: 'string', sql: 'name' },
  },
  public: false,
} as unknown as Cube;

const query = (where: unknown): AnalyticsQuery =>
  ({ cube: 'texts', measures: ['total'], dimensions: ['id'], timezone: 'UTC', where }) as AnalyticsQuery;

/** Point sql.js at the `.wasm` shipped inside its own package (Node-safe). */
async function locateWasm(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    return (file: string) => join(dirname(pkgJsonPath), 'dist', file);
  } catch {
    return undefined;
  }
}

const ctxFor = (dialect?: string): DatasetScopedStrategyContext =>
  ({
    getCube: (name: string) => (name === 'texts' ? CUBE : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    ...(dialect ? { sqlDialect: () => dialect } : {}),
  }) as DatasetScopedStrategyContext;

const TRANSLATE_FOLD =
  "translate(name, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')";

/**
 * [#16028] The `unknown` arm's fold, rebuilt HERE from the ruled domain rather
 * than imported from the implementation — a second construction of the expected
 * text, so a change to the emitter's loop does not quietly re-bless itself.
 *
 * The endpoints are pinned verbatim beside every use (`REPLACE(name, 'A', 'a')`
 * innermost, `'Z', 'z')` outermost), which is also what discriminates this arm
 * from MySQL's: that one's innermost operand is `CAST(name AS BINARY)`.
 */
const ASCII_UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ASCII_LO = 'abcdefghijklmnopqrstuvwxyz';
const replaceFold = (expr: string): string => {
  let out = expr;
  for (let i = 0; i < ASCII_UP.length; i++) out = `REPLACE(${out}, '${ASCII_UP[i]}', '${ASCII_LO[i]}')`;
  return out;
};

describe('[#15780] the compiled TEXT, per dialect — all three compilers', () => {
  const nativeSql = async (where: unknown, dialect?: string) =>
    new NativeSQLStrategy().generateSql(query(where), ctxFor(dialect));
  const echoSql = async (where: unknown, dialect?: string) =>
    new ObjectQLStrategy().generateSql(query(where), ctxFor(dialect));

  it('postgres keeps the pre-#15780 bytes exactly — the arm that was always right', async () => {
    // The non-regression half. Asserted verbatim, not by shape: `translate()`
    // is correct on Postgres, so the correct diff there is no diff — through
    // #15780 and through #16028 alike.
    const out = await nativeSql({ name: { $icontains: 'acme' } }, 'postgres');
    expect(out.sql).toContain(
      `WHERE ${TRANSLATE_FOLD} LIKE translate($1, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') ESCAPE $2`,
    );
    expect(out.params).toEqual(['%acme%', '\\']);

    const echo = await echoSql({ name: { $icontains: 'acme' } }, 'postgres');
    expect(echo.sql).toContain(
      `${TRANSLATE_FOLD} LIKE translate($1, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') ESCAPE $2`,
    );
    expect(echo.params).toEqual(['%acme%', '\\']);

    expect(
      compileScopedFilterToSql({ name: { $icontains: 'acme' } } as FilterCondition, 't', { dialect: 'postgres' }),
    ).toEqual({
      sql:
        `translate("t"."name", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') LIKE ` +
        `translate(?, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') ESCAPE ?`,
      params: ['%acme%', '\\'],
    });
  });

  it('[#16028] a host that wired NO hook folds with the PORTABLE chain, on all three compilers', async () => {
    // The moved cells, stated as the pin rather than left to a regenerate: the
    // `unknown` arm's emitted text CHANGED, from `translate()` — which SQLite
    // and MySQL/MariaDB cannot parse — to a nested `REPLACE` per ASCII letter,
    // which every SQL dialect can. The rows this text answers are executed
    // further down; here it is the bytes and the bindings.
    for (const dialect of [undefined, 'oracle', 'libsql'] as const) {
      // All three normalize to `unknown`: an unset hook, and two spellings
      // `normalizeSqlDialect` does not model. One arm, reached three ways.
      const out = await nativeSql({ name: { $icontains: 'acme' } }, dialect);
      expect(out.sql, String(dialect)).toContain(
        `WHERE ${replaceFold('name')} LIKE ${replaceFold('$1')} ESCAPE $2`,
      );
      expect(out.sql, String(dialect)).not.toMatch(/translate\(/);
      // The chain's endpoints, verbatim — and the innermost operand is the bare
      // column, which is what tells this arm apart from MySQL's `CAST(… AS
      // BINARY)` one.
      expect(out.sql, String(dialect)).toContain("REPLACE(name, 'A', 'a')");
      expect(out.sql, String(dialect)).toContain("'Z', 'z')");
      expect(out.sql, String(dialect)).not.toMatch(/CAST\(/);
      expect(out.params, String(dialect)).toEqual(['%acme%', '\\']);

      const echo = await echoSql({ name: { $icontains: 'acme' } }, dialect);
      expect(echo.sql, `echo ${String(dialect)}`).toContain(
        `${replaceFold('name')} LIKE ${replaceFold('$1')} ESCAPE $2`,
      );
      expect(echo.sql, `echo ${String(dialect)}`).not.toMatch(/translate\(/);
      expect(echo.params, `echo ${String(dialect)}`).toEqual(['%acme%', '\\']);
    }

    // The read scope — the compiler where an unevaluable statement is an
    // ADR-0021 policy that cannot be applied at all.
    const noHook = compileScopedFilterToSql({ name: { $icontains: 'acme' } } as FilterCondition, 't');
    expect(noHook).toEqual({
      sql: `${replaceFold('"t"."name"')} LIKE ${replaceFold('?')} ESCAPE ?`,
      params: ['%acme%', '\\'],
    });
    expect(noHook.sql).not.toMatch(/translate\(/);
    expect(
      compileScopedFilterToSql({ name: { $icontains: 'acme' } } as FilterCondition, 't', { dialect: 'nonesuch' }),
    ).toEqual(noHook);

    // ⛔ And the arm did NOT become Postgres's: the two are now different text,
    // which is the whole point of splitting them.
    const pg = await nativeSql({ name: { $icontains: 'acme' } }, 'postgres');
    const unknown = await nativeSql({ name: { $icontains: 'acme' } }, undefined);
    expect(unknown.sql).not.toBe(pg.sql);
    expect(unknown.params).toEqual(pg.params);
  });

  it('[#16028] the case-EXACT four are byte-identical on `unknown` — only the FOLD moved', async () => {
    // The blast-radius pin. `fold` is the only thing #16028 changed on this
    // arm, so every case-exact operator must still emit the plain `LIKE` it
    // emitted before — no `REPLACE` anywhere near them.
    for (const op of ['$contains', '$notContains', '$startsWith', '$endsWith'] as const) {
      const out = await nativeSql({ name: { [op]: 'acme' } }, undefined);
      expect(out.sql, op).not.toMatch(/REPLACE\(|translate\(|lower\(/);
      expect(out.sql, op).toMatch(/name (NOT )?LIKE \$1 ESCAPE \$2/);
    }
    expect(compileScopedFilterToSql({ name: { $contains: 'acme' } } as FilterCondition, 't')).toEqual({
      sql: '"t"."name" LIKE ? ESCAPE ?',
      params: ['%acme%', '\\'],
    });
  });

  it('sqlite compiles lower() over GLOB — one bound value, no ESCAPE clause', async () => {
    const out = await nativeSql({ name: { $icontains: 'acme' } }, 'sqlite');
    expect(out.sql).toContain('WHERE lower(name) GLOB lower($1)');
    expect(out.sql).not.toMatch(/translate\(/);
    expect(out.sql).not.toMatch(/ESCAPE/);
    expect(out.params).toEqual(['*acme*']);

    const echo = await echoSql({ name: { $icontains: 'acme' } }, 'sqlite');
    expect(echo.sql).toContain('lower(name) GLOB lower($1)');
    expect(echo.sql).not.toMatch(/translate\(/);
    expect(echo.params).toEqual(['*acme*']);

    expect(compileScopedFilterToSql({ name: { $icontains: 'acme' } } as FilterCondition, 't', { dialect: 'sqlite' }))
      .toEqual({ sql: 'lower("t"."name") GLOB lower(?)', params: ['*acme*'] });
  });

  it('mysql compiles the nested-REPLACE binary fold — TEXT ONLY, NOT MEASURED on a server', async () => {
    // Character for character `driver-sql`'s `mysqlAsciiLowerBinary`: 26 nested
    // REPLACEs over `CAST(… AS BINARY)`, so the fold is ASCII-only and the
    // comparison is byte-wise whatever the column's collation says.
    const out = await nativeSql({ name: { $icontains: 'acme' } }, 'mysql');
    expect(out.sql).toContain("REPLACE(REPLACE(CAST(name AS BINARY), 'A', 'a')");
    expect(out.sql).toContain("REPLACE(REPLACE(CAST($1 AS BINARY), 'A', 'a')");
    expect(out.sql).toContain(' LIKE ');
    expect(out.sql).toContain('ESCAPE $2');
    expect(out.sql).not.toMatch(/translate\(/);
    expect(out.params).toEqual(['%acme%', '\\']);
    // The last REPLACE of the chain is `Z` → `z`, on both sides.
    expect(out.sql).toContain("'Z', 'z')");

    const scoped = compileScopedFilterToSql(
      { name: { $icontains: 'acme' } } as FilterCondition,
      't',
      { dialect: 'mysql' },
    );
    expect(scoped.sql).toContain('CAST("t"."name" AS BINARY)');
    expect(scoped.sql).toContain('CAST(? AS BINARY)');
    expect(scoped.params).toEqual(['%acme%', '\\']);
  });

  it('the case-EXACT family is untouched by this change — #15684\'s constructs, unchanged', async () => {
    // The mirror of the control #15684 wrote for `$icontains`: the two families
    // must not collapse onto one path. If the fold ever leaks into these rows,
    // `$contains` gets back the case-insensitivity #4706 Q2 = A took away.
    const sqlite = await nativeSql({ name: { $contains: 'acme' } }, 'sqlite');
    expect(sqlite.sql).toContain('WHERE name GLOB $1');
    expect(sqlite.sql).not.toMatch(/lower\(/);
    expect(sqlite.params).toEqual(['*acme*']);
    const pg = await nativeSql({ name: { $contains: 'acme' } }, 'postgres');
    expect(pg.sql).toContain('WHERE name LIKE $1 ESCAPE $2');
    expect(pg.sql).not.toMatch(/translate\(/);
  });
});

describe('[#15780] the three compilers, EXECUTED on a real SQLite engine', () => {
  let db: any;
  let sqliteCtx: DatasetScopedStrategyContext;
  /** The same host with no dialect hook — the pre-#15780 compiler, still reachable. */
  let unawareCtx: DatasetScopedStrategyContext;

  const run = (sql: string, params: unknown[]): string[] => {
    const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
    stmt.bind(params as any[]);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
  };

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
    db = new SQL.Database();
    db.run(`CREATE TABLE "rows" ("id" TEXT PRIMARY KEY, "name" TEXT);`);
    const insert = db.prepare(`INSERT INTO "rows" ("id","name") VALUES (?,?)`);
    for (const r of FILTER_TEXT_ROWS) insert.run([r.id, r.name]);
    insert.free();

    const base = {
      getCube: (name: string) => (name === 'texts' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    };
    unawareCtx = { ...base } as DatasetScopedStrategyContext;
    sqliteCtx = { ...base, sqlDialect: () => 'sqlite' } as DatasetScopedStrategyContext;
  });

  afterAll(() => {
    db?.close();
  });

  const executedIds = async (where: unknown, ctx: DatasetScopedStrategyContext): Promise<string[]> => {
    const { sql, params } = await new NativeSQLStrategy().generateSql(query(where), ctx);
    return run(sql, params);
  };

  it('the engine has no translate(), and lower() there folds ASCII ONLY', () => {
    // The card's three measurements, re-executed here so the arms below rest on
    // this engine's answers rather than on a quoted table.
    expect(() => db.exec(`SELECT translate('ABC','ABC','abc')`)).toThrow(/no such function: translate/);
    expect(db.exec(`SELECT ('acme' GLOB 'ac*')`)[0].values[0][0]).toBe(1);
    expect(db.exec(`SELECT lower('CAFÉ')`)[0].values[0][0]).toBe('cafÉ');
  });

  it('the fixture is the shared nine rows, and $icontains is eight of the table\'s cases', () => {
    expect(run('SELECT "id" FROM "rows"', [])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(NAME_ICONTAINS.map((c) => c.name)).toEqual([
      '$icontains matches an upper-case row from a lower-case comparand',
      '$icontains matches a lower-case row from an upper-case comparand',
      'ASCII-only: a lower-case non-ASCII comparand does NOT match its upper-case row',
      'ASCII-only: an upper-case non-ASCII comparand does NOT match its lower-case row',
      '$icontains treats % as a literal character, not a LIKE wildcard',
      'icontains (the infix/view spelling, #8934) lowers to $icontains — % stays a LITERAL through that door too',
      '$icontains treats _ as a literal character, not a single-character wildcard',
      '$icontains treats . as a literal character, not a regex metacharacter',
    ]);
  });

  it('[#16028] the PRE-fix bytes are still refused by this engine — the control the greens rest on', () => {
    // Before-red, kept as a control rather than deleted with the defect. This
    // is the statement the `unknown` arm emitted until #16028, rebuilt here and
    // handed to the engine: it does not parse. Every green below is therefore a
    // measurement of the CHANGE, not of an engine that would have accepted
    // anything.
    const preFix =
      `SELECT "id" FROM "rows" WHERE ${TRANSLATE_FOLD} LIKE ` +
      `translate(?, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') ESCAPE ?`;
    expect(() => run(preFix, ['%acme%', '\\'])).toThrow(/no such function: translate/);
  });

  it('[#16028] a host that answers NO dialect now compiles a statement this engine RUNS', async () => {
    // The card's headline, executed: with no `sqlDialect` hook wired — the
    // shape a directly-constructed public `AnalyticsService` has when its
    // OPTIONAL field is omitted — the compiled `where` used to be refused by
    // the engine. It now parses, and it answers the shared table's rows.
    const { sql, params } = await new NativeSQLStrategy().generateSql(
      query({ name: { $icontains: 'acme' } }),
      unawareCtx,
    );
    expect(sql).not.toMatch(/translate\(/);
    expect(run(sql, params)).toEqual(['1', '2']);
  });

  it('[#16028] the `unknown` arm answers the shared $icontains table — all three compilers', async () => {
    // The same rows the `sqlite` arm is required to answer, required of the
    // residue arm. Executed on sql.js 1.14.1, the engine `driver-sqlite-wasm`
    // runs — which is what an `unknown` dialect that is really SQLite IS.
    for (const c of NAME_ICONTAINS) {
      expect(await executedIds(c.filter, unawareCtx), c.name).toEqual([...c.expected]);

      const scoped = {
        ...unawareCtx,
        getReadScope: (object: string) => (object === 'rows' ? (c.filter as FilterCondition) : null),
      } as DatasetScopedStrategyContext;
      const viaScope = await new NativeSQLStrategy().generateSql(query(undefined), scoped);
      expect(viaScope.sql, `read scope: ${c.name}`).not.toMatch(/translate\(/);
      expect(run(viaScope.sql, viaScope.params), `read scope: ${c.name}`).toEqual([...c.expected]);

      const echo = await new ObjectQLStrategy().generateSql(query(c.filter), unawareCtx);
      expect(echo.sql, `echo: ${c.name}`).not.toMatch(/translate\(/);
      expect(run(echo.sql, echo.params), `echo: ${c.name}`).toEqual([...c.expected]);
    }
  });

  it('[#16028] the portable chain folds ASCII and NOTHING else — every code point, executed', () => {
    // The property the arm rests on, measured instead of argued, because the
    // one thing that must never happen here is a fold that reaches past `A`-`Z`
    // (#4706 Q1 = A). Two halves:
    //
    //   1. the chain equals the simultaneous `A`-`Z` map — i.e. applying the 26
    //      REPLACEs IN SEQUENCE cannot cascade, because every step writes a
    //      lower-case letter and every later step matches an upper-case one;
    //   2. it touches nothing else — no accented letter, and none of the LIKE
    //      metacharacters the escaping depends on staying literal.
    const asciiLower = (v: string) =>
      v.replace(/[A-Z]/g, (ch) => ASCII_LO[ASCII_UP.indexOf(ch)]);
    const probes = [
      ...Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).filter((ch) => ch !== '\0'),
      'CAFÉ', 'café', 'ÀÉÎÕÜ', 'ÄÖÜ', 'ǍǏǑ', 'ΑΒΓ', 'АБВ', 'İIı',
      'ACME Corp', '100% match', 'a_b', 'A\\B', 'ZzAa',
    ];
    for (const probe of probes) {
      const literal = probe.replace(/'/g, "''");
      const got = db.exec(`SELECT ${replaceFold(`'${literal}'`)}`)[0].values[0][0];
      expect(got, JSON.stringify(probe)).toBe(asciiLower(probe));
    }
    // ⚠️ And the control that says why `LOWER()` may not be adopted here even
    // though it passes on THIS engine: SQLite's `lower()` is ASCII-only, so it
    // agrees with the chain on every probe above. It is PostgreSQL's, which is
    // collation-aware, that would fold `É` — and no PostgreSQL server is
    // provisionable in this container. So this cell is why the arm is chosen by
    // CONSTRUCTION and not by what happens to pass locally.
    expect(db.exec(`SELECT lower('CAFÉ')`)[0].values[0][0]).toBe('cafÉ');
  });

  it('NativeSQLStrategy answers the shared table\'s $icontains rows', async () => {
    for (const c of NAME_ICONTAINS) {
      expect(await executedIds(c.filter, sqliteCtx), c.name).toEqual([...c.expected]);
    }
  });

  it('the READ SCOPE answers them too — the compiler where a wrong row set is over-reach', async () => {
    for (const c of NAME_ICONTAINS) {
      const scoped = {
        ...sqliteCtx,
        getReadScope: (object: string) => (object === 'rows' ? (c.filter as FilterCondition) : null),
      } as DatasetScopedStrategyContext;
      const { sql, params } = await new NativeSQLStrategy().generateSql(query(undefined), scoped);
      expect(sql, c.name).toMatch(/GLOB/);
      expect(sql, c.name).not.toMatch(/translate\(/);
      expect(run(sql, params), c.name).toEqual([...c.expected]);
    }
  });

  it('the ObjectQL echo prints the statement the native compiler runs', async () => {
    for (const c of NAME_ICONTAINS) {
      const echo = await new ObjectQLStrategy().generateSql(query(c.filter), sqliteCtx);
      const native = await new NativeSQLStrategy().generateSql(query(c.filter), sqliteCtx);
      expect(echo.sql, c.name).toMatch(/GLOB/);
      expect(echo.sql, c.name).not.toMatch(/translate\(/);
      expect(echo.params, c.name).toEqual(native.params);
      expect(run(echo.sql, echo.params), `echo of ${c.name}`).toEqual([...c.expected]);
    }
  });
});

/**
 * The anti-drift pin: this package's construct table against the DRIVER's, run
 * rather than compared — #15684's mechanism, extended to the fold row.
 */
describe('[#15780] this package and driver-sql answer the shared $icontains rows alike on SQLite', () => {
  let driver: SqliteWasmDriver;
  const BYPASS: DriverOptions = { bypassTenantAudit: true };

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: 'txt', fields: { name: { type: 'string' }, score: { type: 'number' } } }]);
    for (const row of FILTER_TEXT_ROWS) await driver.create('txt', { ...row }, BYPASS);
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it('every $icontains row: same ids from the driver and from this package\'s compilers', async () => {
    for (const c of NAME_ICONTAINS) {
      const rows = await driver.find('txt', { where: c.filter as FilterCondition }, BYPASS);
      const driverIds = rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
      expect(driverIds, `driver: ${c.name}`).toEqual([...c.expected]);
    }
  });
});
