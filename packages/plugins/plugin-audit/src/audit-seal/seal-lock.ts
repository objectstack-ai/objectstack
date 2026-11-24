// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  acquireDatabaseSessionLock,
  databaseSessionLockPgKey,
  tryDatabaseSessionLock,
  type DatabaseSessionLock,
} from '@objectstack/objectql';

/**
 * ADR-0154 D3 as amended (seat ruling 6885005594, E + B) — the audit seal
 * lock: a database session lock, so a sealer pass and an
 * `os migrate audit-* --apply` run never work on a sealed object at once. The
 * sealer and a migration share the database on every topology, so the two
 * exclude each other with no cluster driver; the cluster lock `audit.sealer`
 * and the unique `(sealed_object, chain_key, sequence)` index stay as they are.
 *
 * It rides on `@objectstack/objectql`'s database session lock, the pattern of
 * the schema-migration lock: a Postgres advisory lock or a MySQL `GET_LOCK`,
 * on a connection of its own outside the pool. It is taken on the datasource
 * that holds the audit rows — each sealed object's hot store, which is not the
 * primary where the object routes elsewhere — by both sides:
 *
 *  - **The sealer** try-locks it on every pass, beside `audit.sealer`, and
 *    skips the pass while another session holds it (`sealer.ts`).
 *  - **A migration** holds it for its whole run ({@link holdAuditSealLock}):
 *    it waits up to {@link AUDIT_SEAL_LOCK_WAIT_MS}, then refuses.
 *  - **B, the residual.** Where the database offers no session lock (SQLite,
 *    Turso, every dialect but Postgres and MySQL), an `--apply` run on an
 *    object declaring `lifecycle.seal` is refused unless the operator passes
 *    `--sealer-stopped`.
 *
 * ⛔ Red line: never take a lock that excludes nothing and then proceed
 * silently. Where no lock can be taken, the run says so and refuses, or goes
 * ahead only on the operator's explicit word, and says that too.
 */

/**
 * The one name the sealer and every migration lock on. ⛔ Never derived from
 * the database name, the project or the release: every version that can seal
 * or rewrite a sealed object must take the SAME lock, or a rolling upgrade runs
 * an old migration beside a new sealer. The unit pin holds its key to its value
 * for that reason.
 */
export const AUDIT_SEAL_LOCK_NAME = 'objectstack:audit-seal';

/** Its Postgres advisory-lock key (`databaseSessionLockPgKey`). */
export const AUDIT_SEAL_PG_LOCK_KEY = databaseSessionLockPgKey(AUDIT_SEAL_LOCK_NAME);

/**
 * How long an `--apply` run waits for a sealer pass (or another run) to let
 * go before it refuses: ten minutes, the schema-migration lock's own wait. It
 * outlasts a normal sealer pass by orders of magnitude (seat ruling item 6): a
 * pass in step with the clock seals the one window newly due and re-counts the
 * late horizon, a few hundred reads; a backlog pass is cut at
 * `MAX_WINDOWS_PER_PASS` windows of at most `AUDIT_SEAL_MAX_LEAVES` leaves per
 * checkpoint, and the passes after it follow at once — between two of them the
 * lock is free, and the waiting run takes it. No environment override.
 */
export const AUDIT_SEAL_LOCK_WAIT_MS = 10 * 60_000;

/**
 * The four rewrites that hold the lock, spelled as an operator types them, for
 * the lines that tell an operator what else may hold it. Each is a full
 * command id, so `check:cli-command-ids` holds every one to a real command.
 */
export const AUDIT_SEAL_LOCK_REWRITE_COMMANDS =
  '`os migrate audit-key-material`, `os migrate audit-mail-bodies`, `os migrate audit-metadata-bodies` or ' +
  '`os migrate audit-side-copies`';

/** The engine surface a hold reads: which objects are sealed, and where each one's rows live. */
export interface AuditSealLockEngine {
  registry: { getAllObjects(): ReadonlyArray<{ name: string; lifecycle?: unknown }> };
  getDriverForObject(name: string): unknown;
}

export interface AuditSealLockHoldOptions {
  /** The objects the run rewrites, hot. A sealed one's archive rows are covered by the lock on its hot store. */
  readonly objects: readonly string[];
  /** The operator's `--sealer-stopped`: their word that no sealer runs against the database. */
  readonly sealerStopped: boolean;
  /** Where the hold's one line goes: the wait, or the run going ahead on `--sealer-stopped`. */
  warn(line: string): void;
  /** Test seam: a shorter wait. The command never passes it. */
  readonly waitMs?: number;
}

