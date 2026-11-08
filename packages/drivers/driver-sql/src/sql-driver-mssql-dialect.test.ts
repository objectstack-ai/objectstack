// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31327] SQL Server, compiled — one pin per emitter arm the `mssql` dialect
 * added, read from `toSQL()` with no server.
 *
 * The live behaviour of every arm is measured by
 * `sql-driver-mssql-federation-conformance.test.ts` when `OS_TEST_MSSQL_URL`
 * is provisioned; these pins hold the statement SHAPE on every run, so an
 * arm that silently fell back to the `'unknown'` dialect's plain `LIKE` /
 * `LOWER()` (the pre-#31327 answer, wrong under SQL Server's default
 * case-insensitive collations) turns red here even where no SQL Server runs.
 *
 * knex's `mssql` client builds offline (it resolves `tedious` from the
 * workspace without connecting), which is all a compile pin needs.
 */

import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import type { FilterCondition } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import { mssqlAggregandOperandSql } from './sql-driver-aggregation.js';
import { splitMssqlQualifiedName } from './sql-driver-mssql-introspection.js';

const CONFIG = { client: 'mssql', connection: {}, schemaMode: 'external' } as unknown as SqlDriverConfig;

class CompilerProbeDriver extends SqlDriver {
  compileWhere(where: FilterCondition): { sql: string; bindings: readonly unknown[] } {
    const builder: Knex.QueryBuilder = this.getKnex()('t');
    this.applyFilters(builder, where);
    const native = builder.toSQL().toNative();
    return { sql: native.sql, bindings: native.bindings };
  }
}

const probe = (): CompilerProbeDriver => {
  const d = new CompilerProbeDriver(CONFIG);
  d.registerExternalObject({
    name: 't',
    fields: { name: { type: 'text' }, tags: { type: 'select', multiple: true } },
    external: { remoteName: 'Orders', remoteSchema: 'dbo' },
  });
  return d;
};

/** The case-exact operand: SQL Server's default collations are case-INSENSITIVE. */
const exact = (operand: string) => `CAST(${operand} AS nvarchar(max)) COLLATE Latin1_General_100_BIN2`;
const fold = (operand: string) =>
  `TRANSLATE(${exact(operand)}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`;

describe('[#31327] the mssql dialect is modelled, not unknown', () => {
  it('reads as `mssql`, and answers INSERT through OUTPUT inserted.*', () => {
    const d = probe() as any;
    expect(d.dialectName).toBe('mssql');
    expect(d.insertReturnsStoredRows).toBe(true);
    const insert = d.getKnex()('Orders').withSchema('dbo').insert({ a: 1 }).returning('*').toSQL().toNative();
    expect(insert.sql).toBe('insert into [dbo].[Orders] ([a]) output inserted.* values (@p0)');
  });

  it('asks tedious for lower-case GUIDs unless the host chose otherwise', () => {
    const conn = (d: any) => d.getKnex().client.config.connection;
    expect(conn(probe()).options).toMatchObject({ lowerCaseGuids: true });
    const chosen = new SqlDriver({ ...CONFIG, connection: { options: { lowerCaseGuids: false, encrypt: false } } } as SqlDriverConfig) as any;
    expect(conn(chosen).options).toEqual({ lowerCaseGuids: false, encrypt: false });
  });

  it('refuses managed schema emission, naming the federation-only scope', () => {
    const d = probe() as any;
    let caught: (Error & { code?: string }) | undefined;
    try {
      d.assertDialectEmits('initObjects');
    } catch (e) {
      caught = e as Error & { code?: string };
    }
    expect(caught?.code).toBe('SQL_DIALECT_EMISSION_UNSUPPORTED');
    expect(caught?.message).toContain('served for federation only');
    expect(caught?.message).toContain('No table was created or altered');
  });
});

