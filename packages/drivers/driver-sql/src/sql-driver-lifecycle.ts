// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Lifecycle" section of `SqlDriver`: the bodies of
 * `connect`, `releaseRefusedSqliteConnection`, `applyAutoVacuumIncremental`,
 * `autoVacuumOf`, `resolveSqliteJournalMode`, `supportsWalJournal`,
 * `applySqliteJournalMode`, `verifyWalReadable`, `isSqliteBusyError`,
 * `journalModeOf`, `checkHealth`, `disconnect` moved out of `sql-driver.ts`
 * whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link LifecycleFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link LifecycleHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `lifecycleHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block. Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * driver.
 *
 * `SqlDriver` here is `SqlDriverStatics` (imported AS `SqlDriver`): forwarders to the
 * statics the bodies read, private ones included, which the class fills in a
 * static block; the class as a type is `SqlDriverClass`.
 *
 * Values that stayed in `sql-driver.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import { SqliteDatabaseFileError } from './sqlite-database-file.js';
import type { SqliteJournalMode } from './sql-driver-top-level.js';
import { SqlDriverStatics as SqlDriver } from './sql-driver.js';
import type { SqlDriver as SqlDriverClass } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link LifecycleFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface LifecycleHost {
  applyAutoVacuumIncremental: SqlDriverClass['applyAutoVacuumIncremental'];
  applySqliteJournalMode: SqlDriverClass['applySqliteJournalMode'];
  readonly config: SqlDriverClass['config'];
  readonly declaredJournalMode: SqlDriverClass['declaredJournalMode'];
  ensureDatabaseExists: SqlDriverClass['ensureDatabaseExists'];
  readonly isSqlite: SqlDriverClass['isSqlite'];
  readonly knex: SqlDriverClass['knex'];
  readonly logger: SqlDriverClass['logger'];
  releaseRefusedSqliteConnection: SqlDriverClass['releaseRefusedSqliteConnection'];
  resolveSqliteJournalMode: SqlDriverClass['resolveSqliteJournalMode'];
  sqliteFilename: SqlDriverClass['sqliteFilename'];
  readonly supportsWalJournal: SqlDriverClass['supportsWalJournal'];
  verifyWalReadable: SqlDriverClass['verifyWalReadable'];
}