/** What {@link AuditSealLockHold.finish} found. */
export type AuditSealLockFinish = { readonly lost: false } | { readonly lost: true; readonly line: string };

export interface AuditSealLockHold {
  /**
   * Let every lock of the hold go, once the run's last write is done, and say
   * whether each one still stood at that moment: a lock whose session ended
   * mid-run (a dropped connection) excluded nothing from then on.
   *
   * A stalled connection cannot hang it: the probe, the release and the close
   * of each lock are bounded (`DATABASE_SESSION_LOCK_ANSWER_MS` in
   * `@objectstack/objectql`), and a session that does not answer the probe in
   * time is a lost lock, reported as one that ended is.
   */
  finish(): Promise<AuditSealLockFinish>;
}

/** Whether `object` declares `lifecycle.seal` in `engine`'s registry. */
function sealedObjects(engine: AuditSealLockEngine, objects: readonly string[]): string[] {
  const sealed = new Set<string>();
  for (const o of engine.registry.getAllObjects()) {
    if ((o.lifecycle as { seal?: unknown } | undefined)?.seal) sealed.add(o.name);
  }
  return objects.filter((name) => sealed.has(name));
}

/** `'a', 'b'` for a line. */
const named = (objects: readonly string[]): string => objects.map((o) => `'${o}'`).join(', ');

/**
 * `objects` grouped by the driver that holds each one's hot rows. A group is a
 * datasource, not yet a database: two datasources can reach one lock
 * namespace — one Postgres database, or two schemas of one MySQL server, whose
 * `GET_LOCK` names are server-wide — and there they share ONE lock, the one
 * this run or pass took first ({@link LockCover}).
 */
function byDriver(engine: AuditSealLockEngine, objects: readonly string[]): Map<unknown, string[]> {
  const groups = new Map<unknown, string[]>();
  for (const object of objects) {
    const driver = engine.getDriverForObject(object);
    groups.set(driver, [...(groups.get(driver) ?? []), object]);
  }
  return groups;
}

/**
 * The locks one run or pass holds, each with the objects it covers. Every lock
 * is taken with the ones before it as `ownLocks`, so a datasource whose
 * database another datasource of the same run already locked is answered that
 * lock, never `'held'`: a run or pass never contends with itself (review
 * 6894679963 M1). Covering more than one datasource, a lock is still one
 * session, released once.
 */
class LockCover {
  private readonly covered = new Map<DatabaseSessionLock, string[]>();

  /** The locks taken so far: the `ownLocks` of the next. */
  get own(): DatabaseSessionLock[] {
    return [...this.covered.keys()];
  }

  add(lock: DatabaseSessionLock, objects: readonly string[]): void {
    this.covered.set(lock, [...(this.covered.get(lock) ?? []), ...objects]);
  }

  entries(): Array<{ objects: string[]; lock: DatabaseSessionLock }> {
    return [...this.covered].map(([lock, objects]) => ({ objects, lock }));
  }

  async releaseAll(): Promise<void> {
    for (const lock of this.covered.keys()) await lock.release();
  }
}

/**
 * Hold the audit seal lock for an `os migrate audit-* --apply` run (E), on
 * each database that holds the hot rows of a sealed object the run rewrites;
 * call it before the run's first write and {@link AuditSealLockHold.finish}
 * after its last. A run whose objects declare no `lifecycle.seal` takes no
 * lock: no sealer pass reads its rows, so there is nothing to exclude.
 *
 * Each database is locked once, however many of the run's datasources reach
 * it ({@link LockCover}). Contended, it says so once through `warn` and waits
 * up to {@link AUDIT_SEAL_LOCK_WAIT_MS}, then refuses. Where a sealed object's
 * database offers no session lock (B), the run is refused unless
 * `sealerStopped` — before any wait on another database — and with it the run
 * goes ahead and says on whose word. Every refusal comes before anything is
 * written, and lets go of every lock the hold had already taken.
 */
