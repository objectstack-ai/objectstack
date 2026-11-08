// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31394] The text operators on SQL Server and Oracle, through this package's
 * three SQL compilers — `NativeSQLStrategy` (the dashboard's own `where`),
 * `compileScopedFilterToSql` (the ADR-0021 D-C read scope) and the
 * `ObjectQLStrategy` echo — held to what `driver-sql` emits for the SAME
 * filter on the SAME dialect.
 *
 * ## The defect
 *
 * `driver-sql` keeps #6518's text-match contract on SQL Server (#31327): the
 * case-EXACT four compare under a `_BIN2` collation, `$icontains` folds the 26
 * ASCII letters with `TRANSLATE` and nothing else, and `[` — a fourth LIKE
 * metacharacter there — is escaped. This package's compilers did not know the
 * dialect: the plugin's bridge narrowed the driver's `'mssql'` to "no answer",
 * so every one of them emitted the residue arm's plain `LIKE`, which on SQL
 * Server's default case-INSENSITIVE collations folds case for the case-exact
 * four, folds beyond ASCII for `$icontains`, and reads `[` as a character
 * class. A dashboard's text filter over a federated SQL Server object answered
 * different rows from the same filter on a list view.
 *
 * Measured before the fix, compile-level (no SQL Server is provisionable in the
 * container that wrote this): the bridge answered `undefined` for a driver
 * whose `dialectName` is `'mssql'`, and `{ name: { $contains: 'a[b' } }`
 * compiled to `name LIKE $1 ESCAPE $2` with `'%a[b%'`, where the driver emits
 * `CAST([name] AS nvarchar(max)) COLLATE Latin1_General_100_BIN2 LIKE CAST(@p0
 * AS nvarchar(max)) COLLATE Latin1_General_100_BIN2 ESCAPE @p1` with
 * `'%a\[b%'`.
 *
 * ## Why the expectation is the driver's own output
 *
 * The construct table now lives once, in `@objectstack/core`
 * (`text-match-sql.ts`), and both faces emit through it. The expected text
 * here is therefore not restated: it is read off a real `SqlDriver`'s compiled
 * statement (knex builds `mssql` and `oracledb` offline), with only the two
 * things that legitimately differ between the faces normalised away — how the
 * column is quoted and how a placeholder is spelled. A face that drifts from
 * the driver in anything else turns red here.
 *
 * ## Oracle: measured consistent, left on its arm
 *
 * The plugin's bridge narrows the driver's `'oracle'` to "no answer" too, so
 * this package compiles Oracle through the residue arm. Measured against the
 * driver: the case-EXACT four emit the driver's construct exactly (`LIKE`, the
 * same escaped pattern, the same bound `ESCAPE`), and `LIKE` is byte-wise on
 * every Oracle session the driver opens (`NLS_COMP = BINARY`), which is the
 * session this package's raw SQL runs on. `$icontains` differs in bytes only:
 * the residue's nested `REPLACE` chain where the driver writes `translate()`,
 * and the two fold exactly the same 26 letters (`icontains-dialect-sql.test.ts`
 * executes the chain over every ASCII code point). So Oracle answers the
 * driver's rows already, and its arm is left as it is; the pins below hold
 * both halves of that reading.
 *
 * ## Live cells
 *
 * With `OS_TEST_MSSQL_URL` / `OS_TEST_ORACLE_URL` set, the shared
 * `FILTER_TEXT_CASES` run through the driver face AND the native-SQL face on
 * the live server, over a table created with the database's default collation,
 * and both must answer the table's rows. Without the URL each cell is a named
 * skip, never a claimed pass.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import { FILTER_TEXT_CASES, FILTER_TEXT_ROWS, lowerFilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from '@objectstack/driver-sql';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { asAcceptedSqlDialect } from '../text-match-sql.js';
import type { DatasetScopedStrategyContext } from '../strategies/types.js';

/** A driver that answers the WHERE clause its own filter compiler builds. */
class CompilerProbe extends SqlDriver {
  compileWhere(where: FilterCondition): { sql: string; bindings: unknown[] } {
    const builder = this.getKnex()('t');
    this.applyFilters(builder, where);
    const native = builder.toSQL().toNative();
    return { sql: native.sql, bindings: [...native.bindings] };
  }
}

/** A federated text table `t` on `client`; knex never dials until a statement runs. */
function probeFor(client: 'mssql' | 'oracledb'): CompilerProbe {
  const connection =
    client === 'mssql' ? {} : { user: 'nobody', password: 'unused', connectString: '127.0.0.1:1/NONE' };
  const d = new CompilerProbe({ client, connection, schemaMode: 'external' } as never);
  d.registerExternalObject({
    name: 't',
    fields: { name: { type: 'text' } },
    external: { remoteName: 't' },
  } as never);
  return d;
}

const CUBE = {
  name: 'texts',
  title: 'Texts',
  sql: 't',
  measures: { total: { label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    id: { label: 'Id', type: 'string', sql: 'id' },
    name: { label: 'Name', type: 'string', sql: 'name' },
  },
  public: true,
} as unknown as Cube;

const query = (where: unknown): AnalyticsQuery =>
  ({ cube: 'texts', measures: ['total'], dimensions: ['id'], timezone: 'UTC', where }) as AnalyticsQuery;

/**
 * The context the plugin builds, with its dialect hook answering through the
 * bridge's own expression: the driver's `dialectName`, narrowed by
 * `asAcceptedSqlDialect` (`plugin.ts`).
 */
const ctxFor = (driver: SqlDriver): DatasetScopedStrategyContext =>
  ({
    getCube: (name: string) => (name === 'texts' ? CUBE : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    sqlDialect: () => asAcceptedSqlDialect((driver as unknown as { dialectName: string }).dialectName),
  }) as DatasetScopedStrategyContext;

/** Strip `$notContains`' NULL-safe wrapper (#5298), which each face spells in its own case. */
function unwrapNullSafe(predicate: string): string {
  const m = /^\(+COL is null or (.*?)\)+$/i.exec(predicate);
  return m ? m[1]! : predicate;
}

/** The driver's predicate, column `COL`, every placeholder `P`. */
function driverPredicate(sql: string, column: string, placeholder: RegExp): string {
  const where = sql.replace(/^select \* from \S+ where /, '');
  return unwrapNullSafe(where.split(column).join('COL').replace(placeholder, 'P'));
}

/** A face's predicate, column `COL`, every placeholder `P`. */
function facePredicate(where: string, column: string, placeholder: RegExp): string {
  return unwrapNullSafe(where.split(column).join('COL').replace(placeholder, 'P'));
}

/** The `WHERE` clause of a statement the native compiler or the echo builds. */
const whereOf = (sql: string): string => {
  const m = / WHERE (.*?) GROUP BY /.exec(sql);
  if (!m) throw new Error(`no WHERE … GROUP BY in: ${sql}`);
  return m[1]!;
};

const OPS = ['$contains', '$notContains', '$startsWith', '$endsWith', '$icontains'] as const;
const CASE_EXACT = new Set(['$contains', '$notContains', '$startsWith', '$endsWith']);
/** A cased comparand, the SQL Server class bracket, and the shared LIKE metacharacters. */
const COMPARANDS = ['Acme', 'a[b', '50%_\\x'] as const;

const DRIVER_SHAPE = {
  mssql: { column: '[name]', placeholder: /@p\d+/g },
  oracle: { column: '"name"', placeholder: /:\d+/g },
} as const;

describe('[#31394] SQL Server: the three compilers emit the driver\'s arm, compiled', () => {
  const driver = probeFor('mssql');
  const ctx = ctxFor(driver);

  it('the bridge hands the driver\'s `mssql` on, rather than narrowing it to "no answer"', () => {
    expect((driver as unknown as { dialectName: string }).dialectName).toBe('mssql');
    expect(asAcceptedSqlDialect('mssql')).toBe('mssql');
  });

  for (const op of OPS) {
    for (const value of COMPARANDS) {
      it(`${op} ${JSON.stringify(value)}: native where, read scope and echo all equal the driver`, async () => {
        const where = { name: { [op]: value } };
        const fromDriver = driver.compileWhere(where as FilterCondition);
        const expected = driverPredicate(fromDriver.sql, DRIVER_SHAPE.mssql.column, DRIVER_SHAPE.mssql.placeholder);
        // The arm, not the residue: a case-exact operator compares under the
        // binary collation, the fold is TRANSLATE over that rendering.
        expect(expected).toContain('COLLATE Latin1_General_100_BIN2');

        const native = await new NativeSQLStrategy().generateSql(query(where), ctx);
        expect(facePredicate(whereOf(native.sql), 'name', /\$\d+/g), 'native').toBe(expected);
        expect(native.params, 'native params').toEqual(fromDriver.bindings);

        const echo = await new ObjectQLStrategy().generateSql(query(where), ctx);
        expect(facePredicate(whereOf(echo.sql), 'name', /\$\d+/g), 'echo').toBe(expected);
        expect(echo.params, 'echo params').toEqual(fromDriver.bindings);

        const scope = compileScopedFilterToSql(where as FilterCondition, 't', { dialect: 'mssql' });
        expect(facePredicate(scope.sql, '"t"."name"', /\?/g), 'read scope').toBe(expected);
        expect(scope.params, 'read scope params').toEqual(fromDriver.bindings);
      });
    }
  }

  it('`[` is escaped on this dialect alone — the class bracket the shared escape does not know', async () => {
    const native = await new NativeSQLStrategy().generateSql(query({ name: { $contains: 'a[b' } }), ctx);
    expect(native.params).toEqual(['%a\\[b%', '\\']);
    const pg = await new NativeSQLStrategy().generateSql(
      query({ name: { $contains: 'a[b' } }),
      { ...ctx, sqlDialect: () => 'postgres' } as DatasetScopedStrategyContext,
    );
    expect(pg.params).toEqual(['%a[b%', '\\']);
  });
});

describe('[#31394] Oracle: measured consistent with the driver, and left on its arm', () => {
  const driver = probeFor('oracledb');
  const ctx = ctxFor(driver);

  it('the bridge still reads the driver\'s `oracle` as "no answer" — the residue arm', () => {
    expect((driver as unknown as { dialectName: string }).dialectName).toBe('oracle');
    expect(asAcceptedSqlDialect('oracle')).toBeUndefined();
  });

  for (const op of OPS) {
    for (const value of COMPARANDS) {
      it(`${op} ${JSON.stringify(value)}: the native where is the driver's construct${CASE_EXACT.has(op) ? '' : ' in a different fold spelling'}`, async () => {
        const where = { name: { [op]: value } };
        const fromDriver = driver.compileWhere(where as FilterCondition);
        const expected = driverPredicate(fromDriver.sql, DRIVER_SHAPE.oracle.column, DRIVER_SHAPE.oracle.placeholder);
        const native = await new NativeSQLStrategy().generateSql(query(where), ctx);
        const got = facePredicate(whereOf(native.sql), 'name', /\$\d+/g);
        expect(native.params, 'params').toEqual(fromDriver.bindings);
        if (CASE_EXACT.has(op)) {
          expect(got).toBe(expected);
          return;
        }
        // `$icontains`: the driver folds with `translate()`, the residue with
        // the nested REPLACE chain; same 26 letters, same LIKE, same ESCAPE.
        const replaceFold = (expr: string): string => {
          let out = expr;
          for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') out = `REPLACE(${out}, '${ch}', '${ch.toLowerCase()}')`;
          return out;
        };
        const translateFold = (expr: string): string =>
          `translate(${expr}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`;
        expect(expected).toBe(`${translateFold('COL')} LIKE ${translateFold('P')} ESCAPE P`);
        expect(got).toBe(`${replaceFold('COL')} LIKE ${replaceFold('P')} ESCAPE P`);
      });
    }
  }
});

// ── Live cells ──────────────────────────────────────────────────────────────

/** The shared table's rows that aim one text operator at the TEXT column. */
const NAME_TEXT_CASES = FILTER_TEXT_CASES.filter(
  (c): c is Extract<typeof c, { expected: readonly string[] }> => {
    if (c.expectRejection === true) return false;
    const entries = Object.entries(c.filter as Record<string, unknown>);
    if (entries.length !== 1) return false;
    const [field, predicate] = entries[0]!;
    if (field !== 'name' || typeof predicate !== 'object' || predicate === null) return false;
    return (OPS as readonly string[]).includes(Object.keys(predicate as Record<string, unknown>)[0]!);
  },
);

/**
 * `mssql://user:password@host:port/database?encrypt=…&trustServerCertificate=…`
 * → tedious's connection object. The test env var's spelling, read the way
 * `driver-sql`'s live matrix reads it; tedious itself takes no URL.
 */
function mssqlConnection(url: string): Record<string, unknown> {
  const u = new URL(url);
  const flag = (name: string, fallback: boolean): boolean => {
    const v = u.searchParams.get(name);
    return v === null ? fallback : v === 'true' || v === '1';
  };
  return {
    server: u.hostname,
    port: u.port ? Number(u.port) : 1433,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'master',
    options: { encrypt: flag('encrypt', false), trustServerCertificate: flag('trustServerCertificate', true) },
  };
}

/** `oracle://user:password@host:port/service` → node-oracledb's connection object. */
function oracleConnection(url: string): Record<string, unknown> {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    connectString: `${u.hostname}:${u.port || '1521'}${u.pathname}`,
  };
}

const LIVE = [
  {
    id: 'mssql',
    env: 'OS_TEST_MSSQL_URL',
    client: 'mssql',
    connection: mssqlConnection,
    // The database's DEFAULT collation, which is case-insensitive on every
    // SQL Server install that has not been told otherwise: the defect's ground.
    create: (t: string) => `CREATE TABLE [${t}] ([id] nvarchar(64) NOT NULL PRIMARY KEY, [name] nvarchar(450) NULL)`,
    drop: (t: string) => `IF OBJECT_ID(N'${t}') IS NOT NULL DROP TABLE [${t}]`,
  },
  {
    id: 'oracle',
    env: 'OS_TEST_ORACLE_URL',
    client: 'oracledb',
    connection: oracleConnection,
    create: (t: string) => `CREATE TABLE "${t}" ("id" VARCHAR2(64) NOT NULL PRIMARY KEY, "name" NVARCHAR2(450) NULL)`,
    drop: (t: string) =>
      `BEGIN EXECUTE IMMEDIATE 'DROP TABLE "${t}"'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;`,
  },
] as const;

for (const cell of LIVE) {
  const url = process.env[cell.env];
  describe.skipIf(!url)(`[#31394] live ${cell.id}: the driver face and the native-SQL face answer the shared rows`, { timeout: 120_000 }, () => {
    const table = `os_31394_text_${process.pid}`;
    let driver: SqlDriver;
    let knex: ReturnType<SqlDriver['getKnex']>;
    const liveCube = { ...CUBE, sql: table } as unknown as Cube;

    beforeAll(async () => {
      driver = new SqlDriver({ client: cell.client, connection: cell.connection(url!), schemaMode: 'external' } as never);
      knex = driver.getKnex();
      await knex.raw(cell.drop(table));
      await knex.raw(cell.create(table));
      driver.registerExternalObject({
        name: table,
        fields: { name: { type: 'text' } },
        external: { remoteName: table },
      } as never);
      for (const row of FILTER_TEXT_ROWS) {
        await driver.create(table, { id: row.id, name: row.name }, { bypassTenantAudit: true } as never);
      }
    });

    afterAll(async () => {
      await knex?.raw(cell.drop(table)).catch(() => {});
      await driver?.disconnect?.();
    });

    const ids = (rows: Array<Record<string, unknown>>): string[] =>
      rows.map((r) => String(r.id ?? r.ID)).sort((a, b) => a.localeCompare(b));

    const native = async (where: unknown): Promise<string[]> => {
      const ctx = {
        getCube: (name: string) => (name === 'texts' ? liveCube : undefined),
        queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
        sqlDialect: () => asAcceptedSqlDialect((driver as unknown as { dialectName: string }).dialectName),
      } as DatasetScopedStrategyContext;
      const { sql, params } = await new NativeSQLStrategy().generateSql(query(where), ctx);
      // The plugin's `executeRawSql` bridge: `$N` → knex's `?`, run by the driver.
      const result = await driver.execute(sql.replace(/\$(\d+)/g, '?'), params);
      const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? []);
      return ids(rows as Array<Record<string, unknown>>);
    };

    it('runs the whole slice of the shared table this file drives', () => {
      expect(NAME_TEXT_CASES.length).toBeGreaterThan(0);
    });

    for (const c of NAME_TEXT_CASES) {
      it(`${c.name}: driver and native SQL both answer ${JSON.stringify(c.expected)}`, async () => {
        const viaDriver = ids(
          (await driver.find(table, { where: lowerFilterCondition(c.filter, { isDatetimeColumn: () => false }) } as never, {
            bypassTenantAudit: true,
          } as never)) as Array<Record<string, unknown>>,
        );
        expect(viaDriver, 'driver face').toEqual([...c.expected]);
        expect(await native(c.filter), 'native-SQL face').toEqual([...c.expected]);
      });
    }
  });
}
