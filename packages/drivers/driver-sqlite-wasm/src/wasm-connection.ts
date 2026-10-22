// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Thin wrapper over sql.js {@link Database} that mimics the surface of
 * `better-sqlite3`'s `Database` (only the methods the Knex dialect uses).
 *
 * Persistence is handled here, not in the Knex dialect, so it can be
 * orchestrated per-connection without polluting the SQL execution path.
 */

import type { Database, SqlJsStatic } from 'sql.js';

/** When to flush the in-memory WASM database to disk. */
export type PersistMode =
  | 'on-disconnect'
  | 'on-write'
  | `debounced:${number}`;

export interface WasmConnectionOptions {
  /**
   * On-disk file path. `:memory:` (or any value starting with `:`) skips
   * persistence entirely and the database lives only for the process.
   */
  filename: string;
  /** When to persist. Default: `on-disconnect`. */
  persist?: PersistMode;
  /** Pre-loaded sql.js module. If omitted, loaded lazily on first connect. */
  sqlJs?: SqlJsStatic;
  /**
   * Optional override for the `.wasm` locator passed to `initSqlJs()`.
   * Defaults to resolving the file from the `sql.js` package on disk
   * (works in Node and WebContainer).
   */
  locateFile?: (file: string) => string;
  /**
   * Optional logger; defaults to `console`. A failed background flush is a
   * durability loss: it is reported through the logger's `error` when it has
   * one (`console` does), else through `warn`.
   */
  logger?: { warn: (msg: string, meta?: unknown) => void };
}

/**
 * Detect whether a Node-style `fs` module is available. WebContainer
 * (StackBlitz) provides Node `fs`; pure-browser environments do not.
 */
async function tryLoadFs(): Promise<typeof import('node:fs/promises') | null> {
  try {
    return await import('node:fs/promises');
  } catch {
    return null;
  }
}

/**
 * Resolve a default sql.js WASM locator. We point sql.js at the `.wasm`
 * file shipped inside `sql.js`'s own `dist/` folder. This avoids requiring
 * the caller to host the WASM separately.
 */
async function defaultLocateFile(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    const dir = dirname(pkgJsonPath);
    return (file: string) => join(dir, 'dist', file);
  } catch {
    return undefined;
  }
}

let cachedSqlJs: Promise<SqlJsStatic> | null = null;

async function loadSqlJs(
  locateFile?: (file: string) => string,
): Promise<SqlJsStatic> {
  if (cachedSqlJs) return cachedSqlJs;
  cachedSqlJs = (async () => {
    const mod = await import('sql.js');
    const initSqlJs = (mod as any).default ?? (mod as any);
    const locator = locateFile ?? (await defaultLocateFile());
    const SQL = await initSqlJs(locator ? { locateFile: locator } : undefined);
    return SQL as SqlJsStatic;
  })();
  return cachedSqlJs;
}

/**
 * SQLite's own text for `SQLITE_NOTADB` (`sqlite3_errstr(26)`). sql.js throws
 * a bare `Error` carrying SQLite's message and no result code, so this text is
 * the only form the code reaches this file in.
 */
const SQLITE_NOTADB_ERRSTR = 'file is not a database';

/**
 * The refusal {@link WasmSqliteConnection.open} throws for a file sql.js cannot
 * read (#25019), with the SQLite code the native driver answers for the same
 * file: `SQLITE_NOTADB` when SQLite says the bytes are not a database, and
 * `SQLITE_CORRUPT` for every other reason a read of the image failed ("database
 * disk image is malformed", a `quick_check` that does not answer `ok`).
 *
 * The code is what makes it one refusal with the native driver's:
 * `SqlDriver.connect()` names the file with its own words for that code, and
 * `resolveSqliteDriver` (`@objectstack/service-datasource`) re-throws it rather
 * than step down. The message is the rest of the answer, and the one thing only
 * this engine can say: it no longer moves the file aside for the operator, so
 * it says how to do that.
 */
