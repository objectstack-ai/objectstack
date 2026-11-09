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
import { ReadableIds, type FilterCondition } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import { mssqlAggregandOperandSql } from './sql-driver-aggregation.js';
import { splitMssqlQualifiedName } from './sql-driver-mssql-introspection.js';
import { applyLike, applyLikePattern } from './sql-driver-predicate-emitters.js';
import type { IntrospectedColumn } from './sql-driver-top-level.js';

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
    // The one federation-only renderer, shared with Oracle: it names the
    // client it refuses, never another vendor.
    expect((caught as { reason?: string } | undefined)?.reason).toBe('federation-only');
    expect(caught?.message).toContain("knex client 'mssql' is a federation-only dialect");
    expect(caught?.message).toContain('no table was created or altered');
    expect(caught?.message).not.toContain('Oracle');
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

// ── #31395: a `uniqueidentifier` column is matched as its lower-case text ────
//
// SQL Server renders a GUID as UPPER-case text while this driver reads it back
// lower-case (`lowerCaseGuids`), so a text operator over the column's own text
// compared a spelling no read answers. Which columns are GUIDs is the remote
// catalog's answer (`primeMssqlGuidColumns`), never the comparand's shape: the
// probe below stands a canned catalog in for INFORMATION_SCHEMA.COLUMNS.

/** The lower-case text of a GUID column, under the same case-exact wrap. */
const guid = (operand: string) => `LOWER(CONVERT(nvarchar(36), ${operand}))`;

class GuidCatalogProbeDriver extends CompilerProbeDriver {
  catalogReads: string[] = [];
  catalogFails = false;
  protected override async introspectColumns(tableName: string, schema?: string): Promise<IntrospectedColumn[]> {
    this.catalogReads.push(`${schema ?? ''}.${tableName}`);
    if (this.catalogFails) throw new Error('catalog unreachable');
    const column = (name: string, type: string) =>
      ({ name, type, nullable: true, defaultValue: null, primaryKey: false, isUnique: false }) as IntrospectedColumn;
    if (tableName === 'Parents') return [column('ParentId', 'uniqueidentifier'), column('Code', 'nvarchar')];
    return [column('id', 'uniqueidentifier'), column('RefId', 'uniqueidentifier'), column('name', 'nvarchar')];
  }
  prime(where: unknown, object = 't'): Promise<void> {
    return this.primeMssqlGuidColumns(object, where);
  }
}

const guidProbe = (): GuidCatalogProbeDriver => {
  const d = new GuidCatalogProbeDriver(CONFIG);
  d.registerExternalObject({
    name: 't',
    fields: { ref: { type: 'text' }, name: { type: 'text' } },
    // `ref` reads the remote `RefId` column: the catalog speaks REMOTE names.
    external: { remoteName: 'Orders', remoteSchema: 'dbo', columnMap: { RefId: 'ref', id: 'id', name: 'name' } },
  });
  d.registerExternalObject({
    name: 'p',
    fields: { code: { type: 'text' } },
    external: { remoteName: 'Parents', remoteSchema: 'dbo', columnMap: { ParentId: 'id', Code: 'code' } },
  });
  return d;
};

/** Prime from the canned catalog, then compile — the order every read door keeps. */
const compileGuid = async (where: FilterCondition, d = guidProbe()) => {
  await d.prime(where);
  return d.compileWhere(where);
};

