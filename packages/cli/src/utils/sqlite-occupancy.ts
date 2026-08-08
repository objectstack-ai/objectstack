// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Is somebody else using this SQLite database right now?" (#3917)
 *
 * `os migrate apply` used to gate only on `--allow-destructive` and the `[y/N]`
 * prompt. Neither says anything about *occupancy*: the overwhelmingly common
 * shape of a dev machine is a `pnpm dev` server holding the same
 * `.objectstack/data/objectstack.db` open while the operator runs a migration
 * in another terminal. What that costs is not a swapped-out file — the SQLite
 * column-op rebuild swaps tables *inside* the file, in one transaction — it is
 * `SQLITE_BUSY` mid-migration, stale prepared statements in the live server,
 * and schema-cookie churn under its feet.
 *
 * That scenario was FALSE under the pre-#6469 defaults, and this comment used
 * to assert it anyway: `pnpm dev` (`os dev`) held `dev.db` while `os migrate`
 * opened `standalone.db`, so under default configuration the two never
 * contended for one file and this guard could not fire in its own primary
 * scenario (it still worked when an explicit `OS_DATABASE_URL` pointed both at
 * one file). #6469 unified all three commands on ONE resolution —
 * `<state dir>/data/objectstack.db`, legacy files compat-read — so the dev
 * server and a migration in another terminal now genuinely open the same file
 * by default, and the scenario above is real again. The probes themselves are
 * filename-parametric and needed no change.
 *
 * ## Two independent signals, because neither covers the ground alone
 *
 * **1. Which processes hold the file open** (`/proc` on Linux, `lsof` on
 * macOS). The signal that survives every journal mode, and the only one that
 * names the culprit — "stop pid 12367 (node)" is worth more to an operator than
 * "something is using it". It is also the only one that fires on a
 * rollback-journal database, where locks exist just for the duration of a
 * transaction, so an idle `os serve` holds nothing any query could see. That is
 * what dogfooding caught (#3940), back when every ObjectStack database ran
 * `journal_mode = delete`.
 *
 * **2. A SQL lock probe** — `PRAGMA locking_mode = EXCLUSIVE` then
 * `BEGIN IMMEDIATE` under `busy_timeout = 0`. Since #3941 the driver keeps
 * file-backed databases in **WAL**, where this reports `SQLITE_BUSY` against an
 * *attached* connection whether or not it is doing anything — so for a database
 * ObjectStack created it is authoritative, and it reaches the cases signal 1
 * cannot: a platform with no process inspection, a hardened container with no
 * `/proc` visibility, a connection held by another *user's* process. On a
 * database still (or deliberately) on a rollback journal it narrows back to
 * "someone is mid-write", which is why signal 1 stays first.
 *
 * Either signal firing means busy. Three rejected alternatives, all measured
 * rather than assumed:
 *
 * - **`-wal` / `-shm` presence alone.** Correct while a connection is open — a
 *   clean close checkpoints and removes them — but it cannot tell a live server
 *   from a crashed one, and it says nothing at all about a database on a
 *   rollback journal. Sidecars are reported as supporting evidence, never as
 *   the verdict.
 * - **`PRAGMA wal_checkpoint(TRUNCATE)`.** Reports `busy = 1` only when a
 *   *writer* is mid-transaction; an attached-but-idle connection checkpoints
 *   cleanly. Misses precisely the common case.
 * - **The SQL probe on its own.** What shipped first, and what dogfooding
 *   caught: against a real `os serve` holding a real project database, it
 *   reported idle and the migration ran unannounced. Correct on WAL, blind on
 *   the mode the platform defaulted to then — and still blind on any database
 *   opted back out to `delete`, so it does not get to be the only signal.
 *
 * Both probes are non-destructive: an empty transaction rolled back with
 * locking mode restored, and read-only filesystem inspection. No row is read
 * or written.
 *
 * ## What it deliberately does NOT do
 *
 * No conclusion is invented when neither signal can run — a missing
 * `better-sqlite3`, an unreadable file, a platform with no process inspection.
 * Those return `unknown` / `not_applicable`, and the caller proceeds (a warning
 * at most). Refusing a migration because we failed to look would be worse than
 * the bug this guards.
 */

import { existsSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export type SqliteOccupancy =
  /** Not a SQLite file target (postgres, mongo, `:memory:`) — nothing to probe. */
  | { status: 'not_applicable' }
  /** Probed successfully; nothing else is using the database. */
  | { status: 'idle'; filename: string; sidecars: string[] }
  /** Something else is using this database right now. */
  | {
    status: 'busy';
    filename: string;
    signal: 'file_open' | 'wal_attached' | 'write_lock';
    detail: string;
    sidecars: string[];
    /** Processes holding the file open, when the platform let us look. */
    holders?: FileHolder[];
  }
  /** Could not tell — the probes themselves failed. Never a reason to refuse. */
  | { status: 'unknown'; filename: string; detail: string; sidecars: string[] };

/** A process with the database file open. `name` is best-effort. */
export interface FileHolder {
  pid: number;
  name?: string;
}

/** The `-wal` / `-shm` companions that exist next to `filename`, if any. */
export function sqliteSidecars(filename: string): string[] {
  return ['-wal', '-shm'].map((s) => `${filename}${s}`).filter((p) => existsSync(p));
}

/**
 * Processes other than this one holding `filename` open.
 *
 * The load-bearing signal for a rollback-journal database, where an idle
 * connection is invisible to SQL. Returns `[]` when nothing holds it AND when
 * the platform cannot answer — callers must not read an empty array as proof
 * of absence, which is why the SQL probe still runs alongside.
 *
 * Only same-user processes are visible without elevated privileges. That is
 * the case that matters (your own dev server), and a database held by another
 * user's process still has the SQL probe as a backstop on WAL.
 */
export function processesHoldingFile(filename: string): FileHolder[] {
  try {
    const target = realpathSync(filename);
    if (process.platform === 'linux') return holdersFromProc(target);
    if (process.platform === 'darwin') return holdersFromLsof(target);
    return [];
  } catch {
    return [];
  }
}

/** Linux: walk `/proc/<pid>/fd` and compare link targets. No subprocess. */
function holdersFromProc(target: string): FileHolder[] {
  const out: FileHolder[] = [];
  let pids: string[];
  try { pids = readdirSync('/proc'); } catch { return []; }
  for (const entry of pids) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    let fds: string[];
    // EACCES for another user's process, ENOENT for one that just exited —
    // both mean "nothing to learn here", not "stop scanning".
    try { fds = readdirSync(`/proc/${entry}/fd`); } catch { continue; }
    for (const fd of fds) {
      let link: string;
      try { link = readlinkSync(`/proc/${entry}/fd/${fd}`); } catch { continue; }
      if (link === target) {
        out.push({ pid, name: procName(entry) });
        break;
      }
    }
  }
  return out;
}

function procName(pid: string): string | undefined {
  try {
    // `comm` is the short name ("node"); enough to recognise, and it cannot
    // leak a command line that may carry secrets.
    return readlinkSync(`/proc/${pid}/exe`).split('/').pop();
  } catch {
    return undefined;
  }
}

/** macOS: no `/proc`, so shell out to `lsof` — bounded, and failure is silent. */
function holdersFromLsof(target: string): FileHolder[] {
  try {
    const raw = execFileSync('lsof', ['-Fpc', '--', target], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const out: FileHolder[] = [];
    let pid: number | undefined;
    for (const line of raw.split('\n')) {
      if (line.startsWith('p')) {
        pid = Number(line.slice(1));
        if (pid === process.pid) pid = undefined;
        else if (Number.isFinite(pid)) out.push({ pid });
      } else if (line.startsWith('c') && pid !== undefined && out.length > 0) {
        out[out.length - 1].name = line.slice(1);
      }
    }
    return out;
  } catch {
    // lsof absent, or it exits non-zero when nothing holds the file.
    return [];
  }
}

/**
 * Probe `filename` for anything else using it. Never throws: every failure mode
 * collapses into `unknown`.
 *
 * MUST run before the caller's own stack connects — once our pool is attached,
 * both signals are answering about us.
 */
export async function probeSqliteOccupancy(filename: string | null | undefined): Promise<SqliteOccupancy> {
  if (!filename || filename === ':memory:' || filename.startsWith(':')) {
    return { status: 'not_applicable' };
  }
  const sidecars = sqliteSidecars(filename);

  // A database that does not exist yet cannot be occupied.
  if (!existsSync(filename)) return { status: 'idle', filename, sidecars };

  // Signal 1, first because it is the one that fires on the journal mode the
  // platform actually ships, and because it can name the process.
  const holders = processesHoldingFile(filename);
  if (holders.length > 0) {
    return {
      status: 'busy',
      filename,
      signal: 'file_open',
      sidecars,
      holders,
      detail: `it is open in ${describeHolders(holders)}`,
    };
  }

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

/** `pid 4821 (node)` / `pids 4821 (node), 4822` — whatever we could learn. */
function describeHolders(holders: FileHolder[]): string {
  const label = holders.length === 1 ? 'pid' : 'pids';
  return `${label} ${holders.map((h) => (h.name ? `${h.pid} (${h.name})` : String(h.pid))).join(', ')}`;
}

/**
 * One line an operator can act on. Names the file and the evidence — and, when
 * the platform let us look, the process to go and stop, which is the single
 * most useful thing this can tell them.
 */
export function describeOccupancy(occupancy: SqliteOccupancy): string {
  if (occupancy.status !== 'busy') return '';
  const sidecars = occupancy.sidecars.length > 0
    ? ` (${occupancy.sidecars.map((s) => s.slice(s.lastIndexOf('/') + 1)).join(', ')} present)`
    : '';
  return `${occupancy.filename} is in use — ${occupancy.detail}${sidecars}.`;
}