function unreadableDatabaseFileRefusal(
  filename: string,
  cause: unknown,
): UnreadableDatabaseFileRefusal {
  const reason =
    typeof cause === 'string' ? cause : (cause as Error | undefined)?.message ?? String(cause);
  // `cause` is attached by hand: the `ErrorOptions` overload is ES2022 and this
  // package compiles against ES2020's lib.
  const refusal = new Error(
    `wasm SQLite cannot read it (${reason}). To start from an empty database, move the ` +
      `file aside yourself (mv '${filename}' '${filename}.unreadable') and start again; ` +
      `to keep its data, restore a copy that opens`,
  ) as UnreadableDatabaseFileRefusal;
  refusal.code = reason === SQLITE_NOTADB_ERRSTR ? 'SQLITE_NOTADB' : 'SQLITE_CORRUPT';
  refusal.filename = filename;
  refusal.cause = cause;
  return refusal;
}

/** SQLite's own result-code names for a file it cannot read, as the native driver carries them. */
type UnreadableDatabaseFileCode = 'SQLITE_NOTADB' | 'SQLITE_CORRUPT';

type UnreadableDatabaseFileRefusal = Error & {
  code: UnreadableDatabaseFileCode;
  filename: string;
  cause: unknown;
};

/**
 * A sql.js-backed connection that exposes the `prepare`/`exec`/`close`
 * subset used by Knex's SQLite dialect. Mutations are queued through a
 * configurable persistence strategy so the on-disk file stays in sync.
 */
export class WasmSqliteConnection {
  /**
   * Process-wide counter making each atomic-write temp filename unique, so
   * concurrent connections (or overlapping flushes) never target the same
   * temp path. Combined with `process.pid` for cross-process uniqueness.
   */
  private static tmpSeq = 0;

  readonly filename: string;
  readonly persist: PersistMode;
  readonly isEphemeral: boolean;

  private db!: Database;
  private fs: typeof import('node:fs/promises') | null = null;
  private dirty = false;
  private debounceMs = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> | null = null;
  private destroyed = false;
  /**
   * The injected logger as this class reads it. `error` is not part of the
   * public option type (adding it would widen a published surface); it is used
   * when the object happens to have one, which every real logger does.
   */
  private logger: {
    warn: (msg: string, meta?: unknown) => void;
    error?: (msg: string, meta?: unknown) => void;
  };
  /**
   * A background flush failure was already reported and no flush has landed
   * since. Keeps `on-write` (one flush per write) from logging the same
   * unchanged cause once per write; cleared when a flush actually writes.
   */
  private flushFailureReported = false;

  /**
   * Whether a `BEGIN…COMMIT/ROLLBACK` transaction is currently open. Tracked
   * because sql.js's {@link Database.export} closes and reopens the database
   * (it has no in-place serialize), and closing a connection rolls back any
   * open transaction. Flushing mid-transaction would therefore silently
   * abort it, leaving the eventual `COMMIT` to fail with
   * "cannot commit - no transaction is active". We defer the flush until the
   * transaction fully closes. See {@link noteTransactionControl}.
   */
  private rootTxActive = false;
  /** Open `SAVEPOINT` depth (nested transactions emitted by Knex). */
  private savepointDepth = 0;
  /** A flush was requested while a transaction was open; run it on close. */
  private flushDeferred = false;

  /** True while any transaction (root or savepoint) is in flight. */
  private get inTransaction(): boolean {
    return this.rootTxActive || this.savepointDepth > 0;
  }

  constructor(opts: WasmConnectionOptions) {
    this.filename = opts.filename;
    this.persist = opts.persist ?? 'on-disconnect';
    this.isEphemeral =
      this.filename === ':memory:' || this.filename.startsWith(':');
    this.logger = opts.logger ?? console;

    if (typeof this.persist === 'string' && this.persist.startsWith('debounced:')) {
      const ms = Number(this.persist.slice('debounced:'.length));
      this.debounceMs = Number.isFinite(ms) && ms > 0 ? ms : 250;
    }
  }

