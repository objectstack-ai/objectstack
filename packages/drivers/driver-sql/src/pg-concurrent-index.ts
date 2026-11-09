// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31901: on PostgreSQL, an index the schema sync adds to a table that already
 * exists is built `CONCURRENTLY`, so writes to the table are not blocked while
 * it builds.
 *
 * A plain `CREATE INDEX` holds a SHARE lock for the whole build, which blocks
 * every INSERT, UPDATE and DELETE on the table. Measured on PostgreSQL 16 at
 * 1,000,000 rows: an INSERT sent during the build waited 537 to 777 ms; with
 * `CONCURRENTLY` it waited about 1.2 ms. A table the sync has just created is
 * empty, so it keeps the plain path, and every other dialect is unchanged.
 *
 * What `CONCURRENTLY` costs, and how each cost is handled:
 *
 *   - It cannot run inside a transaction block, so it runs on a pooled
 *     connection of its own in autocommit ({@link withAutocommitSession}),
 *     never through `withPinnedSession` (which opens a transaction).
 *   - It waits for every transaction that is older than it, on ANY table of
 *     the database, not just this one. A long read anywhere holds it. So the
 *     session arms `lock_timeout` at the driver's existing DDL lock-wait bound,
 *     and a timeout is recognized by its SQLSTATE ({@link isPostgresLockTimeout}).
 *   - A build that fails (a lock timeout, or a duplicate row reaching a UNIQUE
 *     index) leaves the index behind marked INVALID. `IF NOT EXISTS` then skips
 *     it as present, so the sync reads `pg_index.indisvalid`
 *     ({@link invalidIndexNames}), drops an INVALID index this driver manages,
 *     and builds it again.
 */

import type { Knex } from 'knex';

/**
 * PostgreSQL's `lock_not_available`. A statement cancelled by `lock_timeout`
 * raises it ("canceling statement due to lock timeout"), on the table lock and
 * on the waits `CONCURRENTLY` makes for older transactions alike.
 */
export const PG_LOCK_NOT_AVAILABLE = '55P03';

/**
 * True when `err` is PostgreSQL's lock timeout, as node-postgres raises it and
 * however knex wraps it.
 *
 * The SQLSTATE is read, never the message: PostgreSQL translates its messages,
 * so a prose match would go blind on a server running in another locale. The
 * `cause` chain is followed for the same reason the MySQL recognizer follows
 * it: a wrapper that rebuilds the error keeps the original there.
 */
export function isPostgresLockTimeout(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object' || depth > 4) return false;
  const e = err as { code?: unknown; cause?: unknown };
  if (e.code === PG_LOCK_NOT_AVAILABLE) return true;
  return isPostgresLockTimeout(e.cause, depth + 1);
}

/**
 * Run `fn` on ONE pooled connection, in autocommit, and give the connection
 * back afterwards.
 *
 * `CREATE INDEX CONCURRENTLY` refuses to run inside a transaction block
 * (SQLSTATE 25001), and `SET lock_timeout` only bounds the statement if both
 * go out on the same session. Every statement `run` sends goes out on that one
 * connection, outside any transaction.
 */