/** The bodies of the "Lifecycle" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class LifecycleFacet {
  /** The body of `SqlDriver#connect`; the method's docblock there is its contract. */
  static async connect(this: Pick<LifecycleHost, 'applyAutoVacuumIncremental' | 'applySqliteJournalMode' | 'ensureDatabaseExists' | 'isSqlite' | 'releaseRefusedSqliteConnection'>): Promise<void> {
    try {
      // Ensure the database directory exists before any query can trigger
      // better-sqlite3 to open the file (e.g. loadMetaFromDb on startup).
      await this.ensureDatabaseExists();

      if (this.isSqlite) {
        // Both pragmas below are persistent properties of the FILE, so one
        // connection setting them is enough for every process that follows.
        // Each is READ first and set only when the file answers differently, so
        // a connect to a file an earlier boot already configured writes nothing
        // to it (#21734) — one rule for every connect, read-only boots included.
        // A `false` means the very first statement on this connection failed —
        // in practice a native addon that cannot load — so asking it for another
        // pragma would only repeat the same warning.
        if (await this.applyAutoVacuumIncremental()) {
          await this.applySqliteJournalMode();
        }
      }
    } catch (error) {
      if (this.isSqlite) await this.releaseRefusedSqliteConnection();
      throw error;
    }
  }

  /**
   * Close what a refused SQLite `connect()` opened, before the refusal leaves
   * it (#25084).
   *
   * A file refused by its first statement ({@link SQLITE_FILE_REFUSALS}) was
   * opened to answer it: the pool keeps that better-sqlite3 connection, and for
   * a file whose header says WAL, SQLite keeps its `-shm` and an empty `-wal`
   * beside it for as long as the connection is open. No caller is owed that
   * handle — the connect failed — and a caller that does not `disconnect()` a
   * handle whose `connect()` rejected (the datasource connection service's
   * degraded path) used to keep it for the life of the process.
   *
   * The pool is destroyed and a fresh, empty one put in its place, so the
   * instance is left as it was constructed: nothing open, and a later
   * `connect()` opens the file again and gives its own answer. Destroying
   * alone would not: every later statement would answer "Unable to acquire a
   * connection", which carries no code, so a second `connect()` would log it
   * and resolve over a datasource that cannot run one query. A host-adopted
   * instance is connected again on the same object (`createPrebuiltDriverFactory`
   * in `@objectstack/service-datasource`), so that second `connect()` is real.
   *
   * SQLite only: it is the one dialect whose `connect()` can reject holding a
   * connection. A server dialect rejects there only when the connection itself
   * could not be made, so its pool holds nothing to release.
   *
   * Never throws: the refusal the caller is owed is the error `connect()`
   * raised, so a release that fails is logged and that error goes on unchanged.
   */
  static async releaseRefusedSqliteConnection(this: Pick<LifecycleHost, 'knex' | 'logger'>): Promise<void> {
    try {
      await this.knex.destroy();
      this.knex.initialize();
    } catch (e) {
      this.logger.warn('Failed to close the SQLite connection a refused connect() opened', e);
    }
  }

  /**
   * SQLite space hygiene (ADR-0057). With the default `auto_vacuum=NONE`,
   * freed pages are never returned to the OS — a database that briefly grew
   * (e.g. high-frequency telemetry before retention sweeps run) stays at its
   * high-water mark forever. INCREMENTAL lets a later `PRAGMA incremental_vacuum`
   * (run by the lifecycle Reaper, or manually) reclaim that space without a
   * full blocking VACUUM. NOTE: auto_vacuum only changes layout on a *fresh*
   * database or after a one-time full VACUUM, so this benefits new dev DBs;
   * existing files need a single `VACUUM` to adopt it (`os db clean`).
   * Unaffected by the journal mode: an INCREMENTAL database keeps reclaiming
   * under WAL.
   *
   * ## Read first, set only when different (#21734)
   *
   * The setter is not free on a file that already answers INCREMENTAL: it
   * runs a write transaction that stamps the header — the file change counter
   * (bytes 24–27) and the version-valid-for number (bytes 92–95) — although
   * the mode does not change. So every connect used to leave an
   * already-incremental file different from how it found it, a read-only
   * `os migrate duplicates` included. Reading `PRAGMA auto_vacuum` is
   * byte-neutral (measured on an INCREMENTAL WAL file: md5 unchanged), so the
   * setter is issued only when the file does not answer INCREMENTAL:
   *
   *   - an already-incremental file: the read only — nothing is written;
   *   - a fresh file and `:memory:`: they answer NONE, get the setter, and come
   *     out INCREMENTAL exactly as before;
   *   - a legacy NONE file that holds tables: it gets the same setter it always
   *     got, which leaves it NONE until a `VACUUM` (this method runs none);
   *   - a FULL file: it gets the setter and moves to INCREMENTAL, as before.
   *
   * A reply this method cannot read counts as "not INCREMENTAL": an unreadable
   * answer costs the old write, never the mode.
   *
   * @returns whether the connection answered. The read is the first statement
   * any connection runs, so `false` says the connection itself is not answering —
   * not merely that space hygiene is unavailable.
   * @throws {SqliteDatabaseFileError} when that first statement's answer is a
   * verdict on the file itself ({@link SQLITE_FILE_REFUSALS}): it cannot be
   * opened, it is not a SQLite database, or its header or schema is damaged.
   */
  static async applyAutoVacuumIncremental(this: Pick<LifecycleHost, 'config' | 'knex' | 'logger' | 'sqliteFilename'>): Promise<boolean> {
    try {
      const current = SqlDriver.autoVacuumOf(await this.knex.raw('PRAGMA auto_vacuum'));
      if (current !== SqlDriver.SQLITE_AUTO_VACUUM_INCREMENTAL) {
        await this.knex.raw('PRAGMA auto_vacuum = INCREMENTAL');
      }
      return true;
    } catch (e) {
      // A native better-sqlite3 load failure surfaces HERE first — this PRAGMA
      // is the first query that forces the lazy `.node` addon to load. Two
      // real-world variants, both handled by `resolveSqliteDriver`'s probe,
      // which catches the failure and steps down to wasm SQLite with a clean
      // one-line notice (#2229):
      //   • ABI mismatch  — `ERR_DLOPEN_FAILED` / "…NODE_MODULE_VERSION 127…"
      //                      (a stale prebuilt binary after a Node upgrade)
      //   • not built     — "Could not locate the bindings file" (native addon
      //                      never compiled, e.g. a fresh clone / blocked build)
      // Dumping the full multi-line stack for either looks like a fatal crash
      // to the reader (it isn't), so log a concise, actionable one-liner and
      // let the step-down message that follows explain the outcome. Any OTHER
      // PRAGMA failure keeps the full warning (with stack) as before.
      const code = (e as { code?: string } | null | undefined)?.code;
      // The file itself is refused, and every later statement would answer the
      // same, so the connect fails here, naming the file. Before, each of these
      // logged and resolved, and the datasource counted as connected while it
      // could not answer one query:
      //   • SQLITE_CANTOPEN (#23696) — a directory that exists but refuses the
      //     file, a path SQLite cannot open;
      //   • SQLITE_NOTADB (#24960) — the file exists and opens, but its bytes
      //     are not a SQLite database (plain text, a foreign format, a file
      //     encrypted by another engine). On a development boot the step-down
      //     used to answer it with wasm SQLite, whose open moved the
      //     operator's file aside and wrote an empty database in its place.
      //     The refusal is issued before anything is written: the file is left
      //     exactly as it was found;
      //   • SQLITE_CORRUPT (#25019) — the file is a SQLite database SQLite
      //     cannot read: its header or its schema is damaged (a file truncated
      //     inside its 100-byte header, or short of the pages its schema
      //     names). At the FIRST statement this is a verdict on the whole
      //     file, measured: `SELECT 1` answers the same code. A database
      //     damaged deeper inside answers this read and connects; its damage
      //     surfaces on the read that reaches it, as before. A development
      //     boot used to take the same step-down to wasm SQLite as for
      //     SQLITE_NOTADB, and the same rename; it is refused the same way,
      //     before anything is written.
      const refusal = code === undefined ? undefined : SqlDriver.SQLITE_FILE_REFUSALS.get(code);
      if (refusal !== undefined) {
        const declared = (this.config as any).connection;
        const filename = this.sqliteFilename() ?? String(typeof declared === 'string' ? declared : declared?.filename);
        throw new SqliteDatabaseFileError(filename, refusal, e);
      }
      const msg = e instanceof Error ? e.message : String(e);
      const isNativeLoadFailure =
        code === 'ERR_DLOPEN_FAILED' ||
        code === 'MODULE_NOT_FOUND' ||
        code === 'ERR_MODULE_NOT_FOUND' ||
        /NODE_MODULE_VERSION|could not locate the bindings|was compiled against a different/i.test(msg);
      if (isNativeLoadFailure) {
        this.logger.warn(
          'native better-sqlite3 unavailable (ABI mismatch or not built) — will step down to wasm SQLite; run `pnpm rebuild better-sqlite3` for native speed',
        );
      } else {
        this.logger.warn('Failed to set PRAGMA auto_vacuum=INCREMENTAL', e);
      }
      return false;
    }
  }

  /**
   * The `auto_vacuum` mode a PRAGMA reply carries, as a number.
   *
   * Both SQLite dialects answer with rows (`[{ auto_vacuum: 2 }]`) — a reply
   * shaped any other way yields `null`, which {@link applyAutoVacuumIncremental}
   * treats as "not INCREMENTAL" and answers with the setter.
   */
  static autoVacuumOf(result: unknown): number | null {
    const rows: unknown = Array.isArray(result) ? result : (result as { rows?: unknown })?.rows;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    const value =
      row && typeof row === 'object' ? (row as { auto_vacuum?: unknown }).auto_vacuum : row;
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    return null;
  }

  /** The body of `SqlDriver#resolveSqliteJournalMode`; the method's docblock there is its contract. */
  static resolveSqliteJournalMode(this: Pick<LifecycleHost, 'declaredJournalMode' | 'logger'>): SqliteJournalMode {
    const fromEnv = (process.env[SqlDriver.SQLITE_JOURNAL_MODE_ENV] ?? '').trim().toLowerCase();
    const requested = this.declaredJournalMode ?? (fromEnv || undefined);
    if (requested === undefined) return 'wal';
    if (requested === 'wal' || requested === 'delete') return requested;
    this.logger.warn(
      `Ignoring SQLite journal mode '${requested}' (expected 'wal' or 'delete') — using 'wal'`,
    );
    return 'wal';
  }

  /** The body of `SqlDriver#supportsWalJournal`; the method's docblock there is its contract. */
  static supportsWalJournal(): boolean {
    return true;
  }

  /** The body of `SqlDriver#applySqliteJournalMode`; the method's docblock there is its contract. */
  static async applySqliteJournalMode(this: Pick<LifecycleHost, 'knex' | 'logger' | 'resolveSqliteJournalMode' | 'sqliteFilename' | 'supportsWalJournal' | 'verifyWalReadable'>): Promise<void> {
    if (!this.supportsWalJournal) return;

    // No file means nobody to share it with: `:memory:` (and every other
    // `:`-prefixed pseudo-filename) is private to this process.
    const filename = this.sqliteFilename();
    if (!filename) return;

    const target = this.resolveSqliteJournalMode();

    let current: string | null;
    try {
      current = SqlDriver.journalModeOf(await this.knex.raw('PRAGMA journal_mode'));
    } catch (e) {
      this.logger.warn(`Failed to read SQLite journal_mode on ${filename}`, e);
      return;
    }

    // `memory` / `off` is a deliberate no-journal transport, not a rollback
    // journal worth migrating — leave whatever the host chose in place.
    if (current === null || current === 'memory' || current === 'off') return;

    if (current === target) {
      // Nothing to change — but when the mode is already WAL, still prove it is
      // usable. A database an earlier boot left in WAL on a filesystem that
      // cannot serve it (failure mode 2) would otherwise fail every query with
      // nothing pointing at the cause, and the revert that would fix it only
      // ever gets one attempt.
      if (target === 'wal') await this.verifyWalReadable(filename);
      return;
    }

    let applied: string | null;
    try {
      applied = SqlDriver.journalModeOf(
        await this.knex.raw(`PRAGMA journal_mode = ${target.toUpperCase()}`),
      );
    } catch (e) {
      // SQLITE_BUSY is the benign case: a mode change needs the file to itself,
      // and another process has it open. Whoever wins the race sets the mode
      // and everyone else reads it back on their next boot.
      this.logger.warn(
        `Failed to set SQLite journal_mode=${target} on ${filename} (it stays '${current}')`,
        e,
      );
      return;
    }

    if (applied !== target) {
      this.logger.warn(
        `SQLite kept journal_mode='${applied ?? 'unknown'}' on ${filename} instead of '${target}' — ` +
          (target === 'wal'
            ? `WAL needs a local filesystem (it does not work on NFS/SMB), so this database stays serialized between processes. ` +
              `Set ${SqlDriver.SQLITE_JOURNAL_MODE_ENV}=delete to stop asking.`
            : `close every other connection and retry, or run \`sqlite3 ${filename} "PRAGMA journal_mode=delete"\` with nothing attached.`),
      );
      return;
    }

    if (target === 'wal') await this.verifyWalReadable(filename);
  }

  /**
   * Prove a WAL database can actually be read through, and undo the mode if
   * not — see failure mode 2 in {@link applySqliteJournalMode}. Runs on every
   * connect to a WAL database, not only right after a switch, so a database
   * some earlier boot stranded still gets recovered.
   *
   * Any read on a WAL database opens the shared-memory index, which is the part
   * a network filesystem cannot provide; `sqlite_master` is the cheapest such
   * read and needs no schema to exist.
   */
  static async verifyWalReadable(this: Pick<LifecycleHost, 'knex' | 'logger'>, filename: string): Promise<void> {
    try {
      await this.knex.raw('SELECT count(*) FROM sqlite_master');
      return;
    } catch (e) {
      // Busy is not unusable. Another connection in EXCLUSIVE locking mode — the
      // `os migrate` occupancy probe takes exactly that, briefly — makes this
      // read fail for a reason that passes on its own, and changing the journal
      // mode underneath it would be both wrong and impossible.
      if (SqlDriver.isSqliteBusyError(e)) return;

      const detail = e instanceof Error ? e.message : String(e);
      let reverted: string | null = null;
      try {
        reverted = SqlDriver.journalModeOf(await this.knex.raw('PRAGMA journal_mode = DELETE'));
      } catch {
        // Leaving `reverted` null — reported as "did not take" below, which is
        // the honest outcome either way.
      }
      this.logger.warn(
        `SQLite accepted WAL on ${filename} but cannot read through it (${detail}) — ` +
          (reverted === 'delete'
            ? `reverted to journal_mode=delete. Set ${SqlDriver.SQLITE_JOURNAL_MODE_ENV}=delete to skip this on every boot.`
            : `and the revert did not take (journal_mode='${reverted ?? 'unknown'}'). Run ` +
              `\`sqlite3 ${filename} "PRAGMA journal_mode=delete"\` with nothing attached, then set ` +
              `${SqlDriver.SQLITE_JOURNAL_MODE_ENV}=delete.`),
      );
    }
  }

  /**
   * Whether an error is SQLite reporting contention rather than a broken
   * database. Mirrors `isBusyError` in the CLI's occupancy probe, which asks the
   * same question of the same engine from the other side of the package graph.
   */
  static isSqliteBusyError(e: unknown): boolean {
    const code = (e as { code?: string } | null | undefined)?.code ?? '';
    const message = e instanceof Error ? e.message : String(e ?? '');
    return code.startsWith('SQLITE_BUSY') || /database is locked|SQLITE_BUSY/i.test(message);
  }

  /**
   * The `journal_mode` a PRAGMA reply carries, lower-cased.
   *
   * Both SQLite dialects answer a PRAGMA with rows (`[{ journal_mode: 'wal' }]`)
   * — a reply shaped any other way yields `null`, which every caller treats as
   * "leave the database alone" rather than guessing.
   */
  static journalModeOf(result: unknown): string | null {
    const rows: unknown = Array.isArray(result) ? result : (result as { rows?: unknown })?.rows;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    const value =
      row && typeof row === 'object' ? (row as { journal_mode?: unknown }).journal_mode : row;
    return typeof value === 'string' ? value.toLowerCase() : null;
  }

  /** The body of `SqlDriver#checkHealth`; the method's docblock there is its contract. */
  static async checkHealth(this: Pick<LifecycleHost, 'knex'>): Promise<boolean> {
    try {
      await this.knex.raw('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /** The body of `SqlDriver#disconnect`; the method's docblock there is its contract. */
  static async disconnect(this: Pick<LifecycleHost, 'knex'>): Promise<void> {
    await this.knex.destroy();
  }
}
