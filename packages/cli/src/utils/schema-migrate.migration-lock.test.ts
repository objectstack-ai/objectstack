// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The schema-migration lock `bootSchemaStack` takes on an applying boot
 * (`acquireSchemaMigrationLock`), at the seams a real database cannot stage on
 * demand: every statement each dialect runs, the one line a contended wait
 * prints, the refusal when the wait runs out, and the session it all rides on.
 *
 * The two promises the single-node path is held to (R3's one accepted
 * exception: an uncontended lock call, output unchanged) are the first two
 * describes — an uncontended lock prints nothing, and SQLite runs nothing at
 * all. Two concurrent migrators against a live Postgres are
 * `schema-migrate.migration-lock.integration.test.ts`'s.
 */

import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  acquireSchemaMigrationLock,
  SCHEMA_MIGRATION_LOCK_NAME,
  SCHEMA_MIGRATION_LOCK_WAIT_MS,
  SCHEMA_MIGRATION_PG_LOCK_KEY,
} from './schema-migrate.js';

interface Statement {
  sql: string;
  bindings: readonly unknown[];
  connection: unknown;
}

/**
 * A driver whose knex records every statement and the connection it ran on,
 * answering each from `answer` in the dialect's own result shape.
 */
function fakeDriver(
  dialect: string,
  answer: (sql: string, bindings: readonly unknown[]) => unknown,
) {
  const statements: Statement[] = [];
  const connection = { id: 'raw-1' };
  const opened: unknown[] = [];
  const destroyed: unknown[] = [];
  const shape = (row: unknown) => (dialect === 'mysql' ? [[row], []] : { rows: [row] });
  const knex = {
    client: {
      dialect,
      acquireRawConnection: vi.fn(async () => { opened.push(connection); return connection; }),
      destroyRawConnection: vi.fn(async (c: unknown) => { destroyed.push(c); }),
    },
    raw: (sql: string, bindings: readonly unknown[] = []) => ({
      connection: async (c: unknown) => {
        statements.push({ sql, bindings, connection: c });
        const out = answer(sql, bindings);
        if (out instanceof Error) throw out;
        return shape(out);
      },
    }),
  };
  return { driver: { getKnex: () => knex }, statements, opened, destroyed, connection };
}

const DB = 'postgres://db.internal:5432/app';

describe('the lock key', () => {
  it('is the first 8 bytes of SHA-256 of the lock name, as a signed 64-bit integer — pinned, so every CLI version takes ONE lock', () => {
    const hex = createHash('sha256').update(SCHEMA_MIGRATION_LOCK_NAME).digest('hex').slice(0, 16);
    expect(SCHEMA_MIGRATION_PG_LOCK_KEY).toBe(BigInt.asIntN(64, BigInt(`0x${hex}`)).toString());
    // The value itself: a changed name or derivation lets an old and a new
    // migrator run side by side during a rolling upgrade.
    expect(SCHEMA_MIGRATION_LOCK_NAME).toBe('objectstack:schema-migrate');
    expect(SCHEMA_MIGRATION_PG_LOCK_KEY).toBe('255402229896085448');
  });
});

describe('a database the lock does not apply to runs nothing', () => {
  it.each(['sqlite3', 'mssql', 'oracle', undefined])('dialect %s: null, no connection opened, no line printed', async (dialect) => {
    const f = fakeDriver(String(dialect), () => ({}));
    if (dialect === undefined) (f.driver.getKnex() as { client: { dialect?: string } }).client.dialect = undefined;
    const warn = vi.fn();
    await expect(acquireSchemaMigrationLock(f.driver, { database: DB, warn })).resolves.toBeNull();
    expect(f.opened).toEqual([]);
    expect(f.statements).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a driver with no knex (memory, mongo) answers null', async () => {
    await expect(acquireSchemaMigrationLock({}, { database: DB, warn: vi.fn() })).resolves.toBeNull();
    await expect(acquireSchemaMigrationLock(null, { database: DB, warn: vi.fn() })).resolves.toBeNull();
  });
});

