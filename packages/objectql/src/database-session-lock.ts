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
import { createHash, randomUUID } from 'node:crypto';

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

/**
 * The options of a lock that one run takes on several datasources under one
 * name ({@link tryDatabaseSessionLock}, {@link acquireDatabaseSessionLock}).
 */
export interface DatabaseSessionLockRunOptions {
  /**
   * The locks of the same name this run already holds on other datasources,
   * each taken with this option too. Passing it — empty for the run's first —
   * marks the new session as the run's, so that a later lock of the run can
   * tell it from another holder.
   *
   * Two datasources can reach one lock namespace: a Postgres advisory lock is
   * database-wide and a MySQL `GET_LOCK` name server-wide, so two datasources
   * on one Postgres database, or on two schemas of one MySQL server, share the
   * lock while each opens its own session. Without this, the run's second
   * session finds the lock held — by the run's first — and the run contends
   * with itself for good. With it, a lock found held is first checked against
   * these: when one of them holds it in the same namespace, the new session is
   * closed and THAT lock is answered, the database already being under it.
   * The check proves the namespace and never guesses it (see `heldAmong`), so
   * a holder it cannot prove its own is contention, as before.
   */
  readonly ownLocks?: readonly DatabaseSessionLock[];
}

/**
 * The marker a session of a run holds beside its named lock: a second session
 * lock under a name no other session can know. Seen held from another
 * session, it proves that session shares the marked session's namespace.
 */
interface LockMarker {
  readonly name: string;
  readonly pgKey: string;
}

/** The marker of each lock taken with {@link DatabaseSessionLockRunOptions.ownLocks}. */
const markers = new WeakMap<DatabaseSessionLock, LockMarker>();

/** A Postgres key's `classid` and `objid` in `pg_locks`: its high and low 32 bits, unsigned. */
function pgLockHalves(pgKey: string): [string, string] {
  const unsigned = BigInt.asUintN(64, BigInt(pgKey));
  return [(unsigned >> 32n).toString(), (unsigned & 0xffffffffn).toString()];
}

/**
 * Whether the session that holds a marker (its key's two halves, granted in
 * the CURRENT database) also holds the named lock (its two halves) there.
 */
const PG_HELD_BY_MARKED =
  'select exists (select 1 from pg_locks m join pg_locks l on l.pid = m.pid and l.database = m.database ' +
  "where m.locktype = 'advisory' and m.granted and m.objsubid = 1 " +
  'and m.database = (select oid from pg_database where datname = current_database()) ' +
  'and m.classid::bigint = ?::bigint and m.objid::bigint = ?::bigint ' +
  "and l.locktype = 'advisory' and l.granted and l.objsubid = 1 " +
  'and l.classid::bigint = ?::bigint and l.objid::bigint = ?::bigint) as seen';

/** The same on MySQL, server-wide: the connection holding the marker holds the named lock (`NULL` when either is free). */
const MYSQL_HELD_BY_MARKED = 'select IS_USED_LOCK(?) = IS_USED_LOCK(?) as seen';

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
  /**
   * Take this session's marker, BEFORE its named lock: a MySQL older than
   * 5.7.5 keeps one `GET_LOCK` per session and lets the earlier go, so there
   * the marker is the one dropped — the run then reads its own lock as
   * contention, as without markers — and never the named lock. `null` when
   * the marker could not be taken; the lock is then simply unmarked.
   */
  mark(): Promise<LockMarker | null>;
  /** The lock of `own` whose session this session sees holding the named lock here: it already covers this namespace. */
  heldAmong(own: readonly DatabaseSessionLock[]): Promise<DatabaseSessionLock | undefined>;
  held(marker: LockMarker | null): DatabaseSessionLock;
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
    async mark() {
      // A name of its own per session, the same length every time (MySQL caps a name at 64 characters).
      const marker = { name: `objectstack:lock-session:${randomUUID()}`, pgKey: '' };
      marker.pgKey = databaseSessionLockPgKey(marker.name);
      const tried = pg
        ? await run('select pg_try_advisory_lock(?::bigint) as marked', [marker.pgKey])
        : await run('select GET_LOCK(?, 0) as marked', [marker.name]);
      return tried?.marked === true || Number(tried?.marked) === 1 ? marker : null;
    },
    async heldAmong(own) {
      // Exact, never a guess: the database itself answers that the session holding the named lock in
      // THIS namespace holds the marker only `lock`'s session took — on Postgres in this database
      // (`pg_locks` lists every database of the cluster), on MySQL on this server. Session ids are never
      // compared across sessions of the run: two servers number their sessions alike.
      for (const lock of own) {
        const marker = markers.get(lock);
        if (!marker) continue;
        const seen = pg
          ? await run(PG_HELD_BY_MARKED, [...pgLockHalves(marker.pgKey), ...pgLockHalves(pgKey)])
          : await run(MYSQL_HELD_BY_MARKED, [marker.name, name]);
        if (seen?.seen === true || Number(seen?.seen) === 1) return lock;
      }
      return undefined;
    },
    held(marker) {
      let held = true;
      const lock: DatabaseSessionLock = {
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
      if (marker) markers.set(lock, marker);
      return lock;
    },
  };
}

/**
 * Take the lock named `name` on `driver`'s database if it is free, once,
 * never waiting and never printing: the lock, `'held'` when another session
 * holds it (this session is closed again), or `null` when the database offers
 * no session lock ({@link openLockSession}). With `options.ownLocks`, a lock
 * found held by one of those in this database's namespace answers that lock
 * ({@link DatabaseSessionLockRunOptions}). A statement that fails is handed
 * on as it is, the session closed — never read as free or as held.
 */
export async function tryDatabaseSessionLock(
  driver: unknown,
  name: string,
  options: DatabaseSessionLockRunOptions = {},
): Promise<DatabaseSessionLock | 'held' | null> {
  const session = await openLockSession(driver, name);
  if (!session) return null;
  let marker: LockMarker | null = null;
  let own: DatabaseSessionLock | undefined;
  let locked: boolean;
  try {
    if (options.ownLocks) marker = await session.mark();
    locked = await session.tryLock();
    if (!locked && options.ownLocks) own = await session.heldAmong(options.ownLocks);
  } catch (error) {
    await session.close();
    throw error;
  }
  if (!locked) {
    await session.close();
    return own ?? 'held';
  }
  return session.held(marker);
}

/** How a waiting lock speaks: its one wait line and its refusal are the caller's words. */
export interface DatabaseSessionLockWait extends DatabaseSessionLockRunOptions {
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
 * offers no session lock ({@link openLockSession}). With `wait.ownLocks`, a
 * lock found held by one of those in this database's namespace answers that
 * lock at once, with no wait and no line ({@link DatabaseSessionLockRunOptions}).
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
  let marker: LockMarker | null = null;
  try {
    if (wait.ownLocks) marker = await session.mark();
    if (!(await session.tryLock())) {
      const own = wait.ownLocks ? await session.heldAmong(wait.ownLocks) : undefined;
      if (own) {
        await session.close();
        return own;
      }
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
  return session.held(marker);
}
