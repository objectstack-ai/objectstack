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
 *   - **`unknown` (no hook wired) → byte-identical text, ALSO `translate()`.**
 *     The residue keeps the shape it has always had. It is not an endorsement:
 *     it is what still runs on the dialects nothing here models (mssql, oracle,
 *     which do have `translate()`), and falling back to `LOWER()` for it would
 *     silently restore the Unicode fold #4706 Q1 = A took away. Note this
 *     DIVERGES from `driver-sql`'s `unknown` arm, which folds with `LOWER()` —
 *     each side keeps its own pre-existing residue, and neither claims the
 *     other's.
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

describe('[#15780] the compiled TEXT, per dialect — all three compilers', () => {
  const nativeSql = async (where: unknown, dialect?: string) =>
    new NativeSQLStrategy().generateSql(query(where), ctxFor(dialect));
  const echoSql = async (where: unknown, dialect?: string) =>
    new ObjectQLStrategy().generateSql(query(where), ctxFor(dialect));

  it('postgres and a host that wired NO hook keep the pre-#15780 bytes exactly', async () => {
    // The non-regression half, for the two dialects that were already correct.
    // Asserted verbatim, not by shape: `translate()` is right on Postgres, and
    // the `unknown` residue must keep the only fold that still runs there.
    for (const dialect of [undefined, 'postgres'] as const) {
      const out = await nativeSql({ name: { $icontains: 'acme' } }, dialect);
      expect(out.sql, String(dialect)).toContain(
        `WHERE ${TRANSLATE_FOLD} LIKE translate($1, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') ESCAPE $2`,
      );
      expect(out.params, String(dialect)).toEqual(['%acme%', '\\']);

      const echo = await echoSql({ name: { $icontains: 'acme' } }, dialect);
      expect(echo.sql, `echo ${String(dialect)}`).toContain(
        `${TRANSLATE_FOLD} LIKE translate($1, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') ESCAPE $2`,
      );
      expect(echo.params, `echo ${String(dialect)}`).toEqual(['%acme%', '\\']);
    }

    const noHook = compileScopedFilterToSql({ name: { $icontains: 'acme' } } as FilterCondition, 't');
    expect(noHook).toEqual({
      sql:
        `translate("t"."name", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') LIKE ` +
        `translate(?, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') ESCAPE ?`,
      params: ['%acme%', '\\'],
    });
    expect(
      compileScopedFilterToSql({ name: { $icontains: 'acme' } } as FilterCondition, 't', { dialect: 'postgres' }),
    ).toEqual(noHook);
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

  it('the defect, still reachable through a host that answers no dialect — so these pins discriminate', async () => {
    // Before-red, stated as the engine's own refusal rather than argued: the
    // `unknown` residue still emits `translate()`, and this engine cannot parse
    // it. This is the control that keeps every green assertion above honest.
    const { sql, params } = await new NativeSQLStrategy().generateSql(
      query({ name: { $icontains: 'acme' } }),
      unawareCtx,
    );
    expect(sql).toContain('translate(');
    expect(() => run(sql, params)).toThrow(/no such function: translate/);
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
