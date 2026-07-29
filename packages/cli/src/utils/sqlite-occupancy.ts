// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Is somebody else using this SQLite database right now?" (#3917)
 *
 * `os migrate apply` used to gate only on `--allow-destructive` and the `[y/N]`
 * prompt. Neither says anything about *occupancy*: the overwhelmingly common
 * shape of a dev machine is a `pnpm dev` server holding the same
 * `.objectstack/data/standalone.db` open while the operator runs a migration in
 * another terminal. What that costs is not a swapped-out file — the SQLite
 * column-op rebuild swaps tables *inside* the file, in one transaction — it is
 * `SQLITE_BUSY` mid-migration, stale prepared statements in the live server,
 * and schema-cookie churn under its feet.
 *
 * ## The probe
 *
 * On a WAL database (the default for every ObjectStack sqlite deployment),
 * `PRAGMA locking_mode = EXCLUSIVE` followed by `BEGIN IMMEDIATE` under
 * `busy_timeout = 0`. Exclusive locking mode makes SQLite stop using the `-shm`
 * shared-memory file, which it can only do by taking exclusive locks on it —
 * so the first transaction after the pragma fails with `SQLITE_BUSY` when, and
 * only when, another connection is attached. Attached is the right question,
 * not writing: a dev server sitting idle between requests still holds prepared
 * statements and a schema cookie that a migration invalidates.
 *
 * Two rejected alternatives, both measured rather than assumed:
 *
 * - **`-wal` / `-shm` presence alone.** Correct while a connection is open
 *   (SQLite creates them with the first attach and removes them with the last
 *   clean close) but it cannot tell a live server from a crashed one, and
 *   refusing to migrate because a dead process left files behind is its own
 *   operational bug. Sidecars are reported as supporting evidence, never as the
 *   verdict.
 * - **`PRAGMA wal_checkpoint(TRUNCATE)`.** Reports `busy = 1` only when a
 *   *writer* is mid-transaction — an attached-but-idle connection checkpoints
 *   cleanly. It misses precisely the common case.
 *
 * A rollback-journal database has no persistent record of who is attached
 * (locks exist only for the duration of a transaction), so there the probe
 * degrades honestly to `BEGIN IMMEDIATE`: it detects an active writer and
 * nothing more.
 *
 * The probe is non-destructive — an empty transaction, rolled back, with
 * locking mode restored — and it reads and writes no row.
 *
 * ## What it deliberately does NOT do
 *
 * No conclusion is invented when the probe cannot run — a missing
 * `better-sqlite3`, an unreadable file, a non-SQLite target. Those return
 * `unknown` / `not_applicable`, and the caller proceeds (a warning at most).
 * Refusing a migration because we failed to look would be worse than the bug
 * this guards.
 */

import { existsSync } from 'node:fs';

export type SqliteOccupancy =
  /** Not a SQLite file target (postgres, mongo, `:memory:`) — nothing to probe. */
  | { status: 'not_applicable' }
  /** Probed successfully; no other connection is attached. */
  | { status: 'idle'; filename: string; sidecars: string[] }
  /** Another connection is using this database right now. */
  | { status: 'busy'; filename: string; signal: 'wal_attached' | 'write_lock'; detail: string; sidecars: string[] }
  /** Could not tell — the probe itself failed. Never a reason to refuse. */
  | { status: 'unknown'; filename: string; detail: string; sidecars: string[] };

/** The `-wal` / `-shm` companions that exist next to `filename`, if any. */
export function sqliteSidecars(filename: string): string[] {
  return ['-wal', '-shm'].map((s) => `${filename}${s}`).filter((p) => existsSync(p));
}

/**
 * Probe `filename` for other attached connections. Never throws: every failure
 * mode collapses into `unknown`.
 *
 * MUST run before the caller's own stack connects — once our pool is attached,
 * the probe is answering about us.
 */
export async function probeSqliteOccupancy(filename: string | null | undefined): Promise<SqliteOccupancy> {
  if (!filename || filename === ':memory:' || filename.startsWith(':')) {
    return { status: 'not_applicable' };
  }
  const sidecars = sqliteSidecars(filename);

  // A database that does not exist yet cannot be occupied.
  if (!existsSync(filename)) return { status: 'idle', filename, sidecars };

  let Database: any;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch (e: any) {
    // The wasm step-down (#2229) and a never-built native addon both land here.
    return {
      status: 'unknown',
      filename,
      sidecars,
      detail: `better-sqlite3 is not loadable, so occupancy could not be checked (${e?.message ?? e})`,
    };
  }

  let db: any;
  try {
    db = new Database(filename, { fileMustExist: true });
    // Fail FAST rather than wait out a live writer — the question is "is it
    // busy", not "wait until it isn't".
    db.pragma('busy_timeout = 0');

    const journalMode = String(db.pragma('journal_mode', { simple: true }) ?? '').toLowerCase();
    const wal = journalMode === 'wal';

    // Exclusive locking mode is what makes an ATTACHED-but-idle connection
    // visible on WAL; on a rollback journal it is equivalent to a plain
    // `BEGIN IMMEDIATE` and detects only an active writer.
    if (wal) db.pragma('locking_mode = EXCLUSIVE');

    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec('ROLLBACK');
    } catch (e: any) {
      if (!isBusyError(e)) throw e;
      return wal
        ? {
          status: 'busy',
          filename,
          signal: 'wal_attached',
          sidecars,
          detail: 'another connection is attached to it (its WAL shared-memory is in use)',
        }
        : {
          status: 'busy',
          filename,
          signal: 'write_lock',
          sidecars,
          detail: 'another connection holds a write lock on it',
        };
    }

    return { status: 'idle', filename, sidecars };
  } catch (e: any) {
    if (isBusyError(e)) {
      return {
        status: 'busy',
        filename,
        signal: 'write_lock',
        sidecars,
        detail: 'it reported SQLITE_BUSY while being probed',
      };
    }
    return {
      status: 'unknown',
      filename,
      sidecars,
      detail: `occupancy probe failed: ${e?.message ?? e}`,
    };
  } finally {
    // Hand the exclusive lock back before closing. Closing releases it anyway;
    // doing it explicitly keeps the window shut even if `close()` is delayed.
    try { db?.pragma('locking_mode = NORMAL'); } catch { /* never opened */ }
    try { db?.close(); } catch { /* already closed */ }
  }
}

function isBusyError(e: unknown): boolean {
  const code = (e as { code?: string } | null | undefined)?.code ?? '';
  const message = e instanceof Error ? e.message : String(e ?? '');
  return code === 'SQLITE_BUSY'
    || code === 'SQLITE_BUSY_SNAPSHOT'
    || /database is locked/i.test(message)
    || /SQLITE_BUSY/i.test(message);
}

/**
 * One line an operator can act on. Names the file and the evidence — the
 * sidecars are included because "which process?" is answered by looking for
 * whoever holds them open.
 */
export function describeOccupancy(occupancy: SqliteOccupancy): string {
  if (occupancy.status !== 'busy') return '';
  const sidecars = occupancy.sidecars.length > 0
    ? ` (${occupancy.sidecars.map((s) => s.slice(s.lastIndexOf('/') + 1)).join(', ')} present)`
    : '';
  return `${occupancy.filename} is in use — ${occupancy.detail}${sidecars}.`;
}
