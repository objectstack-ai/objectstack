// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The schema-migration lock `bootSchemaStack` (`./schema-migrate.ts`) takes on
 * a boot that can apply (#31598): one migrator per database at a time.
 *
 * Its own module, importing nothing but `node:crypto`, so the pins on it load
 * the lock and not the migration stack around it.
 */
import { createHash } from 'node:crypto';

/**
 * The one name every migrator locks on (#31598): two `os migrate apply` runs
 * against one database — one per pod, from an init container on each replica —
 * otherwise both read the same pending work and both perform it. Measured on
 * Postgres before this lock: three concurrent applies against one fresh
 * database each reported creating tables (82 + 86 + 37 for 86 tables), and the
 * third applied drift on tables the others were still creating.
 *
 * ⛔ Never derived from the database name, the project or the release: every
 * CLI version that can migrate this database must take the SAME lock, or a
 * rolling upgrade runs an old and a new migrator side by side. The unit pin
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
export const SCHEMA_MIGRATION_PG_LOCK_KEY = BigInt.asIntN(
  64,
  BigInt(`0x${createHash('sha256').update(SCHEMA_MIGRATION_LOCK_NAME).digest('hex').slice(0, 16)}`),
).toString();

/**
 * How long a migrator waits for another to finish before it refuses. No
 * environment override: none exists for migration timeouts to follow.
 */
export const SCHEMA_MIGRATION_LOCK_WAIT_MS = 10 * 60_000;

/** The slice of knex the lock uses, typed structurally. */
interface LockKnex {
  client: {
    dialect?: string;
    acquireRawConnection(): Promise<unknown>;
    destroyRawConnection(connection: unknown): Promise<void>;
  };
  raw(sql: string, bindings?: readonly unknown[]): { connection(connection: unknown): Promise<unknown> };
}

/** A held schema-migration lock. `release()` is idempotent and never throws. */
export interface SchemaMigrationLock {
  release(): Promise<void>;
}

/** The single row a lock statement answers, whichever client shaped the result. */
function lockRow(result: unknown): Record<string, unknown> | undefined {
  // pg answers `{ rows }`; mysql2 answers `[rows, fields]`.
  const rows = Array.isArray(result) ? result[0] : (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
}

/**
 * Take the schema-migration lock on `driver`'s database (#31598): Postgres
 * `pg_advisory_lock`, MySQL `GET_LOCK`. Every other dialect answers `null` and
 * runs no statement — SQLite (and the Turso / WASM drivers on it) serializes
 * writers in the database file itself, and the CLI's primary database is never
 * MSSQL or Oracle (`resolveStandaloneDatabase` refuses their URL schemes).
 *
 * Uncontended, it is silent: one statement, no output. Contended, it prints
 * ONE line through `warn`, then waits up to `waitMs` and refuses on timeout —
 * this run then migrates nothing, and says so.
 *
 * The lock lives on a connection of its own, opened through the driver's own
 * client (its configuration, credentials and TLS) but OUTSIDE its pool: both
 * locks are session-scoped, so the lock and its release must run on one
 * session, which a pool does not promise; a pooled connection idle past the
 * pool's reaper would be closed and the lock released with it; and an
 * `OS_DATABASE_POOL_MAX=1` pool would have none left for the migration. A
 * session lock excludes every other session on the database, so the
 * migration's own pooled connections are serialized by it all the same.
 */
export async function acquireSchemaMigrationLock(
  driver: unknown,
  opts: { database: string; warn: (line: string) => void; waitMs?: number },
): Promise<SchemaMigrationLock | null> {
  const knex = (driver as { getKnex?: () => LockKnex } | null)?.getKnex?.();
  const dialect = knex?.client?.dialect;
  if (!knex || (dialect !== 'postgresql' && dialect !== 'mysql')) return null;
  const pg = dialect === 'postgresql';
  const waitMs = opts.waitMs ?? SCHEMA_MIGRATION_LOCK_WAIT_MS;
  const connection = await knex.client.acquireRawConnection();
  const run = async (sql: string, bindings: readonly unknown[]): Promise<Record<string, unknown> | undefined> =>
    lockRow(await knex.raw(sql, bindings).connection(connection));
  const close = async (): Promise<void> => {
    try { await knex.client.destroyRawConnection(connection); } catch { /* closing releases the lock anyway */ }
  };
  const refuse = (): Error => new Error(
    `Refusing to migrate ${opts.database}: another schema migration still held the migration lock `
    + `('${SCHEMA_MIGRATION_LOCK_NAME}') after ${waitMs} ms, so this run changed nothing. `
    + 'Run it again once that migration has finished.',
  );
  try {
    const tried = pg
      ? await run('select pg_try_advisory_lock(?::bigint) as locked', [SCHEMA_MIGRATION_PG_LOCK_KEY])
      : await run('select GET_LOCK(?, 0) as locked', [SCHEMA_MIGRATION_LOCK_NAME]);
    if (!(tried?.locked === true || Number(tried?.locked) === 1)) {
      opts.warn(
        `Another schema migration is running on ${opts.database}; waiting up to `
        + `${Math.ceil(waitMs / 1000)} s for it to finish…`,
      );
      if (pg) {
        await run(`set lock_timeout = ${Math.max(1, Math.trunc(waitMs))}`, []);
        try {
          await run('select pg_advisory_lock(?::bigint)', [SCHEMA_MIGRATION_PG_LOCK_KEY]);
        } catch (error) {
          // 55P03 lock_not_available: `lock_timeout` ran out.
          if ((error as { code?: unknown } | null)?.code === '55P03') throw refuse();
          throw error;
        }
      } else {
        // GET_LOCK answers 1 (taken), 0 (timed out) or NULL (an error).
        const waited = await run('select GET_LOCK(?, ?) as locked', [
          SCHEMA_MIGRATION_LOCK_NAME,
          Math.max(1, Math.ceil(waitMs / 1000)),
        ]);
        if (Number(waited?.locked) !== 1) throw refuse();
      }
    }
  } catch (error) {
    await close();
    throw error;
  }
  let held = true;
  return {
    release: async () => {
      if (!held) return;
      held = false;
      try {
        if (pg) await run('select pg_advisory_unlock(?::bigint)', [SCHEMA_MIGRATION_PG_LOCK_KEY]);
        else await run('select RELEASE_LOCK(?)', [SCHEMA_MIGRATION_LOCK_NAME]);
      } catch { /* closing the session below releases it */ }
      await close();
    },
  };
}