export async function holdAuditSealLock(engine: AuditSealLockEngine, options: AuditSealLockHoldOptions): Promise<AuditSealLockHold> {
  const waitMs = options.waitMs ?? AUDIT_SEAL_LOCK_WAIT_MS;
  const cover = new LockCover();
  const contended: Array<[unknown, string[]]> = [];
  const unlocked: string[] = [];
  const refuseUnlocked = (): void => {
    if (unlocked.length === 0 || options.sealerStopped) return;
    throw new Error(
      `Refusing to rewrite ${named(unlocked)}: ${unlocked.length === 1 ? 'it declares' : 'they declare'} ` +
        'lifecycle.seal, and the database that holds its rows offers no session lock to exclude the audit sealer ' +
        'with (only Postgres and MySQL do), so a sealer pass of a running server could seal a row while this run ' +
        'rewrites it. Stop every server that seals this database, then re-run with --sealer-stopped. ' +
        'This run changed nothing.',
    );
  };
  try {
    // First one try on every database, never waiting: a database that offers no lock is refused (B) before
    // any wait on another, and a database another datasource of this run already locked is found covered.
    for (const [driver, objects] of byDriver(engine, sealedObjects(engine, options.objects))) {
      const lock = await tryDatabaseSessionLock(driver, AUDIT_SEAL_LOCK_NAME, { ownLocks: cover.own });
      if (lock === null) unlocked.push(...objects);
      else if (lock === 'held') contended.push([driver, objects]);
      else cover.add(lock, objects);
    }
    refuseUnlocked();
    // Then the wait, where another session holds it.
    for (const [driver, objects] of contended) {
      const where = `the database of ${named(objects)}`;
      const lock = await acquireDatabaseSessionLock(driver, {
        name: AUDIT_SEAL_LOCK_NAME,
        waitMs,
        ownLocks: cover.own,
        onWait: () => options.warn(
          `A sealer pass or another run of ${AUDIT_SEAL_LOCK_REWRITE_COMMANDS} holds the audit seal lock on ${where}; ` +
            `waiting up to ${Math.ceil(waitMs / 1000)} s for it to finish…`,
        ),
        refuse: () => new Error(
          `Refusing to rewrite ${named(objects)}: a sealer pass or another run of ${AUDIT_SEAL_LOCK_REWRITE_COMMANDS} ` +
            `still held the audit seal lock ('${AUDIT_SEAL_LOCK_NAME}') on ${where} after ${waitMs} ms, so this run ` +
            'changed nothing. Run it again once that has finished.',
        ),
      });
      if (lock) cover.add(lock, objects);
      else unlocked.push(...objects);
    }
    refuseUnlocked();
  } catch (error) {
    await cover.releaseAll();
    throw error;
  }
  if (unlocked.length > 0) {
    options.warn(
      `--sealer-stopped: ${named(unlocked)} ${unlocked.length === 1 ? 'is' : 'are'} rewritten without the audit seal ` +
        'lock, which the database that holds its rows cannot take — on your word that no server seals it while this ' +
        'run lasts.',
    );
  }
  return {
    async finish() {
      const lost: string[] = [];
      for (const { objects, lock } of cover.entries()) {
        if (!(await lock.isHeld())) lost.push(...objects);
        await lock.release();
      }
      if (lost.length === 0) return { lost: false };
      return {
        lost: true,
        line:
          `The audit seal lock on the database of ${named(lost)} was lost during this run (its database session ` +
          'ended, or stopped answering), so a sealer pass may have sealed a row this run rewrote. Run ' +
          '`os audit verify`: a row it reports modified was rewritten under such a pass.',
      };
    },
  };
}

/** What a sealer pass got when it try-locked the audit seal lock on its sealed objects' databases. */
export type AuditSealPassLocks =
  | { readonly held: true; readonly objects: readonly string[] }
  | { readonly held: false; readonly locks: ReadonlyArray<{ readonly objects: readonly string[]; readonly lock: DatabaseSessionLock }> };

/**
 * A sealer pass's try (E): the audit seal lock on each database that holds the
 * hot rows of `objects`, once, never waiting, and once per database however
 * many datasources reach it ({@link LockCover}). `held` names the objects of
 * the first database where another session holds it — every lock already taken is
 * let go again, and the pass is skipped. A database that offers no session
 * lock adds none: there, B is the migrations' to enforce. A failure to try is
 * handed on, every lock already taken let go.
 */
export async function trySealPassLocks(engine: Pick<AuditSealLockEngine, 'getDriverForObject'>, objects: readonly string[]): Promise<AuditSealPassLocks> {
  const cover = new LockCover();
  try {
    for (const [driver, group] of byDriver(engine as AuditSealLockEngine, objects)) {
      const lock = driver === undefined ? null : await tryDatabaseSessionLock(driver, AUDIT_SEAL_LOCK_NAME, { ownLocks: cover.own });
      if (lock === 'held') {
        await cover.releaseAll();
        return { held: true, objects: group };
      }
      if (lock) cover.add(lock, group);
    }
  } catch (error) {
    await cover.releaseAll();
    throw error;
  }
  return { held: false, locks: cover.entries() };
}