describe('Postgres', () => {
  it('uncontended: one try-lock on a connection of its own, and NOT ONE line printed', async () => {
    const f = fakeDriver('postgresql', () => ({ locked: true }));
    const warn = vi.fn();
    const lock = await acquireSchemaMigrationLock(f.driver, { database: DB, warn });
    expect(lock).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(f.statements.map((s) => s.sql)).toEqual(['select pg_try_advisory_lock(?::bigint) as locked']);
    expect(f.statements[0].bindings).toEqual([SCHEMA_MIGRATION_PG_LOCK_KEY]);
    expect(f.statements[0].connection).toBe(f.connection);
    expect(f.destroyed).toEqual([]);
  });

  it('release unlocks on the SAME session the lock was taken on, then closes it — once', async () => {
    const f = fakeDriver('postgresql', () => ({ locked: true }));
    const lock = await acquireSchemaMigrationLock(f.driver, { database: DB, warn: vi.fn() });
    await lock!.release();
    await lock!.release();
    expect(f.statements.map((s) => s.sql)).toEqual([
      'select pg_try_advisory_lock(?::bigint) as locked',
      'select pg_advisory_unlock(?::bigint)',
    ]);
    expect(new Set(f.statements.map((s) => s.connection))).toEqual(new Set([f.connection]));
    expect(f.destroyed).toEqual([f.connection]);
  });

  it('contended: ONE line naming the database, then a wait bounded by lock_timeout', async () => {
    const f = fakeDriver('postgresql', (sql) => (sql.startsWith('select pg_try') ? { locked: false } : {}));
    const warn = vi.fn();
    const lock = await acquireSchemaMigrationLock(f.driver, { database: DB, warn, waitMs: 5_000 });
    expect(lock).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(DB);
    expect(f.statements.map((s) => s.sql)).toEqual([
      'select pg_try_advisory_lock(?::bigint) as locked',
      'set lock_timeout = 5000',
      'select pg_advisory_lock(?::bigint)',
    ]);
    expect(f.statements[2].bindings).toEqual([SCHEMA_MIGRATION_PG_LOCK_KEY]);
  });

  it('the default bound is SCHEMA_MIGRATION_LOCK_WAIT_MS', async () => {
    const f = fakeDriver('postgresql', (sql) => (sql.startsWith('select pg_try') ? { locked: false } : {}));
    await acquireSchemaMigrationLock(f.driver, { database: DB, warn: vi.fn() });
    expect(f.statements[1].sql).toBe(`set lock_timeout = ${SCHEMA_MIGRATION_LOCK_WAIT_MS}`);
  });

  it('⛔ a wait that runs out REFUSES, naming the database — never proceeds unlocked — and closes the session', async () => {
    const timedOut = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    const f = fakeDriver('postgresql', (sql) => {
      if (sql.startsWith('select pg_try')) return { locked: false };
      if (sql.startsWith('select pg_advisory_lock')) return timedOut;
      return {};
    });
    const failure = await acquireSchemaMigrationLock(f.driver, { database: DB, warn: vi.fn(), waitMs: 5_000 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/^Refusing to migrate /);
    expect((failure as Error).message).toContain(DB);
    expect(f.destroyed).toEqual([f.connection]);
  });

  it('any other failure of the wait is handed on as it is, the session closed', async () => {
    const other = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    const f = fakeDriver('postgresql', (sql) => {
      if (sql.startsWith('select pg_try')) return { locked: false };
      if (sql.startsWith('select pg_advisory_lock')) return other;
      return {};
    });
    await expect(acquireSchemaMigrationLock(f.driver, { database: DB, warn: vi.fn() })).rejects.toBe(other);
    expect(f.destroyed).toEqual([f.connection]);
  });
});

describe('MySQL', () => {
  it('uncontended: GET_LOCK with no wait, NOT ONE line printed; release is RELEASE_LOCK on the same session', async () => {
    const f = fakeDriver('mysql', () => ({ locked: 1 }));
    const warn = vi.fn();
    const lock = await acquireSchemaMigrationLock(f.driver, { database: DB, warn });
    expect(warn).not.toHaveBeenCalled();
    await lock!.release();
    expect(f.statements.map((s) => [s.sql, s.bindings])).toEqual([
      ['select GET_LOCK(?, 0) as locked', [SCHEMA_MIGRATION_LOCK_NAME]],
      ['select RELEASE_LOCK(?)', [SCHEMA_MIGRATION_LOCK_NAME]],
    ]);
    expect(new Set(f.statements.map((s) => s.connection))).toEqual(new Set([f.connection]));
    expect(f.destroyed).toEqual([f.connection]);
  });

  it('contended: ONE line, then GET_LOCK bounded in whole seconds', async () => {
    let tries = 0;
    const f = fakeDriver('mysql', () => ({ locked: tries++ === 0 ? 0 : 1 }));
    const warn = vi.fn();
    await acquireSchemaMigrationLock(f.driver, { database: DB, warn, waitMs: 4_500 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(f.statements.map((s) => [s.sql, s.bindings])).toEqual([
      ['select GET_LOCK(?, 0) as locked', [SCHEMA_MIGRATION_LOCK_NAME]],
      ['select GET_LOCK(?, ?) as locked', [SCHEMA_MIGRATION_LOCK_NAME, 5]],
    ]);
  });

  it.each([[0, 'timed out'], [null, 'errored']])('⛔ GET_LOCK answering %s (%s) REFUSES and closes the session', async (answer, _why) => {
    let tries = 0;
    const f = fakeDriver('mysql', () => ({ locked: tries++ === 0 ? 0 : answer }));
    const failure = await acquireSchemaMigrationLock(f.driver, { database: DB, warn: vi.fn() }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/^Refusing to migrate /);
    expect(f.destroyed).toEqual([f.connection]);
  });
});
