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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  acquireDatabaseSessionLock,
  DATABASE_SESSION_LOCK_ANSWER_MS,
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

describe('ownLocks: a run that locks several datasources never contends with itself (review 6894679963 M1)', () => {
  /** A key's `pg_locks` `classid` and `objid`: its high and low 32 bits, unsigned. */
  const halves = (key: string) => {
    const unsigned = BigInt.asUintN(64, BigInt(key));
    return [(unsigned >> 32n).toString(), (unsigned & 0xffffffffn).toString()];
  };
  const SEEN_PG = /^select exists \(select 1 from pg_locks m join pg_locks l on l\.pid = m\.pid and l\.database = m\.database where /;

  it('without it, no marker: the schema-migration lock\'s statements are unchanged', async () => {
    const f = fakeDriver('postgres', () => ({ locked: false }));
    await expect(tryDatabaseSessionLock(f.driver, NAME)).resolves.toBe('held');
    expect(f.statements.map((s) => s.sql)).toEqual(['select pg_try_advisory_lock(?::bigint) as locked']);
  });

  it('Postgres: the run\'s session takes a marker of its own before the lock; a later session finding the lock held asks whether the marked session holds it in THIS database, and answers that lock', async () => {
    const first = fakeDriver('postgres', (sql) => (sql.endsWith('as marked') ? { marked: true } : { locked: true }));
    const own = await tryDatabaseSessionLock(first.driver, NAME, { ownLocks: [] });
    const [mark, lock] = first.statements;
    expect([mark.sql, lock.sql]).toEqual(['select pg_try_advisory_lock(?::bigint) as marked', 'select pg_try_advisory_lock(?::bigint) as locked']);
    const markerKey = String(mark.bindings[0]);
    expect(markerKey).not.toBe(KEY);

    const second = fakeDriver('postgres', (sql) => (sql.endsWith('as marked') ? { marked: true } : SEEN_PG.test(sql) ? { seen: true } : { locked: false }));
    await expect(tryDatabaseSessionLock(second.driver, NAME, { ownLocks: [own as never] })).resolves.toBe(own);
    const seen = second.statements.find((s) => SEEN_PG.test(s.sql))!;
    expect(seen.sql).toContain('m.database = (select oid from pg_database where datname = current_database())');
    expect(seen.bindings).toEqual([...halves(markerKey), ...halves(KEY)]);
    expect(second.destroyed).toEqual([second.connection]);
  });

  it('⛔ a held lock the marked session does not hold is contention, as before: "held", and the wait for acquire', async () => {
    const first = fakeDriver('postgres', (sql) => (sql.endsWith('as marked') ? { marked: true } : { locked: true }));
    const own = await tryDatabaseSessionLock(first.driver, NAME, { ownLocks: [] });
    const other = fakeDriver('postgres', (sql) => (sql.endsWith('as marked') ? { marked: true } : SEEN_PG.test(sql) ? { seen: false } : { locked: false }));
    await expect(tryDatabaseSessionLock(other.driver, NAME, { ownLocks: [own as never] })).resolves.toBe('held');
    const timedOut = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    const waiting = fakeDriver('postgres', (sql) =>
      sql.endsWith('as marked') ? { marked: true } : SEEN_PG.test(sql) ? { seen: false } : sql.startsWith('select pg_try') ? { locked: false } : sql.startsWith('select pg_advisory_lock') ? timedOut : {});
    const onWait = vi.fn();
    const refusal = new Error('refused');
    await expect(acquireDatabaseSessionLock(waiting.driver, { name: NAME, waitMs: 1_000, onWait, refuse: () => refusal, ownLocks: [own as never] }))
      .rejects.toBe(refusal);
    expect(onWait).toHaveBeenCalledTimes(1);
  });

  it('MySQL: the connection holding the run\'s marker holds the name, server-wide — acquire answers the run\'s lock with no wait and no line', async () => {
    const first = fakeDriver('mysql', (sql) => (sql.endsWith('as marked') ? { marked: 1 } : { locked: 1 }));
    const own = await tryDatabaseSessionLock(first.driver, NAME, { ownLocks: [] });
    const markerName = String(first.statements[0].bindings[0]);
    expect(first.statements[0].sql).toBe('select GET_LOCK(?, 0) as marked');
    expect(markerName.length).toBeLessThanOrEqual(64);
    const second = fakeDriver('mysql', (sql) => (sql.endsWith('as marked') ? { marked: 1 } : sql.endsWith('as seen') ? { seen: 1 } : { locked: 0 }));
    const onWait = vi.fn();
    await expect(acquireDatabaseSessionLock(second.driver, { name: NAME, waitMs: 1_000, onWait, refuse: () => new Error('no'), ownLocks: [own as never] }))
      .resolves.toBe(own);
    expect(second.statements.map((s) => [s.sql, s.bindings]).slice(1)).toEqual([
      ['select GET_LOCK(?, 0) as locked', [NAME]],
      ['select IS_USED_LOCK(?) = IS_USED_LOCK(?) as seen', [markerName, NAME]],
    ]);
    expect(onWait).not.toHaveBeenCalled();
    expect(second.destroyed).toEqual([second.connection]);
  });
});

describe('a stalled session never hangs its holder: the probe, the release and the close each time out (ADR-0154 D3 amended)', () => {
  // A connection stalled half-open — no reply and no reset — never fails a statement: it never answers at all.
  const NEVER = () => new Promise<never>(() => {});

  /** A fake Knex whose session answers until `stall` names a step, and then never answers that step again. */
  function stallingDriver(dialect: 'postgres' | 'mysql') {
    const stall = { probe: false, unlock: false, close: false };
    const statements: string[] = [];
    const closes: unknown[] = [];
    const connection = { id: 'raw-stall' };
    const shape = (row: unknown) => (dialect === 'mysql' ? [[row], []] : { rows: [row] });
    const knex = {
      client: {
        acquireRawConnection: async () => connection,
        destroyRawConnection: (c: unknown) => { closes.push(c); return stall.close ? NEVER() : Promise.resolve(); },
      },
      raw: (sql: string) => ({
        connection: (): Promise<unknown> => {
          statements.push(sql);
          if (sql === 'select 1 as held' && stall.probe) return NEVER();
          if (/unlock|RELEASE_LOCK/.test(sql) && stall.unlock) return NEVER();
          return Promise.resolve(shape({ locked: dialect === 'mysql' ? 1 : true, held: 1 }));
        },
      }),
    };
    return { driver: { dialectName: dialect, getKnex: () => knex }, stall, statements, closes, connection };
  }

  /** Settle `step` on a fake clock: what it answered by `ms` from now, or the string 'still waiting'. */
  async function answerWithin<T>(step: Promise<T>, ms: number): Promise<T | 'still waiting'> {
    let answer: T | 'still waiting' = 'still waiting';
    void step.then((value) => { answer = value; });
    await vi.advanceTimersByTimeAsync(ms);
    return answer;
  }

  async function heldLock(dialect: 'postgres' | 'mysql') {
    const f = stallingDriver(dialect);
    const lock = await tryDatabaseSessionLock(f.driver, NAME);
    if (lock === null || lock === 'held') throw new Error('expected a lock');
    return { ...f, lock };
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('the bound is a few seconds: three orders of magnitude over a live session\'s answer, far short of a hang', () => {
    expect(DATABASE_SESSION_LOCK_ANSWER_MS).toBe(10_000);
  });

  for (const dialect of ['postgres', 'mysql'] as const) {
    it(`${dialect}: a probe the session never answers reads false — the lock is lost — once the bound runs out, and is never sent again`, async () => {
      const f = await heldLock(dialect);
      f.stall.probe = true;
      const probe = f.lock.isHeld();
      expect(await answerWithin(probe, DATABASE_SESSION_LOCK_ANSWER_MS - 1)).toBe('still waiting');
      expect(await answerWithin(probe, 1)).toBe(false);
      const sent = f.statements.length;
      expect(await answerWithin(f.lock.isHeld(), 0)).toBe(false);
      expect(f.statements).toHaveLength(sent);
    });
  }

  it('a release after a probe that timed out sends no unlock to the stalled session: it closes it, and that close is bounded too', async () => {
    const f = await heldLock('postgres');
    f.stall.probe = true;
    f.stall.close = true;
    expect(await answerWithin(f.lock.isHeld(), DATABASE_SESSION_LOCK_ANSWER_MS)).toBe(false);
    expect(await answerWithin(f.lock.release(), DATABASE_SESSION_LOCK_ANSWER_MS)).toBeUndefined();
    expect(f.statements.filter((sql) => /unlock/.test(sql))).toEqual([]);
    expect(f.closes).toEqual([f.connection]);
  });

  for (const dialect of ['postgres', 'mysql'] as const) {
    it(`${dialect}: an unlock the session never answers gives up once the bound runs out, and the session is closed — closing releases the lock`, async () => {
      const f = await heldLock(dialect);
      f.stall.unlock = true;
      const release = f.lock.release();
      expect(await answerWithin(release, DATABASE_SESSION_LOCK_ANSWER_MS - 1)).toBe('still waiting');
      expect(f.closes).toEqual([]);
      expect(await answerWithin(release, 1)).toBeUndefined();
      expect(f.statements.at(-1)).toBe(dialect === 'postgres' ? 'select pg_advisory_unlock(?::bigint)' : 'select RELEASE_LOCK(?)');
      expect(f.closes).toEqual([f.connection]);
      await expect(f.lock.isHeld()).resolves.toBe(false);
    });
  }

  it('a close the connection never finishes gives up once the bound runs out: release resolves, and never throws', async () => {
    const f = await heldLock('postgres');
    f.stall.close = true;
    const release = f.lock.release();
    expect(await answerWithin(release, DATABASE_SESSION_LOCK_ANSWER_MS - 1)).toBe('still waiting');
    expect(f.closes).toEqual([f.connection]);
    expect(await answerWithin(release, 1)).toBeUndefined();
  });

  it('a live session is unchanged: the probe reads true, the release unlocks and closes, with no time passing', async () => {
    const f = await heldLock('postgres');
    expect(await answerWithin(f.lock.isHeld(), 0)).toBe(true);
    expect(await answerWithin(f.lock.release(), 0)).toBeUndefined();
    expect(f.statements).toEqual(['select pg_try_advisory_lock(?::bigint) as locked', 'select 1 as held', 'select pg_advisory_unlock(?::bigint)']);
    expect(f.closes).toEqual([f.connection]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