  /** Open the underlying sql.js database, loading bytes from disk if any. */
  async open(sqlJs?: SqlJsStatic, locateFile?: (file: string) => string): Promise<void> {
    const SQL = sqlJs ?? (await loadSqlJs(locateFile));

    if (this.isEphemeral) {
      this.db = new SQL.Database();
      return;
    }

    this.fs = await tryLoadFs();
    if (!this.fs) {
      this.logger.warn(
        '[driver-sqlite-wasm] No node:fs available — falling back to in-memory database. ' +
          'Data will not be persisted across reloads.',
      );
      this.db = new SQL.Database();
      return;
    }

    // Ensure parent directory exists, then load bytes if the file exists.
    const { dirname } = await import('node:path');
    const dir = dirname(this.filename);
    if (dir && dir !== '.') {
      await this.fs.mkdir(dir, { recursive: true });
    }

    let bytes: Uint8Array | undefined;
    try {
      const buf = await this.fs.readFile(this.filename);
      bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
    }

    if (!bytes) {
      this.db = new SQL.Database();
      return;
    }

    // Open the on-disk bytes, and refuse a file sql.js cannot read (#25019).
    // A file that is not a database makes the first read throw "file is not a
    // database"; a damaged one throws "database disk image is malformed" or
    // fails `quick_check`. Either way every later query would answer the same,
    // so the open fails here, naming the file, with the code the native driver
    // answers for the same file (see `unreadableDatabaseFileRefusal`).
    //
    // The file is left exactly as it was found. This open used to move it to
    // `<file>.corrupt-<timestamp>` and start an empty database in its place: a
    // self-heal written for torn wasm images, which `atomicWriteFile` has since
    // closed. What still reached it was an operator's file on a declared
    // datasource — an explicit `sqlite-wasm` one in any mode, and the
    // development step-down from a native addon that cannot load — which then
    // read as connected over an empty database.
    let candidate: Database | undefined;
    try {
      candidate = new SQL.Database(bytes);
      this.assertReadable(candidate);
    } catch (err) {
      try {
        candidate?.close();
      } catch {
        /* the refusal below is the answer */
      }
      throw unreadableDatabaseFileRefusal(this.filename, err);
    }

    // Only a file this open accepts gets its stale log parked: a refused file
    // keeps everything beside it as well.
    await this.quarantineOrphanedWal();
    this.db = candidate;
  }

  /**
   * Force sql.js to actually read a page so a malformed image surfaces now
   * rather than on the first business query. `PRAGMA quick_check` walks the
   * b-tree structure without the full-scan cost of `integrity_check`; a healthy
   * database returns a single `ok` row. Any thrown error (raw string or Error)
   * or a non-`ok` result is treated as corruption.
   */
  private assertReadable(db: Database): void {
    const res = db.exec('PRAGMA quick_check(1)');
    const first = res?.[0]?.values?.[0]?.[0];
    if (typeof first === 'string' && first.toLowerCase() !== 'ok') {
      throw new Error(`sqlite quick_check failed: ${first}`);
    }
  }

  /**
   * Move a write-ahead log left behind by a *real* SQLite aside (#3941).
   *
   * The native driver keeps file-backed databases in WAL mode, and a clean close
   * checkpoints the log away — so a non-empty `<db>-wal` here means the last
   * process died without one. That log is a problem in both directions, and
   * neither is something wasm SQLite can fix: it cannot read the log (we load
   * only the main image, so any transaction still in there is invisible), and it
   * must not leave it in place either — the next {@link flush} rewrites the
   * image, and a real SQLite opening a fresh image beside a stale log would
   * replay frames that no longer belong to it.
   *
   * So rename it, which loses nothing recoverable (the bytes are preserved for a
   * real `sqlite3` to recover from) and disarms the mismatch. Best-effort: this
   * is a dev-only step-down path and must never prevent a boot.
   */
  private async quarantineOrphanedWal(): Promise<void> {
    if (!this.fs) return;
    const wal = `${this.filename}-wal`;
    let size: number;
    try {
      size = (await this.fs.stat(wal)).size;
    } catch {
      return; // no sidecar (the normal case) or an unreadable one
    }
    if (size <= 0) return; // checkpointed-and-truncated: nothing in it

    const parked = `${wal}.orphaned-${Date.now()}`;
    try {
      await this.fs.rename(wal, parked);
      this.logger.warn(
        `[driver-sqlite-wasm] ${wal} holds ${size} bytes of write-ahead log that wasm SQLite ` +
          `cannot read — this database was last used in WAL mode and closed uncleanly. Parked it ` +
          `at ${parked} and loaded the main image without it, so anything committed only to the ` +
          `log is NOT in this session. To recover it, rebuild better-sqlite3 (or use \`sqlite3\`), ` +
          `restore the log next to the database, and run \`PRAGMA wal_checkpoint(TRUNCATE)\`.`,
      );
    } catch (renameErr) {
      this.logger.warn(
        `[driver-sqlite-wasm] ${wal} holds ${size} bytes of write-ahead log that wasm SQLite ` +
          `cannot read, and it could not be moved aside (${String(renameErr)}). Data committed ` +
          `only to the log is missing from this session; checkpoint it with a real sqlite3 before ` +
          `writing further.`,
      );
    }
  }