describe('[#31395] uniqueidentifier — the text operators match the lower-case form a read answers', () => {
  const CASE_EXACT: Array<[op: string, shape: (v: string) => string]> = [
    ['$contains', (v) => `%${v}%`],
    ['$startsWith', (v) => `${v}%`],
    ['$endsWith', (v) => `%${v}`],
  ];

  for (const [op, shape] of CASE_EXACT) {
    for (const fragment of ['a0eebc99', 'A0EEBC99']) {
      it(`${op} ${JSON.stringify(fragment)} on a GUID column: LOWER(CONVERT(nvarchar(36), col)), the fragment as written`, async () => {
        expect(await compileGuid({ ref: { [op]: fragment } } as FilterCondition)).toEqual({
          sql: `select * from [t] where ${exact(guid('[RefId]'))} LIKE ${exact('@p0')} ESCAPE @p1`,
          bindings: [shape(fragment), '\\'],
        });
      });
    }
  }

  for (const fragment of ['a0eebc99', 'A0EEBC99']) {
    it(`$notContains ${JSON.stringify(fragment)}: the NULL-safe NOT LIKE over the lower-case form`, async () => {
      expect(await compileGuid({ ref: { $notContains: fragment } })).toEqual({
        sql: `select * from [t] where ([RefId] is null or ${exact(guid('[RefId]'))} NOT LIKE ${exact('@p0')} ESCAPE @p1)`,
        bindings: [`%${fragment}%`, '\\'],
      });
    });

    it(`$icontains ${JSON.stringify(fragment)}: the ASCII fold over the lower-case form`, async () => {
      expect(await compileGuid({ ref: { $icontains: fragment } })).toEqual({
        sql: `select * from [t] where ${fold(guid('[RefId]'))} LIKE ${fold('@p0')} ESCAPE @p1`,
        bindings: [`%${fragment}%`, '\\'],
      });
    });

    it(`$like / $ilike ${JSON.stringify(fragment)}: the pattern over the lower-case form`, async () => {
      expect(await compileGuid({ ref: { $like: `${fragment}%` } })).toEqual({
        sql: `select * from [t] where ${exact(guid('[RefId]'))} LIKE ${exact('@p0')} ESCAPE @p1`,
        bindings: [`${fragment}%`, '\\'],
      });
      expect((await compileGuid({ ref: { $ilike: `${fragment}%` } })).sql).toBe(
        `select * from [t] where ${fold(guid('[RefId]'))} LIKE ${fold('@p0')} ESCAPE @p1`,
      );
    });
  }

  it('the key column the catalog reports as uniqueidentifier is matched the same way', async () => {
    expect((await compileGuid({ id: { $startsWith: '3f2504e0' } })).sql).toBe(
      `select * from [t] where ${exact(guid('[id]'))} LIKE ${exact('@p0')} ESCAPE @p1`,
    );
  });

  it('control: an nvarchar column of the same table compiles exactly as before', async () => {
    const d = guidProbe();
    for (const where of [
      { name: { $contains: 'a0eebc99' } },
      { name: { $startsWith: 'A0EEBC99' } },
      { name: { $notContains: 'x' } },
      { name: { $icontains: 'Ab' } },
      { name: { $like: 'a[b%' } },
    ] as FilterCondition[]) {
      await d.prime(where);
      const primed = d.compileWhere(where);
      expect(primed, JSON.stringify(where)).toEqual(probe().compileWhere(where));
      expect(primed.sql).not.toContain('nvarchar(36)');
    }
  });

  it('control: equality on a GUID column is untouched — SQL Server compares GUIDs by value', async () => {
    expect(await compileGuid({ ref: { $eq: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11' } })).toEqual({
      sql: 'select * from [t] where [RefId] = @p0',
      bindings: ['A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'],
    });
  });

  it('control: no other dialect reads the GUID flag — sqlite, postgres, mysql, oracle and unknown emit identically', () => {
    /** What the emitter hands the builder: the raw method, the SQL and its bindings. */
    const emitted = (run: (builder: unknown) => void): unknown[][] => {
      const calls: unknown[][] = [];
      run({ whereRaw: (...a: unknown[]) => calls.push(['whereRaw', ...a]) });
      return calls;
    };
    for (const dialectName of ['sqlite', 'postgres', 'mysql', 'oracle', 'unknown'] as const) {
      const host = { dialectName };
      for (const [shape, negate, fold] of [['contains', false, false], ['starts', false, false], ['ends', false, false], ['contains', true, false], ['contains', false, true]] as const) {
        expect(emitted((b) => applyLike.call(host, b, 'where', 'ref', 'a0eebc99', shape, negate, fold, true)), `${dialectName} ${shape}`)
          .toEqual(emitted((b) => applyLike.call(host, b, 'where', 'ref', 'a0eebc99', shape, negate, fold)));
      }
      for (const fold of [false, true]) {
        expect(emitted((b) => applyLikePattern.call(host, b, 'where', 'ref', 'a0eebc99%', fold, true)), `${dialectName} like`)
          .toEqual(emitted((b) => applyLikePattern.call(host, b, 'where', 'ref', 'a0eebc99%', fold)));
      }
    }
  });

  it('the catalog is asked once per object, and only by a filter holding a text operator', async () => {
    const d = guidProbe();
    await d.prime({ ref: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' });
    await d.prime({ ref: { $in: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'] }, name: { $eq: 'x' } });
    expect(d.catalogReads).toEqual([]);
    await d.prime({ $or: [{ name: 'x' }, { ref: { $contains: 'a0ee' } }] });
    await d.prime({ name: { $like: 'x%' } });
    expect(d.catalogReads).toEqual(['dbo.Orders']);
  });

  it('a composed ReadableIds leaf primes its own object, whose subquery matches its GUID key the same way', async () => {
    const d = guidProbe();
    const where = { ref: { $in: ReadableIds.compose(ReadableIds.of('p'), { id: { $startsWith: 'ab' } }) } } as FilterCondition;
    await d.prime(where);
    expect(d.catalogReads.sort()).toEqual(['dbo.Orders', 'dbo.Parents']);
    expect(d.compileWhere(where).sql).toBe(
      `select * from [t] where [RefId] in (select [ParentId] from [dbo].[Parents] where ${exact(guid('[ParentId]'))} LIKE ${exact('@p0')} ESCAPE @p1)`,
    );
  });

  it('a failed catalog read records nothing: the column is matched as before, and the next read asks again', async () => {
    const d = guidProbe();
    d.catalogFails = true;
    const where = { ref: { $contains: 'a0ee' } } as FilterCondition;
    await d.prime(where);
    expect(d.compileWhere(where).sql).toBe(`select * from [t] where ${exact('[RefId]')} LIKE ${exact('@p0')} ESCAPE @p1`);
    d.catalogFails = false;
    await d.prime(where);
    expect(d.catalogReads).toEqual(['dbo.Orders', 'dbo.Orders']);
    expect(d.compileWhere(where).sql).toContain(guid('[RefId]'));
  });
});
