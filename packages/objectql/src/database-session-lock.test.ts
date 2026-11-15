// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The database session lock both named locks ride on
 * (`database-session-lock.ts`): the schema-migration lock, and the audit seal
 * lock of ADR-0154 D3 as amended (seat ruling 6885005594, E). What the
 * schema-migration lock's own pins do not reach: a lock of ANOTHER name, the
 * try-once form a sealer pass takes (no wait, never a line), and the probe a
 * holder asks whether its session — and so its lock — still stands.
 *
 * Every statement runs against a fake Knex at the seams a real database cannot
 * stage on demand; two sessions on one live Postgres are the CLI's live file.
 */

import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  acquireDatabaseSessionLock,
  databaseSessionLockPgKey,
  tryDatabaseSessionLock,
} from './database-session-lock.js';
import { SCHEMA_MIGRATION_LOCK_NAME, SCHEMA_MIGRATION_PG_LOCK_KEY } from './schema-migration-lock.js';

interface Statement {
  sql: string;
  bindings: readonly unknown[];
  connection: unknown;
}

/** A driver whose knex records every statement and the session it ran on, answered by `answer`. */
function fakeDriver(dialect: string, answer: (sql: string, bindings: readonly unknown[]) => unknown) {
  const statements: Statement[] = [];
  const connection = { id: 'raw-1' };
  const opened: unknown[] = [];
  const destroyed: unknown[] = [];
  const shape = (row: unknown) => (dialect === 'mysql' ? [[row], []] : { rows: [row] });
  const knex = {
    client: {
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
  const getKnex = vi.fn(() => knex);
  return { driver: { dialectName: dialect, getKnex }, getKnex, statements, opened, destroyed, connection };
}

const NAME = 'objectstack:probe-lock';
const KEY = databaseSessionLockPgKey(NAME);

describe('the Postgres key of a named lock', () => {
  it('is the derivation the schema-migration lock was pinned to: the first 8 bytes of SHA-256, signed 64-bit', () => {
    expect(databaseSessionLockPgKey(SCHEMA_MIGRATION_LOCK_NAME)).toBe(SCHEMA_MIGRATION_PG_LOCK_KEY);
    const hex = createHash('sha256').update(NAME).digest('hex').slice(0, 16);
    expect(KEY).toBe(BigInt.asIntN(64, BigInt(`0x${hex}`)).toString());
    expect(KEY).not.toBe(SCHEMA_MIGRATION_PG_LOCK_KEY);
  });
});

describe('tryDatabaseSessionLock: once, never waiting, never a line', () => {
  it.each(['sqlite', 'mssql', 'unknown'])('dialectName %s: null, Knex never asked for, no session opened', async (dialect) => {
    const f = fakeDriver(dialect, () => ({}));
    await expect(tryDatabaseSessionLock(f.driver, NAME)).resolves.toBeNull();
    expect(f.getKnex).not.toHaveBeenCalled();
    expect(f.opened).toEqual([]);
  });

  it('Postgres, free: one try-lock under the name\'s own key, on a session of its own', async () => {
    const f = fakeDriver('postgres', () => ({ locked: true }));
    const lock = await tryDatabaseSessionLock(f.driver, NAME);
    expect(lock).not.toBeNull();
    expect(lock).not.toBe('held');
    expect(f.statements.map((s) => [s.sql, s.bindings])).toEqual([['select pg_try_advisory_lock(?::bigint) as locked', [KEY]]]);
    expect(f.statements[0].connection).toBe(f.connection);
    expect(f.destroyed).toEqual([]);
  });

  it('Postgres, held by another session: answers "held", issues no wait, and closes its session', async () => {
    const f = fakeDriver('postgres', () => ({ locked: false }));
    await expect(tryDatabaseSessionLock(f.driver, NAME)).resolves.toBe('held');
    expect(f.statements.map((s) => s.sql)).toEqual(['select pg_try_advisory_lock(?::bigint) as locked']);
    expect(f.destroyed).toEqual([f.connection]);
  });

  it('MySQL: GET_LOCK under the name with no wait; held answers "held"', async () => {
    const free = fakeDriver('mysql', () => ({ locked: 1 }));
    const lock = await tryDatabaseSessionLock(free.driver, NAME);
    expect(lock).not.toBe('held');
    expect(free.statements.map((s) => [s.sql, s.bindings])).toEqual([['select GET_LOCK(?, 0) as locked', [NAME]]]);
    const held = fakeDriver('mysql', () => ({ locked: 0 }));
    await expect(tryDatabaseSessionLock(held.driver, NAME)).resolves.toBe('held');
    expect(held.destroyed).toEqual([held.connection]);
  });

  it('a failed try is handed on as it is, its session closed — never read as "free" or "held"', async () => {
    const reset = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    const f = fakeDriver('postgres', () => reset);
    await expect(tryDatabaseSessionLock(f.driver, NAME)).rejects.toBe(reset);
    expect(f.destroyed).toEqual([f.connection]);
  });
});

describe('isHeld: a holder asks whether its session still stands', () => {
  it('probes the SAME session the lock was taken on, and reads true while it answers', async () => {
    const f = fakeDriver('postgres', () => ({ locked: true, held: 1 }));
    const lock = await tryDatabaseSessionLock(f.driver, NAME);
    if (lock === null || lock === 'held') throw new Error('expected a lock');
    await expect(lock.isHeld()).resolves.toBe(true);
    expect(f.statements.map((s) => s.sql)).toEqual(['select pg_try_advisory_lock(?::bigint) as locked', 'select 1 as held']);
    expect(new Set(f.statements.map((s) => s.connection))).toEqual(new Set([f.connection]));
  });

  it('reads false once the session is gone — the database released the lock with it — and never throws', async () => {
    let ended = false;
    const f = fakeDriver('postgres', (sql) => (sql === 'select 1 as held' && ended ? new Error('Connection terminated unexpectedly') : { locked: true, held: 1 }));
    const lock = await tryDatabaseSessionLock(f.driver, NAME);
    if (lock === null || lock === 'held') throw new Error('expected a lock');
    ended = true;
    await expect(lock.isHeld()).resolves.toBe(false);
  });

  it('reads false after release, without a statement', async () => {
    const f = fakeDriver('mysql', () => ({ locked: 1, held: 1 }));
    const lock = await tryDatabaseSessionLock(f.driver, NAME);
    if (lock === null || lock === 'held') throw new Error('expected a lock');
    await lock.release();
    const before = f.statements.length;
    await expect(lock.isHeld()).resolves.toBe(false);
    expect(f.statements).toHaveLength(before);
    expect(f.statements.map((s) => s.sql)).toEqual(['select GET_LOCK(?, 0) as locked', 'select RELEASE_LOCK(?)']);
  });
});

describe('acquireDatabaseSessionLock: a lock of another name waits and refuses in its own words', () => {
  it('contended: the caller\'s one wait line, then the bounded wait under the name\'s key', async () => {
    const f = fakeDriver('postgres', (sql) => (sql.startsWith('select pg_try') ? { locked: false } : {}));
    const onWait = vi.fn();
    const lock = await acquireDatabaseSessionLock(f.driver, { name: NAME, waitMs: 2_000, onWait, refuse: () => new Error('refused') });
    expect(lock).not.toBeNull();
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(f.statements.map((s) => [s.sql, s.bindings])).toEqual([
      ['select pg_try_advisory_lock(?::bigint) as locked', [KEY]],
      ['set lock_timeout = 2000', []],
      ['select pg_advisory_lock(?::bigint)', [KEY]],
    ]);
  });

  it('⛔ a wait that runs out throws the caller\'s refusal and closes the session', async () => {
    const timedOut = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    const f = fakeDriver('postgres', (sql) => (sql.startsWith('select pg_try') ? { locked: false } : sql.startsWith('select pg_advisory_lock') ? timedOut : {}));
    const refusal = new Error('the caller\'s refusal');
    await expect(acquireDatabaseSessionLock(f.driver, { name: NAME, waitMs: 1_000, onWait: () => {}, refuse: () => refusal })).rejects.toBe(refusal);
    expect(f.destroyed).toEqual([f.connection]);
  });

  it('MySQL: a wait that runs out throws the caller\'s refusal', async () => {
    let tries = 0;
    const f = fakeDriver('mysql', () => ({ locked: tries++ === 0 ? 0 : 0 }));
    const refusal = new Error('refused');
    await expect(acquireDatabaseSessionLock(f.driver, { name: NAME, waitMs: 1_000, onWait: () => {}, refuse: () => refusal })).rejects.toBe(refusal);
    expect(f.statements.map((s) => [s.sql, s.bindings])).toEqual([
      ['select GET_LOCK(?, 0) as locked', [NAME]],
      ['select GET_LOCK(?, ?) as locked', [NAME, 1]],
    ]);
  });
});