export async function withAutocommitSession<T>(
  knex: Knex,
  fn: (run: (sql: string, bindings?: readonly unknown[]) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  const client = (knex as unknown as { client: { acquireConnection(): Promise<unknown>; releaseConnection(c: unknown): Promise<unknown> } }).client;
  const connection = await client.acquireConnection();
  try {
    return await fn((sql, bindings) => knex.raw(sql, (bindings ?? []) as any).connection(connection as any) as unknown as Promise<unknown>);
  } finally {
    await client.releaseConnection(connection);
  }
}

/**
 * Arm `lock_timeout` on the session `run` speaks for, run `fn`, then put the
 * session's previous value back, so the connection goes back to the pool as it
 * came out.
 */
export async function withLockTimeout<T>(
  run: (sql: string, bindings?: readonly unknown[]) => Promise<unknown>,
  milliseconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  let prior: string | undefined;
  try {
    const res: any = await run(`select current_setting('lock_timeout') as v`);
    prior = res?.rows?.[0]?.v;
  } catch {
    // An unreadable prior value only costs the restore below. It must not stop
    // the bound from being armed, which is the point.
  }
  await run(`select set_config('lock_timeout', ?, false)`, [`${Math.max(1, Math.floor(milliseconds))}ms`]);
  try {
    return await fn();
  } finally {
    try {
      await run(`select set_config('lock_timeout', ?, false)`, [prior ?? '0']);
    } catch {
      // Best effort: never mask the failure being thrown past this block.
    }
  }
}

/**
 * The names of the INVALID indexes on `table`: the ones a failed
 * `CREATE INDEX CONCURRENTLY` left behind (`pg_index.indisvalid = false`).
 *
 * The planner never uses an INVALID index, and `CREATE INDEX … IF NOT EXISTS`
 * skips one as present, so a sync that went by name alone would treat it as
 * built forever.
 */
export async function invalidIndexNames(
  run: (sql: string, bindings?: readonly unknown[]) => Promise<unknown>,
  table: string,
): Promise<Set<string>> {
  const res: any = await run(
    `select c.relname as name
       from pg_index i
       join pg_class c on c.oid = i.indexrelid
      where i.indrelid = ?::regclass
        and not i.indisvalid`,
    [table],
  );
  const rows: Array<{ name?: unknown }> = Array.isArray(res?.rows) ? res.rows : [];
  return new Set(rows.map((r) => String(r.name ?? '')).filter((n) => n.length > 0));
}

/**
 * The deferral window the concurrent builds of one driver instance share.
 *
 * The engine calls the driver's sync once per object, so the driver never sees
 * where a boot's pass begins or ends. The bound is therefore a time window, not
 * a pass:
 *
 *   - The first build whose lock wait times out opens the window
 *     ({@link openConcurrentIndexDeferral}) for `lockWaitMs`, the same bound the
 *     build waited for.
 *   - While the window is open, every other concurrent build defers to the next
 *     sync at once, without waiting ({@link activeConcurrentIndexDeferral}).
 *   - The window closes itself when its time is up: the next build after that
 *     waits again, at most once more. So a process waits at most once per
 *     window, however many indexes are missing, and a sync later in the same
 *     process (a package install, say) is not held off until a restart.
 *   - An operator's explicit run (`flushDeferredSchemaDdl`, the public
 *     `applyMigrationEntries`) closes it at entry ({@link clearConcurrentIndexDeferral}),
 *     so the run waits for itself instead of inheriting an earlier deferral.
 */
export interface ConcurrentIndexDeferral {
  /** The index whose timed-out build opened the window, or `null` when it is closed. */
  deferredBy: string | null;
  /** `Date.now()` at which the window closes. */
  deferredUntil: number;
  /** The bound each build arms as `lock_timeout`, and the window's length. */
  lockWaitMs: number;
}

/** Open the window after `what`'s build timed out: it lasts one lock-wait bound. */
export function openConcurrentIndexDeferral(state: ConcurrentIndexDeferral, what: string, now = Date.now()): void {
  state.deferredBy = what;
  state.deferredUntil = now + state.lockWaitMs;
}

/** The build that opened the window while it is open; `null` (and the window closed) once its time is up. */
export function activeConcurrentIndexDeferral(state: ConcurrentIndexDeferral, now = Date.now()): string | null {
  if (state.deferredBy !== null && now >= state.deferredUntil) clearConcurrentIndexDeferral(state);
  return state.deferredBy;
}

/** Close the window, whether or not it is open. */
export function clearConcurrentIndexDeferral(state: ConcurrentIndexDeferral): void {
  state.deferredBy = null;
  state.deferredUntil = 0;
}

/** One index the concurrent path builds, as `syncDeclaredIndexes` normalized it. */
export interface ConcurrentIndexSpec {
  table: string;
  name: string;
  columns: readonly string[];
  unique: boolean;
  /** Key parts written `COALESCE(column, '<global tenant>')` (ADR-0120 D3). */
  nullSafe: ReadonlySet<string>;
  /** The literal the NULL-safe key parts coalesce to. */
  globalTenant: string;
}

/**
 * The `CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS` statement for `spec`.
 *
 * `IF NOT EXISTS` is what lets a second replica booting at the same moment
 * skip, instead of failing on the name the first one is building.
 * The key parts are the ones the plain path builds: a bare column, or the
 * NULL-safe `COALESCE` form the plain path's raw DDL spells.
 */
export function concurrentIndexSql(knex: Knex, spec: ConcurrentIndexSpec): string {
  const q = (id: string) => knex.ref(id).toQuery();
  const parts = spec.columns.map((c) => (spec.nullSafe.has(c) ? `COALESCE(${q(c)}, '${spec.globalTenant}')` : q(c)));
  return (
    `CREATE ${spec.unique ? 'UNIQUE ' : ''}INDEX CONCURRENTLY IF NOT EXISTS ${q(spec.name)} ` +
    `ON ${q(spec.table)} (${parts.join(', ')})`
  );
}

/**
 * The statement that turns a plain UNIQUE index into the UNIQUE CONSTRAINT the
 * plain path makes (knex's `table.unique` on PostgreSQL is
 * `ALTER TABLE … ADD CONSTRAINT … UNIQUE`), so the two paths end in the same
 * catalog state. Attaching an index that already exists is a catalog change
 * only: its lock is held for milliseconds, not for a build.
 */
export function attachUniqueConstraintSql(knex: Knex, table: string, name: string): string {
  const q = (id: string) => knex.ref(id).toQuery();
  return `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(name)} UNIQUE USING INDEX ${q(name)}`;
}

/** `DROP INDEX CONCURRENTLY IF EXISTS`, for an INVALID index this driver manages. */
export function dropInvalidIndexSql(knex: Knex, name: string): string {
  return `DROP INDEX CONCURRENTLY IF EXISTS ${knex.ref(name).toQuery()}`;
}
