// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The schema-migration lock: one migrator per database at a time. Taken by
 * `bootSchemaStack` (`@objectstack/cli`, `os migrate apply`) on a boot that can
 * apply (#31598), and by `ObjectQLPlugin.start()` around the schema sync of
 * every other boot, a server's and an `OS_MIGRATE_AND_EXIT=1` job's (#31715).
 *
 * [#31715] It lives HERE, not in the CLI, because the engine's boot takes it
 * and `@objectstack/objectql` cannot import `@objectstack/cli` (the CLI
 * depends on this package). This is the lowest package that holds a caller of
 * the lock; the CLI re-exports it from `utils/schema-migration-lock.ts`. One
 * module, one name, one key: ⛔ never a second copy.
 *
 * [ADR-0154 D3 amended] How a session lock is taken, waited for and released
 * on each dialect is `database-session-lock.ts`'s, which the audit seal lock
 * rides on too; this module says only this lock's name, key, wait and words.
 * It imports nothing but that module, so the pins on it load the lock and not
 * the migration stack around it.
 */
import { acquireDatabaseSessionLock, databaseSessionLockPgKey } from './database-session-lock.js';

/**
 * The one name every migrator locks on (#31598): two `os migrate apply` runs
 * against one database — one per pod, from an init container on each replica —
 * otherwise both read the same pending work and both perform it. Measured on
 * Postgres before this lock: three concurrent applies against one fresh
 * database each reported creating tables (82 + 86 + 37 for 86 tables), and the
 * third applied drift on tables the others were still creating.
 *
 * ⛔ Never derived from the database name, the project or the release: every
 * version that can migrate this database — CLI or server — must take the SAME
 * lock, or a rolling upgrade runs an old and a new migrator side by side. The unit pin
 * holds the derived Postgres key to its value for that reason.
 */
export const SCHEMA_MIGRATION_LOCK_NAME = 'objectstack:schema-migrate';

/**
 * The Postgres advisory-lock key: the first 8 bytes of SHA-256 of
 * {@link SCHEMA_MIGRATION_LOCK_NAME}, as the signed 64-bit integer
 * `pg_advisory_lock(bigint)` takes. In `pg_locks` it appears with `locktype =
 * 'advisory'`, its high 32 bits as `classid` and its low 32 as `objid`.
 * A string, so no JavaScript number rounds it on the way to the bind.
 */
export const SCHEMA_MIGRATION_PG_LOCK_KEY = databaseSessionLockPgKey(SCHEMA_MIGRATION_LOCK_NAME);

/**
 * How long a migrator waits for another to finish before it refuses. No
 * environment override: none exists for migration timeouts to follow.
 */
export const SCHEMA_MIGRATION_LOCK_WAIT_MS = 10 * 60_000;

/** A held schema-migration lock. `release()` is idempotent and never throws. */
export interface SchemaMigrationLock {
  release(): Promise<void>;
}

/**
 * Take the schema-migration lock on `driver`'s database (#31598): Postgres
 * `pg_advisory_lock`, MySQL `GET_LOCK`, by the driver's `dialectName`. Every
 * other dialect, and a driver that names none, answers `null`, runs no
 * statement and never asks the driver for its Knex — SQLite (and the Turso / WASM drivers on it) serializes
 * writers in the database file itself, and the CLI's primary database is never
 * MSSQL or Oracle (`resolveStandaloneDatabase` refuses their URL schemes).
 *
 * Uncontended, it is silent: one statement, no output. Contended, it prints
 * ONE line through `warn`, then waits up to `waitMs` and refuses on timeout —
 * this run then migrates nothing, and says so.
 *
 * The lock lives on a connection of its own, outside the driver's pool (an
 * `OS_DATABASE_POOL_MAX=1` pool would have none left for the migration);
 * `database-session-lock.ts` says why, and its session lock excludes every
 * other session on the database, the migration's own pooled ones included.
 */
export async function acquireSchemaMigrationLock(
  driver: unknown,
  opts: { database: string; warn: (line: string) => void; waitMs?: number },
): Promise<SchemaMigrationLock | null> {
  const waitMs = opts.waitMs ?? SCHEMA_MIGRATION_LOCK_WAIT_MS;
  return acquireDatabaseSessionLock(driver, {
    name: SCHEMA_MIGRATION_LOCK_NAME,
    waitMs,
    onWait: () => opts.warn(
      `Another schema migration is running on ${opts.database}; waiting up to `
      + `${Math.ceil(waitMs / 1000)} s for it to finish…`,
    ),
    refuse: () => new Error(
      `Refusing to migrate ${opts.database}: another schema migration still held the migration lock `
      + `('${SCHEMA_MIGRATION_LOCK_NAME}') after ${waitMs} ms, so this run changed nothing. `
      + 'Run it again once that migration has finished.',
    ),
  });
}