  /**
   * Update transaction state from a transaction-control statement and, when a
   * transaction has just fully closed, run any flush that was deferred while
   * it was open. Called by the Knex dialect for every `BEGIN` / `COMMIT` /
   * `ROLLBACK` / `SAVEPOINT` / `RELEASE` statement.
   *
   * We bias toward "in transaction": an unrecognised form leaves the flag set,
   * which at worst delays a flush (safe) rather than exporting mid-transaction
   * (which would abort it).
   */
  noteTransactionControl(sql: string): void {
    const s = sql.trim().toUpperCase();
    if (/^BEGIN\b/.test(s)) {
      this.rootTxActive = true;
    } else if (/^(COMMIT|END)\b/.test(s)) {
      // A COMMIT/END ends the whole transaction regardless of savepoint nesting.
      this.rootTxActive = false;
      this.savepointDepth = 0;
    } else if (/^ROLLBACK\s+TO\b/.test(s)) {
      // Rolls back to a savepoint but keeps the (outer) transaction open.
    } else if (/^ROLLBACK\b/.test(s)) {
      this.rootTxActive = false;
      this.savepointDepth = 0;
    } else if (/^SAVEPOINT\b/.test(s)) {
      this.savepointDepth += 1;
    } else if (/^RELEASE\b/.test(s)) {
      this.savepointDepth = Math.max(0, this.savepointDepth - 1);
    }
    // If the transaction just fully closed and a flush was deferred while it
    // was open, run it now. We key off `flushDeferred` (set only when
    // `markDirty` actually wanted to flush) rather than `dirty`, so persist
    // modes that don't flush per-write — e.g. `on-disconnect` — still defer to
    // close() instead of flushing on every COMMIT.
    if (!this.inTransaction && this.flushDeferred) {
      this.flushDeferred = false;
      this.flushInBackground();
    }
  }

