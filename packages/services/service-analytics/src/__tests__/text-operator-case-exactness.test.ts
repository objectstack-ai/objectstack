// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15684] The case-EXACT text family on this package's three SQL compilers —
 * `NativeSQLStrategy.buildFilterClause` (the query's own `where`),
 * `compileScopedFilterToSql` (`read-scope-sql.ts`, the ADR-0021 D-C read scope)
 * and the `ObjectQLStrategy` echo of that statement.
 *
 * ## The contract, and the defect
 *
 * `FILTER_TEXT_CASES` (#4706 Q2 = A): `$contains` / `$notContains` /
 * `$startsWith` / `$endsWith` are case-SENSITIVE on every backend. All three
 * compilers emitted `col LIKE ? ESCAPE ?` on every dialect, and SQLite's `LIKE`
 * folds ASCII case unconditionally. Measured on sql.js over the shared
 * `FILTER_TEXT_ROWS` fixture before the fix, and asserted here as the control
 * that keeps this suite honest (`the defect, still reachable…` below):
 * `{ name: { $contains: 'acme' } }` answered `['1','2']` — `ACME Corp` AND
 * `acme corp` — where the table says `['2']`.
 *
 * Two of the three make that a wrong chart. The third is a READ SCOPE, where a
 * predicate that ADMITS rows the policy excludes is over-reach (#3948), not a
 * loose filter — the reading `read-scope-sql.ts` already applies to its own
 * LIKE escaping (#5567), applied to its keyword.
 *
 * ## Why the pins are per DIALECT
 *
 * No construct is case-exact AND parseable on all three dialects
 * (`text-match-sql.ts`'s header carries the four measured dead ends), so the
 * dialect is an input — `DatasetScopedStrategyContext.sqlDialect`, answered by
 * the driver that will execute the statement. Three cells are therefore pinned
 * differently, and the difference is stated rather than blurred:
 *
 *   - **sqlite → EXECUTED.** Every assertion below that names row ids ran on
 *     sql.js, the same engine `driver-sqlite-wasm` uses.
 *   - **postgres / no hook → byte-identical text.** `LIKE` is already
 *     case-exact on Postgres, so the pin is that this PR changed nothing there:
 *     the emitted SQL and its params are asserted verbatim against the
 *     pre-#15684 shape.
 *   - **mysql → NOT MEASURED.** The `CAST(… AS BINARY)` arm is asserted as
 *     TEXT only. No MySQL server is provisionable in this container — the same
 *     declared skip `driver-sql`'s own #6518 suite records, not a claimed pass.
 *
 * ## What holds this package's construct table to `driver-sql`'s
 *
 * `service-analytics` depends on no driver, so `textMatchPredicate` cannot be
 * imported (and is module-private, returning knex bindings, besides). The
 * anti-drift mechanism is therefore the one `like-pattern.ts` already uses for
 * the escaping half: the last describe below runs the SAME `FILTER_TEXT_CASES`
 * rows through a real `SqliteWasmDriver` — a devDependency, never a runtime one
 * — on the same engine, and requires the same row sets from both. A third
 * hand-copy of the table anywhere is the thing to refuse.
 *
 * ## What is deliberately NOT changed
 *
 * `$icontains` (#6520) keeps its own construct on every dialect: it folds BOTH
 * sides through `asciiLowerSqlExpr`, and the assertions below pin that the
 * emitted text is untouched by the dialect. That fold is `translate()`, which
 * SQLite does not have — so those statements are pinned as TEXT and are NOT
 * executed here; that is a separate defect, not this card's, and it is filed.
 * Escaping (#5567) is likewise unchanged for every `LIKE` arm; the GLOB arm
 * brings its OWN escaped character class (`*`, `?`, `[`), which is why the
 * second fixture below exists.
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
import { escapeGlobPattern, globPattern, normalizeSqlDialect } from '../text-match-sql.js';

/** The four operators #4706 Q2 = A rules case-SENSITIVE. */
const CASE_EXACT_OPS = new Set(['$contains', '$notContains', '$startsWith', '$endsWith']);

/**
 * The shared table's rows that aim a case-EXACT operator at the TEXT column.
 *
 * Taken from `FILTER_TEXT_CASES` rather than restated, so this suite answers the
 * same standard the five drivers answer. The count is asserted below: a row
 * added to the family upstream must reach this face too, not silently widen the
 * filter here.
 */
const NAME_CASE_EXACT = FILTER_TEXT_CASES.filter(
  (c): c is Extract<typeof c, { expected: readonly string[] }> => {
    if (c.expectRejection === true) return false;
    const entries = Object.entries(c.filter as Record<string, unknown>);
    if (entries.length !== 1) return false;
    const [field, predicate] = entries[0];
    if (field !== 'name' || typeof predicate !== 'object' || predicate === null) return false;
    const op = Object.keys(predicate as Record<string, unknown>)[0];
    return CASE_EXACT_OPS.has(op);
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

/** A second cube over the GLOB-metacharacter fixture — see `GLOB_ROWS`. */
const GLOB_CUBE: Cube = {
  ...(CUBE as unknown as Record<string, unknown>),
  name: 'globs',
  sql: 'globrows',
} as unknown as Cube;

/**
 * The GLOB metacharacters, each paired with a decoy that differs from it by
 * exactly that character's wildcard reading — the same discipline
 * `FILTER_TEXT_ROWS` applies to `%` and `_`.
 *
 * `FILTER_TEXT_ROWS` cannot carry these: `*`, `?` and `[` are ordinary
 * characters to `LIKE`, so they are meaningless on four of the five drivers
 * that answer that table. They become live the moment a compiler emits `GLOB`,
 * and an unescaped `*` is the same filter bypass an unescaped `%` is under LIKE
 * (#5567) — on a read scope, over-reach.
 */
const GLOB_ROWS = [
  { id: 'g1', name: 'a*b' },
  { id: 'g2', name: 'a?b' },
  { id: 'g3', name: 'a[b' },
  { id: 'g4', name: 'axb' },
  { id: 'g5', name: 'aXb' },
  { id: 'g6', name: 'ab' },
];

const query = (where: unknown, cube = 'texts'): AnalyticsQuery =>
  ({ cube, measures: ['total'], dimensions: ['id'], timezone: 'UTC', where }) as AnalyticsQuery;

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

describe('[#15684] the per-dialect construct table', () => {
  it('normalises exactly the three dialects it has arms for; everything else is `unknown`', () => {
    for (const d of ['sqlite', 'postgres', 'mysql']) expect(normalizeSqlDialect(d), d).toBe(d);
    // "Cannot answer, do not block": an unmodelled name must not pick an arm.
    for (const d of ['mssql', 'oracle', 'unknown', 'SQLite', '']) {
      expect(normalizeSqlDialect(d), d).toBe('unknown');
    }
    expect(normalizeSqlDialect(undefined)).toBe('unknown');
    expect(normalizeSqlDialect(null)).toBe('unknown');
  });

  it('escapes the GLOB metacharacters, and ONLY those — the LIKE class is a different one', () => {
    // Character for character `driver-sql`'s `escapeGlobComparand`. `]` gets no
    // escape on purpose: every `[` becomes a class that closes itself.
    expect(escapeGlobPattern('a*b')).toBe('a[*]b');
    expect(escapeGlobPattern('a?b')).toBe('a[?]b');
    expect(escapeGlobPattern('a[b')).toBe('a[[]b');
    expect(escapeGlobPattern('a]b')).toBe('a]b');
    // `%`, `_` and `\` are ORDINARY to GLOB — escaping them here would search
    // for a backslash that is not in the data.
    expect(escapeGlobPattern('100%')).toBe('100%');
    expect(escapeGlobPattern('a_b')).toBe('a_b');
    expect(escapeGlobPattern('a\\b')).toBe('a\\b');
    expect(globPattern('contains', 'a*b')).toBe('*a[*]b*');
    expect(globPattern('starts', 'a*b')).toBe('a[*]b*');
    expect(globPattern('ends', 'a*b')).toBe('*a[*]b');
  });
});

describe('[#15684] the compiled TEXT, per dialect', () => {
  const ctxFor = (dialect?: string): DatasetScopedStrategyContext =>
    ({
      getCube: (name: string) => (name === 'texts' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      ...(dialect ? { sqlDialect: () => dialect } : {}),
    }) as DatasetScopedStrategyContext;

  const nativeSql = async (where: unknown, dialect?: string) =>
    new NativeSQLStrategy().generateSql(query(where), ctxFor(dialect));

  it('postgres, and a host that wired NO hook, keep the pre-#15684 bytes exactly', async () => {
    // The non-regression half. `LIKE` is already case-exact on Postgres, so the
    // correct diff there is no diff at all — asserted verbatim, not by shape.
    for (const dialect of [undefined, 'postgres'] as const) {
      const out = await nativeSql({ name: { $contains: 'acme' } }, dialect);
      expect(out.sql, String(dialect)).toContain('WHERE name LIKE $1 ESCAPE $2');
      expect(out.params, String(dialect)).toEqual(['%acme%', '\\']);
    }
    const scope = compileScopedFilterToSql({ name: { $contains: 'acme' } } as FilterCondition, 't');
    expect(scope).toEqual({ sql: '"t"."name" LIKE ? ESCAPE ?', params: ['%acme%', '\\'] });
    expect(
      compileScopedFilterToSql({ name: { $contains: 'acme' } } as FilterCondition, 't', { dialect: 'postgres' }),
    ).toEqual({ sql: '"t"."name" LIKE ? ESCAPE ?', params: ['%acme%', '\\'] });
  });

  it('sqlite compiles GLOB — one bound value, no ESCAPE clause', async () => {
    const out = await nativeSql({ name: { $contains: 'acme' } }, 'sqlite');
    expect(out.sql).toContain('WHERE name GLOB $1');
    expect(out.sql).not.toMatch(/ESCAPE/);
    expect(out.params).toEqual(['*acme*']);
    expect(compileScopedFilterToSql({ name: { $contains: 'acme' } } as FilterCondition, 't', { dialect: 'sqlite' }))
      .toEqual({ sql: '"t"."name" GLOB ?', params: ['*acme*'] });
    // `$notContains` keeps the read scope's NULL-safe wrapper around the
    // negated construct — the polarity moved, the #5298 rule did not.
    expect(compileScopedFilterToSql({ name: { $notContains: 'acme' } } as FilterCondition, 't', { dialect: 'sqlite' }))
      .toEqual({ sql: '("t"."name" IS NULL OR "t"."name" NOT GLOB ?)', params: ['*acme*'] });
    const starts = await nativeSql({ name: { $startsWith: 'ACME' } }, 'sqlite');
    expect(starts.params).toEqual(['ACME*']);
    const ends = await nativeSql({ name: { $endsWith: 'corp' } }, 'sqlite');
    expect(ends.params).toEqual(['*corp']);
  });

  it('mysql compiles LIKE over CAST(… AS BINARY) — TEXT ONLY, NOT MEASURED on a server', async () => {
    const out = await nativeSql({ name: { $contains: 'acme' } }, 'mysql');
    expect(out.sql).toContain('WHERE CAST(name AS BINARY) LIKE CAST($1 AS BINARY) ESCAPE $2');
    expect(out.params).toEqual(['%acme%', '\\']);
    expect(compileScopedFilterToSql({ name: { $contains: 'acme' } } as FilterCondition, 't', { dialect: 'mysql' }))
      .toEqual({ sql: 'CAST("t"."name" AS BINARY) LIKE CAST(? AS BINARY) ESCAPE ?', params: ['%acme%', '\\'] });
  });

  it('$icontains is untouched by the dialect — the fold arm still emits translate() on both sides', async () => {
    // The control that must stay green. #6520's construct is case-INSENSITIVE
    // by ruling, so it never wants the case-exact table; if a future edit routes
    // it through `text-match-sql.ts`, the `$contains` family gets back the fold
    // #4706 Q2 = A took away from it and this line reds first.
    for (const dialect of [undefined, 'sqlite', 'postgres', 'mysql'] as const) {
      const out = await nativeSql({ name: { $icontains: 'acme' } }, dialect);
      expect(out.sql, String(dialect)).toContain(
        "WHERE translate(name, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') LIKE translate($1,",
      );
      expect(out.sql, String(dialect)).toContain('ESCAPE $2');
      expect(out.params, String(dialect)).toEqual(['%acme%', '\\']);
    }
    expect(
      compileScopedFilterToSql({ name: { $icontains: 'acme' } } as FilterCondition, 't', { dialect: 'sqlite' }).params,
    ).toEqual(['%acme%', '\\']);
  });
});

describe('[#15684] the three compilers, EXECUTED on a real SQLite engine', () => {
  let db: any;
  /** The host that answers the dialect — what the plugin wires from the driver. */
  let sqliteCtx: DatasetScopedStrategyContext;
  /** The same host with no dialect hook: the pre-#15684 compiler, still reachable. */
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
    db.run(`CREATE TABLE "globrows" ("id" TEXT PRIMARY KEY, "name" TEXT);`);
    const gi = db.prepare(`INSERT INTO "globrows" ("id","name") VALUES (?,?)`);
    for (const r of GLOB_ROWS) gi.run([r.id, r.name]);
    gi.free();

    const base = {
      getCube: (name: string) => (name === 'texts' ? CUBE : name === 'globs' ? GLOB_CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    };
    unawareCtx = { ...base } as DatasetScopedStrategyContext;
    sqliteCtx = { ...base, sqlDialect: () => 'sqlite' } as DatasetScopedStrategyContext;
  });

  afterAll(() => {
    db?.close();
  });

  const executedIds = async (where: unknown, ctx: DatasetScopedStrategyContext, cube = 'texts'): Promise<string[]> => {
    const { sql, params } = await new NativeSQLStrategy().generateSql(query(where, cube), ctx);
    return run(sql, params);
  };

  it('the fixture is the shared nine rows, and the case-exact family is six of the table\'s cases', () => {
    expect(run('SELECT "id" FROM "rows"', [])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(NAME_CASE_EXACT.map((c) => c.name)).toEqual([
      '$contains treats _ as a literal character too',
      '$contains is case-SENSITIVE — a lower-case comparand misses the upper-case row',
      '$contains is case-SENSITIVE — an upper-case comparand misses the lower-case row',
      '$startsWith is case-SENSITIVE',
      '$endsWith is case-SENSITIVE',
      '$notContains is case-SENSITIVE, and negation does not widen it',
    ]);
  });

  it('NativeSQLStrategy answers the shared table\'s case-exact rows', async () => {
    for (const c of NAME_CASE_EXACT) {
      expect(await executedIds(c.filter, sqliteCtx), c.name).toEqual([...c.expected]);
    }
  });

  it('the READ SCOPE answers them too — the compiler where a wrong row set is over-reach', async () => {
    for (const c of NAME_CASE_EXACT) {
      const scoped = {
        ...sqliteCtx,
        getReadScope: (object: string) => (object === 'rows' ? (c.filter as FilterCondition) : null),
      } as DatasetScopedStrategyContext;
      const { sql, params } = await new NativeSQLStrategy().generateSql(query(undefined), scoped);
      expect(sql, c.name).toMatch(/GLOB/);
      expect(run(sql, params), c.name).toEqual([...c.expected]);
    }
  });

  it('the ObjectQL echo prints the statement the native compiler runs', async () => {
    for (const c of NAME_CASE_EXACT) {
      const echoCtx = {
        getCube: sqliteCtx.getCube,
        queryCapabilities: sqliteCtx.queryCapabilities,
        sqlDialect: () => 'sqlite',
      } as DatasetScopedStrategyContext;
      const echo = await new ObjectQLStrategy().generateSql(query(c.filter), echoCtx);
      const native = await new NativeSQLStrategy().generateSql(query(c.filter), sqliteCtx);
      expect(echo.sql, c.name).toMatch(/GLOB/);
      expect(echo.sql, c.name).not.toMatch(/ LIKE /);
      // Same predicate, same bound pattern: an echo that prints LIKE while the
      // engine runs GLOB is the #5333 failure this render block exists to stop.
      expect(echo.params, c.name).toEqual(native.params);
      expect(run(echo.sql, echo.params), `echo of ${c.name}`).toEqual([...c.expected]);
    }
  });

  it('the defect, still reachable through a host that answers no dialect — so these pins discriminate', async () => {
    // Before-red, stated as the wrong answer rather than argued: the same query,
    // the same engine, the pre-#15684 compiler.
    expect(await executedIds({ name: { $contains: 'acme' } }, unawareCtx)).toEqual(['1', '2']);
    expect(await executedIds({ name: { $startsWith: 'ACME' } }, unawareCtx)).toEqual(['1', '2']);
    expect(await executedIds({ name: { $endsWith: 'corp' } }, unawareCtx)).toEqual(['1', '2']);
    expect(await executedIds({ name: { $notContains: 'acme' } }, unawareCtx)).toEqual(['3', '4', '5', '6', '7', '8', '9']);
    // …and the same four, case-exact, once the dialect is answered.
    expect(await executedIds({ name: { $contains: 'acme' } }, sqliteCtx)).toEqual(['2']);
    expect(await executedIds({ name: { $startsWith: 'ACME' } }, sqliteCtx)).toEqual(['1']);
    expect(await executedIds({ name: { $endsWith: 'corp' } }, sqliteCtx)).toEqual(['2']);
  });

  it('the LIKE metacharacters stay LITERAL under GLOB — where they are ordinary characters', async () => {
    // #5567's rows, re-run on the new construct. `%` and `_` are not GLOB
    // wildcards, so the escaping that matters here is the absence of the LIKE
    // one: escaping them would search for a backslash that is not in the data.
    expect(await executedIds({ name: { $contains: '100%' } }, sqliteCtx)).toEqual(['5']);
    expect(await executedIds({ name: { $contains: 'a_b' } }, sqliteCtx)).toEqual(['7']);
    expect(await executedIds({ name: { $contains: 'a.b' } }, sqliteCtx)).toEqual(['9']);
    expect(await executedIds({ name: { $endsWith: '% match' } }, sqliteCtx)).toEqual(['5']);
  });

  it('the GLOB metacharacters are escaped — an unescaped `*` is the same bypass an unescaped `%` is', async () => {
    expect(await executedIds({}, sqliteCtx, 'globs')).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'g6']);
    // Unescaped, `*a*b*` matches all six; `*a?b*` matches five; `*a[b*` is an
    // unclosed class. Each exact set is therefore a real discrimination.
    expect(await executedIds({ name: { $contains: 'a*b' } }, sqliteCtx, 'globs')).toEqual(['g1']);
    expect(await executedIds({ name: { $contains: 'a?b' } }, sqliteCtx, 'globs')).toEqual(['g2']);
    expect(await executedIds({ name: { $contains: 'a[b' } }, sqliteCtx, 'globs')).toEqual(['g3']);
    expect(await executedIds({ name: { $startsWith: 'a*' } }, sqliteCtx, 'globs')).toEqual(['g1']);
    expect(await executedIds({ name: { $endsWith: '*b' } }, sqliteCtx, 'globs')).toEqual(['g1']);
    // …and case exactness holds on this fixture too.
    expect(await executedIds({ name: { $contains: 'axb' } }, sqliteCtx, 'globs')).toEqual(['g4']);
    expect(await executedIds({ name: { $notContains: 'axb' } }, sqliteCtx, 'globs')).toEqual(['g1', 'g2', 'g3', 'g5', 'g6']);
  });
});

/**
 * The anti-drift pin: this package's construct table against the DRIVER's, run
 * rather than compared.
 *
 * `driver-sqlite-wasm` inherits `driver-sql`'s compiler, so its answers are
 * `textMatchPredicate`'s answers on the engine this container can run. Both
 * faces are handed the same table and must return the same rows — which is what
 * makes "the same construct table, re-emitted through this package's
 * placeholder plumbing" a checkable claim rather than a comment.
 */
describe('[#15684] this package and driver-sql answer the shared table alike on SQLite', () => {
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

  it('every case-exact row: same ids from the driver and from this package\'s compilers', async () => {
    for (const c of NAME_CASE_EXACT) {
      const rows = await driver.find('txt', { where: c.filter as FilterCondition }, BYPASS);
      const driverIds = rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
      expect(driverIds, `driver: ${c.name}`).toEqual([...c.expected]);
    }
  });
});