describe('[#31327 · #6518] text predicates — case-exact through a BIN2 collation, folded with TRANSLATE', () => {
  it('$contains: both sides case-exact, `%` `_` `[` escaped, ESCAPE bound', () => {
    expect(probe().compileWhere({ name: { $contains: 'a%_[b' } })).toEqual({
      sql: `select * from [t] where ${exact('[name]')} LIKE ${exact('@p0')} ESCAPE @p1`,
      bindings: ['%a\\%\\_\\[b%', '\\'],
    });
  });

  it('$icontains: the ASCII fold on both sides — never LOWER(), which follows the collation', () => {
    const { sql, bindings } = probe().compileWhere({ name: { $icontains: 'Ab' } });
    expect(sql).toBe(`select * from [t] where ${fold('[name]')} LIKE ${fold('@p0')} ESCAPE @p1`);
    expect(sql).not.toMatch(/LOWER\(/i);
    expect(bindings).toEqual(['%Ab%', '\\']);
  });

  it('$notContains: the NULL-safe NOT LIKE (#5298)', () => {
    expect(probe().compileWhere({ name: { $notContains: 'x' } }).sql).toBe(
      `select * from [t] where ([name] is null or ${exact('[name]')} NOT LIKE ${exact('@p0')} ESCAPE @p1)`,
    );
  });

  it('$startsWith / $endsWith anchor the pattern, same construct', () => {
    expect(probe().compileWhere({ name: { $startsWith: 'x' } }).bindings).toEqual(['x%', '\\']);
    expect(probe().compileWhere({ name: { $endsWith: 'x' } }).bindings).toEqual(['%x', '\\']);
  });

  it('$like: the author\'s wildcards kept, a bare `[` escaped (a character class on SQL Server only)', () => {
    expect(probe().compileWhere({ name: { $like: 'a[b%' } })).toEqual({
      sql: `select * from [t] where ${exact('[name]')} LIKE ${exact('@p0')} ESCAPE @p1`,
      bindings: ['a\\[b%', '\\'],
    });
  });
});

describe('[#31327] JSON-array fields: refused, never a substring guess', () => {
  it('$contains on a multi-value field is INVALID_FILTER', () => {
    expect(() => probe().compileWhere({ tags: { $contains: 'x' } })).toThrow(
      expect.objectContaining({ code: 'INVALID_FILTER' }),
    );
  });

  it('$empty on a multi-value field is INVALID_FILTER', () => {
    expect(() => probe().compileWhere({ tags: { $empty: true } })).toThrow(
      expect.objectContaining({ code: 'INVALID_FILTER' }),
    );
  });
});

describe('[#31327] paging — OFFSET … FETCH needs an ORDER BY; LIMIT 0 is TOP (0)', () => {
  const k = () => probe().getKnex();

  it('an OFFSET with no key to order by is ordered by (SELECT NULL), which SQL Server accepts', () => {
    expect(k()('Orders').select('*').orderByRaw('(SELECT NULL)').offset(5).limit(10).toSQL().toNative().sql).toBe(
      'select * from [Orders] order by (SELECT NULL) offset @p0 rows fetch next @p1 rows only',
    );
  });

  it('limit 0 compiles to TOP (0) — FETCH NEXT 0 ROWS is an error there', () => {
    expect(k()('Orders').select('*').limit(0).toSQL().toNative().sql).toBe('select top (@p0) * from [Orders]');
  });
});

describe('[#31327] aggregands — bit is not a SUM/AVG/MIN/MAX operand on SQL Server', () => {
  it('a boolean aggregand is cast to int, and AVG accumulates in float', () => {
    expect(mssqlAggregandOperandSql('sum', 'boolean', '??')).toBe('cast(?? as int)');
    expect(mssqlAggregandOperandSql('avg', 'boolean', '??')).toBe('cast(cast(?? as int) as float)');
    expect(mssqlAggregandOperandSql('max', 'boolean', '??')).toBe('cast(?? as int)');
    expect(mssqlAggregandOperandSql('count', 'boolean', '??')).toBe('??');
  });

  it('an integer AVG is not integer division', () => {
    expect(mssqlAggregandOperandSql('avg', 'integral', '??')).toBe('cast(?? as float)');
  });
});

describe('[#31327] schema-qualified names — `dbo.Orders` splits at the first dot', () => {
  it('splits a qualified key, and reads a bare name in the default schema', () => {
    expect(splitMssqlQualifiedName('dbo.Orders')).toEqual({ schema: 'dbo', table: 'Orders' });
    expect(splitMssqlQualifiedName('Sales.Order.Lines')).toEqual({ schema: 'Sales', table: 'Order.Lines' });
    expect(splitMssqlQualifiedName('Orders')).toEqual({ schema: undefined, table: 'Orders' });
    expect(splitMssqlQualifiedName('.Orders')).toEqual({ schema: undefined, table: '.Orders' });
  });
});
