// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 O2, ruled A] `fixed-read-leaf-key-type.ts` without a server: what
 * the catalog prime reads, what it records, and the statement the filter
 * compiler then emits. Each driver here is configured and never dialled; the
 * PostgreSQL catalog read is answered by a stub on the knex client. The live
 * pins per key type are in `sql-driver-fixed-read-leaf-conformance.test.ts`
 * (the PostgreSQL cell).
 */

import { describe, it, expect, vi } from 'vitest';
import type { Knex } from 'knex';
import { ReadableIds, SharedRecordIds, type FilterCondition } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import { primeFixedReadLeafKeyTypes } from './fixed-read-leaf-key-type.js';

const EXT = 'srid_ext';
const CHILD = 'srid_child';

class Probe extends SqlDriver {
  /** The prime, through this driver's own `getBuilder`, as a door calls it. */
  prime(object: string, where: unknown): Promise<void> {
    return primeFixedReadLeafKeyTypes({ getBuilder: (o) => this.getBuilder(o) }, object, where);
  }
  compile(object: string, where: unknown): { sql: string; bindings: readonly unknown[] } {
    const builder: Knex.QueryBuilder = this.getBuilder(object);
    this.applyFilters(builder, where);
    const native = builder.toSQL().toNative();
    return { sql: native.sql, bindings: native.bindings };
  }
}

const PG: SqlDriverConfig = { client: 'pg', connection: {} } as unknown as SqlDriverConfig;

/** A never-dialled PostgreSQL probe whose catalog read answers `answer` (rows, or a thrown error). */
function pgProbe(answer: () => unknown): { probe: Probe; raw: ReturnType<typeof vi.fn> } {
  const probe = new Probe(PG);
  const client = (probe as any).knex.client as { raw: (...args: unknown[]) => unknown };
  const original = client.raw.bind(client);
  // Only the catalog read is answered here; every other raw (the cast itself) is knex's own.
  const raw = vi.fn(async (..._args: unknown[]) => answer());
  client.raw = (...args: unknown[]) => (String(args[0]).includes('pg_attribute') ? raw(...args) : original(...args));
  return { probe, raw };
}

/** The refusal envelope ADR-0139 D3 names: `INTERNAL_ERROR` / 500, the statement never compiled. */
function expectRefused(run: () => unknown, why: string): void {
  let caught: unknown;
  try { run(); } catch (err) { caught = err; }
  expect(caught, 'refused').toBeInstanceOf(Error);
  expect((caught as { code?: unknown }).code).toBe('INTERNAL_ERROR');
  expect((caught as { status?: unknown }).status).toBe(500);
  expect((caught as Error).message).toContain(why);
}

const row = (column_name: string, type_schema: string, type_name: string) => ({ column_name, type_schema, type_name });
const leafWhere = (object = EXT) => ({ id: { $in: SharedRecordIds.read(object, 'u9') } });