  /**
   * Record that the statement just executed CHANGED the database, and schedule
   * a flush according to {@link persist}.
   *
   * Deliberately takes no argument. It used to filter the caller's Knex
   * `method` against a local write-method allowlist, which made "did this
   * mutate?" a decision taken in TWO places — here and in the dialect's
   * execution-path branch — and the two disagreed: an `INSERT … RETURNING`
   * runs down the dialect's ROW-returning branch (it has rows to return), that
   * branch never called this method at all, and so a whole class of committed
   * writes was never marked dirty and never reached disk (#4518). One decision,
   * one owner: {@link statementMutatesDatabase} in the dialect classifies the
   * statement, and this method just does what it is told.
   */
  markDirty(): void {
    if (this.isEphemeral || !this.fs) return;
    this.dirty = true;

    if (this.persist === 'on-write') {
      this.flushInBackground();
      return;
    }
    if (this.debounceMs > 0) {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.flushInBackground();
      }, this.debounceMs);
    }
    // 'on-disconnect' → flush only at close()
  }

  /**
   * Force a write of the current database state to disk.
   *
   * Flushes are strictly serialized through a single promise chain: every call
   * appends an export+write step that runs after all previously-queued steps.
   * This matters because sql.js `export()` mutates the live connection (it
   * closes and reopens the database), so two exports must never overlap — and
   * because the returned promise must not resolve until the caller's own write
   * has hit disk (deterministic for tests and for `close()`). Each step
   * re-checks `dirty` at run time, so a no-op write collapses cheaply and a
   * write that arrived mid-flush is captured by the next queued step.
   */
  async flush(): Promise<void> {
    if (this.isEphemeral || !this.fs || this.destroyed) return;
    // Never export while a transaction is open: sql.js's `export()` closes and
    // reopens the database, which rolls back the in-flight transaction and
    // makes the subsequent COMMIT fail. Defer until the transaction closes
    // (handled in `noteTransactionControl`).
    if (this.inTransaction) {
      this.flushDeferred = true;
      return;
    }

    const prev = this.flushChain;
    const step = (prev ?? Promise.resolve()).then(async () => {
      if (!this.dirty || this.destroyed || this.inTransaction) return;
      // Snapshot dirty=false before export so a concurrent write re-marks us
      // and is picked up by the next queued step.
      this.dirty = false;
      try {
        const exported = this.db.export();
        // sql.js returns a Uint8Array; Buffer.from on it shares memory but
        // works fine for the atomic write below.
        await this.atomicWriteFile(Buffer.from(exported));
        // A flush landed: the next failure is a new episode worth reporting.
        this.flushFailureReported = false;
      } catch (err) {
        this.dirty = true; // let a later flush retry
        throw err;
      }
    });
    // Keep the chain tail alive but swallow its rejection there so one failed
    // flush doesn't poison every future flush; the awaited `step` still throws.
    this.flushChain = step.catch(() => {});
    await step;
  }

  /**
   * Run a flush nobody awaits: a write under `on-write`, the debounce timer, a
   * transaction closing. There is no caller to throw to, so a failure is
   * reported here (see {@link reportBackgroundFlushFailure}) instead of being
   * left as a floating rejection, which the host process meets as an
   * `unhandledRejection` — fatal under Node's default. {@link flush} has
   * already re-marked `dirty`, so the next flush retries. An AWAITED
   * {@link flush} or {@link close} is unaffected and still throws.
   */
  private flushInBackground(): void {
    void this.flush().catch((err) => this.reportBackgroundFlushFailure(err));
  }

  /**
   * Say, once per failure episode, that the database file is not being
   * written. The memory image keeps answering queries, so nothing else looks
   * wrong while committed writes stay off disk: that is a durability loss, hence
   * `error`, with the consequence and the fix in the first line.
   *
   * Never throws. It runs in a rejection handler, where a throw would become
   * the very unhandled rejection this exists to remove; a logger that cannot
   * log is the end of the line, so its failure is dropped.
   */
  private reportBackgroundFlushFailure(err: unknown): void {
    if (this.flushFailureReported) return;
    this.flushFailureReported = true;
    const reason = typeof err === 'string' ? err : (err as Error)?.message ?? String(err);
    try {
      (this.logger.error ?? this.logger.warn).call(
        this.logger,
        `[driver-sqlite-wasm] Writing ${this.filename} to disk failed (${reason}). ` +
          `Writes since the last successful flush are NOT on disk: the database keeps ` +
          `answering from memory and looks healthy, but they are lost if this process ` +
          `stops before a flush succeeds. The flush is retried after the next write and ` +
          `on close (close() throws if it still fails) - free disk space or restore the ` +
          `data directory (ENOSPC, a removed or read-only directory). Reported once, ` +
          `until a flush succeeds.`,
      );
    } catch {
      /* the logger itself failed: nowhere left to report */
    }
  }

  /**
   * Write the database bytes to disk atomically: write to a sibling temp file,
   * fsync it, then `rename()` it over the target.
   *
   * A plain `writeFile(this.filename, …)` truncates the target and streams the
   * new bytes in place, so a process killed mid-write (a dev-server restart,
   * Ctrl-C, or crash — likely under `on-write`, where every dispatcher tick
   * flushes) leaves a half-written file. sql.js then rejects that file on the
   * next boot with "database disk image is malformed". `rename(2)` is atomic
   * within a filesystem, so a reader always sees either the complete old file
   * or the complete new one — never a torn image. The temp file lives in the
   * same directory as the target so the rename stays intra-filesystem.
   */
  private async atomicWriteFile(data: Buffer): Promise<void> {
    if (!this.fs) return;
    const tmp = `${this.filename}.tmp-${process.pid}-${(WasmSqliteConnection.tmpSeq += 1)}`;
    let handle: import('node:fs/promises').FileHandle | undefined;
    try {
      handle = await this.fs.open(tmp, 'w');
      await handle.writeFile(data);
      // Flush the bytes to the platter before the rename so a crash can't leave
      // a renamed-but-empty file behind on filesystems that reorder the two.
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.fs.rename(tmp, this.filename);
    } catch (err) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
      // Clean up the temp file so a failed flush doesn't litter the data dir.
      try {
        await this.fs.unlink(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  /** Close the database, flushing any pending writes first. */
  async close(): Promise<void> {
    if (this.destroyed) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // Any transaction still open at close is abandoned and will be rolled back
    // by `db.close()`; clear the flag so the final flush is not deferred and
    // already-committed data is persisted.
    this.rootTxActive = false;
    this.savepointDepth = 0;
    try {
      await this.flush();
    } finally {
      this.destroyed = true;
      try {
        this.db.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Access the raw sql.js database (for the Knex dialect). */
  get raw(): Database {
    return this.db;
  }
}
