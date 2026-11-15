// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A named database session lock: a Postgres advisory lock or a MySQL
 * `GET_LOCK`, on a connection of its own outside the driver's pool. Two named
 * locks ride on it, each with its own name and key:
 *
 *  - the schema-migration lock (`schema-migration-lock.ts`), one migrator per
 *    database at a time (#31598, #31715);
 *  - the audit seal lock (`@objectstack/plugin-audit`, ADR-0154 D3 as amended
 *    by seat ruling 6885005594), so a sealer pass and an
 *    `os migrate audit-* --apply` run never work on a sealed object at once.
 *
 * [ADR-0154 D3 amended] It lives HERE, below both callers, because the second
 * lock follows the first one's pattern exactly and ⛔ the dialect statements
 * are never copied: one module says how a session lock is taken, waited for,
 * probed and released on each dialect, and each named lock says only its name,
 * its wait and its words.
 *
 * Its own module, importing nothing but `node:crypto`, so the pins on it load
 * the lock and not the engine around it.
 */
import { createHash } from 'node:crypto';

/**
 * The Postgres advisory-lock key of a lock named `name`: the first 8 bytes of
 * SHA-256 of the name, as the signed 64-bit integer `pg_advisory_lock(bigint)`
 * takes. In `pg_locks` it appears with `locktype = 'advisory'`, its high 32
 * bits as `classid` and its low 32 as `objid`. A string, so no JavaScript
 * number rounds it on the way to the bind.
 *
 * ⛔ Never derived from anything but the name: every version that takes a lock
 * must take the SAME one, or an old and a new process run side by side.
 */
export function databaseSessionLockPgKey(name: string): string {
  return BigInt.asIntN(64, BigInt(`0x${createHash('sha256').update(name).digest('hex').slice(0, 16)}`)).toString();
}

/** The slice of knex the lock uses, typed structurally. */
interface LockKnex {
  client: {
    acquireRawConnection(): Promise<unknown>;
    destroyRawConnection(connection: unknown): Promise<void>;
  };
  raw(sql: string, bindings?: readonly unknown[]): { connection(connection: unknown): Promise<unknown> };
}

/** A held database session lock. `release()` is idempotent and never throws. */
export interface DatabaseSessionLock {
  release(): Promise<void>;
  /**
   * Whether the lock still stands: its session answers a probe on the very
   * connection it was taken on. A session that ended — a dropped connection,
   * a terminated backend — took the lock with it, so a probe that fails reads
   * `false`, never throws. Always `false` after `release()`.
   */
  isHeld(): Promise<boolean>;
}

/** The single row a lock statement answers, whichever client shaped the result. */
function lockRow(result: unknown): Record<string, unknown> | undefined {
  // pg answers `{ rows }`; mysql2 answers `[rows, fields]`.
  const rows = Array.isArray(result) ? result[0] : (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
}

/** A session opened for a lock named `name` on a Postgres or MySQL database. */
interface LockSession {
  readonly pg: boolean;
  run(sql: string, bindings: readonly unknown[]): Promise<Record<string, unknown> | undefined>;
  close(): Promise<void>;
  /** Try once, without waiting. */
  tryLock(): Promise<boolean>;
  held(): DatabaseSessionLock;
}

/**
 * Open a session for the lock named `name` on `driver`'s database, or `null`
 * when the lock does not apply there. Postgres and MySQL, by the driver's
 * `dialectName`; every other dialect, and a driver that names none, answers
 * `null`, runs no statement and never asks the driver for its Knex — SQLite
 * (and the Turso / WASM drivers on it) serializes writers in the database file
 * itself.
 *
 * The session is a connection of its own, opened through the driver's own
 * client (its configuration, credentials and TLS) but OUTSIDE its pool: both
 * locks are session-scoped, so the lock and its release must run on one
 * session, which a pool does not promise; a pooled connection idle past the
 * pool's reaper would be closed and the lock released with it; and a pool of
 * one would have none left for the work the lock guards. A session lock
 * excludes every other session on the database, so the guarded work's own
 * pooled connections are serialized by it all the same.
 */
async function openLockSession(driver: unknown, name: string): Promise<LockSession | null> {
  // [#31715] The dialect is the driver's own answer (`SqlDriver#dialectName`,
  // its one public "which SQL do I speak"), read BEFORE the driver is asked
  // for its Knex: a face that refuses to hand out Knex (the Turso remote
  // transport) throws from `getKnex()` rather than answering `undefined`, and
  // a dialect this lock does not cover must never reach that call. A Postgres
  // or MySQL driver whose Knex cannot be handed out still throws here, loudly.
  const dialect = (driver as { dialectName?: unknown } | null)?.dialectName;
  if (dialect !== 'postgres' && dialect !== 'mysql') return null;
  const knex = (driver as { getKnex?: () => LockKnex }).getKnex?.();
  if (!knex) return null;
  const pg = dialect === 'postgres';
  const pgKey = pg ? databaseSessionLockPgKey(name) : '';
  const connection = await knex.client.acquireRawConnection();
  const run = async (sql: string, bindings: readonly unknown[]): Promise<Record<string, unknown> | undefined> =>
    lockRow(await knex.raw(sql, bindings).connection(connection));
  const close = async (): Promise<void> => {
    try { await knex.client.destroyRawConnection(connection); } catch { /* closing releases the lock anyway */ }
  };
  return {
    pg,
    run,
    close,
    async tryLock() {
      const tried = pg
        ? await run('select pg_try_advisory_lock(?::bigint) as locked', [pgKey])
        : await run('select GET_LOCK(?, 0) as locked', [name]);
      return tried?.locked === true || Number(tried?.locked) === 1;
    },
    held() {
      let held = true;
      return {
        release: async () => {
          if (!held) return;
          held = false;
          try {
            if (pg) await run('select pg_advisory_unlock(?::bigint)', [pgKey]);
            else await run('select RELEASE_LOCK(?)', [name]);
          } catch { /* closing the session below releases it */ }
          await close();
        },
        isHeld: async () => {
          if (!held) return false;
          try {
            await run('select 1 as held', []);
            return true;
          } catch {
            return false;
          }
        },
      };
    },
  };
}

/**
 * Take the lock named `name` on `driver`'s database if it is free, once,
 * never waiting and never printing: the lock, `'held'` when another session
 * holds it (this session is closed again), or `null` when the database offers
 * no session lock ({@link openLockSession}). A statement that fails is handed
 * on as it is, the session closed — never read as free or as held.
 */
export async function tryDatabaseSessionLock(driver: unknown, name: string): Promise<DatabaseSessionLock | 'held' | null> {
  const session = await openLockSession(driver, name);
  if (!session) return null;
  let locked: boolean;
  try {
    locked = await session.tryLock();
  } catch (error) {
    await session.close();
    throw error;
  }
  if (!locked) {
    await session.close();
    return 'held';
  }
  return session.held();
}

/** How a waiting lock speaks: its one wait line and its refusal are the caller's words. */
export interface DatabaseSessionLockWait {
  /** The lock's name: MySQL's `GET_LOCK` name, and the source of its Postgres key. */
  readonly name: string;
  /** How long to wait for another session to let go before refusing. */
  readonly waitMs: number;
  /** Called once, when the lock is found held and the wait begins. */
  onWait(): void;
  /** The error thrown when the wait runs out; this run then did nothing under the lock. */
  refuse(): Error;
}

/**
 * Take the lock named `wait.name` on `driver`'s database, waiting up to
 * `wait.waitMs` for another session to let go, or `null` when the database
 * offers no session lock ({@link openLockSession}).
 *
 * Uncontended, it is silent: one statement, no output. Contended, it calls
 * `onWait` ONCE, then waits up to `waitMs` and throws `refuse()` on timeout.
 * Any other failure is handed on as it is. Either way the session is closed.
 */
export async function acquireDatabaseSessionLock(driver: unknown, wait: DatabaseSessionLockWait): Promise<DatabaseSessionLock | null> {
  const session = await openLockSession(driver, wait.name);
  if (!session) return null;
  const { pg, run } = session;
  const { waitMs } = wait;
  try {
    if (!(await session.tryLock())) {
      wait.onWait();
      if (pg) {
        await run(`set lock_timeout = ${Math.max(1, Math.trunc(waitMs))}`, []);
        try {
          await run('select pg_advisory_lock(?::bigint)', [databaseSessionLockPgKey(wait.name)]);
        } catch (error) {
          // 55P03 lock_not_available: `lock_timeout` ran out.
          if ((error as { code?: unknown } | null)?.code === '55P03') throw wait.refuse();
          throw error;
        }
      } else {
        // GET_LOCK answers 1 (taken), 0 (timed out) or NULL (an error).
        const waited = await run('select GET_LOCK(?, ?) as locked', [wait.name, Math.max(1, Math.ceil(waitMs / 1000))]);
        if (Number(waited?.locked) !== 1) throw wait.refuse();
      }
    }
  } catch (error) {
    await session.close();
    throw error;
  }
  return session.held();
}