describe('[ADR-0155 O2] the catalog prime and the cast it puts on the inner read', () => {
  it('an integer key: one catalog read, then the inner read casts record_id to int4', async () => {
    const { probe, raw } = pgProbe(() => ({ rows: [row('id', 'pg_catalog', 'int4'), row('label', 'pg_catalog', 'text')] }));
    await probe.prime(EXT, leafWhere());
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw.mock.calls[0][1]).toEqual([EXT]);
    const { sql, bindings } = probe.compile(EXT, leafWhere());
    expect(sql).toBe(
      'select * from "srid_ext" where "id" in (select CAST(NULLIF("record_id", \'\') AS "pg_catalog"."int4") from "sys_record_share" '
        + 'where "object_name" = $1 and "recipient_type" = $2 and "recipient_id" = $3 and "record_id" is not null and "record_id" <> $4)',
    );
    // The cast adds no parameter: the inner read binds what step 3's does.
    expect(bindings).toEqual([EXT, 'user', 'u9', '']);
    // Recorded once per table: the next door reads nothing.
    await probe.prime(EXT, leafWhere());
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('an external object with a remote schema and table is read and keyed by its physical name', async () => {
    const { probe, raw } = pgProbe(() => ({ rows: [row('ext_id', 'pg_catalog', 'uuid')] }));
    probe.registerExternalObject({ name: EXT, fields: {}, external: { remoteName: 'remote_t', remoteSchema: 'crm', columnMap: { ext_id: 'id' } } } as any);
    await probe.prime(EXT, leafWhere());
    expect(raw.mock.calls[0][0]).toContain("format('%I.%I', ?::text, ?::text)");
    expect(raw.mock.calls[0][1]).toEqual(['crm', 'remote_t']);
    expect(probe.compile(EXT, leafWhere()).sql).toContain(
      '"ext_id" in (select CAST(NULLIF("record_id", \'\') AS "pg_catalog"."uuid") from "sys_record_share"',
    );
  });

  it('a text or varchar key takes no cast: step 3\'s statement, byte for byte', async () => {
    for (const type of ['text', 'varchar']) {
      const { probe } = pgProbe(() => ({ rows: [row('id', 'pg_catalog', type)] }));
      await probe.prime(EXT, leafWhere());
      expect(probe.compile(EXT, leafWhere()).sql).toContain('"id" in (select "record_id" from "sys_record_share"');
    }
  });

  it('a type name knex cannot bind as one identifier is refused, never cast or left uncast', async () => {
    const { probe } = pgProbe(() => ({ rows: [row('id', 'odd.schema', 'int4')] }));
    await probe.prime(EXT, leafWhere());
    expectRefused(() => probe.compile(EXT, leafWhere()), 'cannot bind as one identifier');
  });

  it('no reading is refused (INTERNAL_ERROR / 500, logged once), never compiled uncast; a failed or empty read records nothing and the next door asks again', async () => {
    let answer: () => unknown = () => { throw new Error('catalog unavailable'); };
    const { probe, raw } = pgProbe(() => answer());
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    (probe as any).logger = logger;
    // Never primed: no reading at all.
    expectRefused(() => probe.compile(EXT, leafWhere()), 'holds no reading');
    // The catalog read failed (a pooled connection's acquire timeout is one).
    await probe.prime(EXT, leafWhere());
    expectRefused(() => probe.compile(EXT, leafWhere()), 'holds no reading');
    // The relation is not visible to the pooled connection (an uncommitted CREATE).
    answer = () => ({ rows: [] });
    await probe.prime(EXT, leafWhere());
    expectRefused(() => probe.compile(EXT, leafWhere()), 'holds no reading');
    // Logged at error once for this client; the caller saw all three.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toContain("[driver-sql] the $in of column 'id' of 'srid_ext' holds a SharedRecordIds leaf");
    expect(String(logger.error.mock.calls[0][0])).not.toContain('u9');
    answer = () => ({ rows: [row('id', 'pg_catalog', 'int8')] });
    await probe.prime(EXT, leafWhere());
    expect(raw).toHaveBeenCalledTimes(3);
    expect(probe.compile(EXT, leafWhere()).sql).toContain('AS "pg_catalog"."int8"');
  });

  it('a column the read table does not have takes no cast: the database names the missing column itself', async () => {
    const { probe } = pgProbe(() => ({ rows: [row('label', 'pg_catalog', 'text')] }));
    await probe.prime(EXT, leafWhere());
    expect(probe.compile(EXT, leafWhere()).sql).toContain('"id" in (select "record_id" from "sys_record_share"');
  });

  it('a where with no leaf reads nothing', async () => {
    const { probe, raw } = pgProbe(() => ({ rows: [row('id', 'pg_catalog', 'int4')] }));
    await probe.prime(EXT, { id: { $in: ['7', '42'] }, label: 'x' });
    await probe.prime(EXT, undefined);
    expect(raw).not.toHaveBeenCalled();
  });

  it('a leaf under a composed ReadableIds scope primes the parent object\'s table, and is cast there', async () => {
    const { probe, raw } = pgProbe(() => ({ rows: [row('id', 'pg_catalog', 'int4')] }));
    const where = { parent: { $in: ReadableIds.compose(ReadableIds.of(EXT), leafWhere() as unknown as FilterCondition) } };
    await probe.prime(CHILD, where);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw.mock.calls[0][1]).toEqual([EXT]);
    const { sql } = probe.compile(CHILD, where);
    expect(sql).toContain('"parent" in (select "id" from "srid_ext" where "id" in (select CAST(NULLIF("record_id", \'\') AS "pg_catalog"."int4")');
  });

  it('a leaf in an $or group is cast too (the group compiles on a builder with no table of its own)', async () => {
    const { probe } = pgProbe(() => ({ rows: [row('id', 'pg_catalog', 'int4')] }));
    const where = { $or: [leafWhere(), { label: 'x' }] };
    await probe.prime(EXT, where);
    expect(probe.compile(EXT, where).sql).toContain('"id" in (select CAST(NULLIF("record_id", \'\') AS "pg_catalog"."int4")');
  });

  it('every other dialect reads no catalog and compiles step 3\'s statement', async () => {
    const configs: Record<string, SqlDriverConfig> = {
      sqlite: { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as SqlDriverConfig,
      mysql: { client: 'mysql2', connection: {} } as unknown as SqlDriverConfig,
      mssql: { client: 'mssql', connection: {}, schemaMode: 'external' } as unknown as SqlDriverConfig,
    };
    for (const [dialect, config] of Object.entries(configs)) {
      const probe = new Probe(config);
      const client = (probe as any).knex.client as { raw: (...args: unknown[]) => unknown };
      const raw = vi.spyOn(client, 'raw');
      await probe.prime(EXT, leafWhere());
      expect(raw, dialect).not.toHaveBeenCalled();
      expect(probe.compile(EXT, leafWhere()).sql, dialect).not.toMatch(/CAST\(/);
      await probe.disconnect?.();
    }
  });
});
