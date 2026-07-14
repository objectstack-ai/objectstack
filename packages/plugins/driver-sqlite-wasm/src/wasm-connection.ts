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
  /** Optional logger; defaults to `console`. */
  logger?: { warn: (msg: string, meta?: unknown) => void };
}

/** Mutation method names that should trigger a persistence cycle. */
const WRITE_METHODS = new Set([
  'run',
  'insert',
  'update',
  'del',
  'counter',
]);

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
  private logger: { warn: (msg: string, meta?: unknown) => void };

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

    // Open the on-disk bytes, but guard against a corrupt image. A torn write
    // (process killed mid-flush before atomic writes existed) or otherwise
    // damaged file makes `new SQL.Database(bytes)` either throw ("file is not a
    // database") or open a handle whose every query fails with "database disk
    // image is malformed" — which, for a background dispatcher on a tick loop,
    // means the same error spammed forever with no path to recovery. Detect it
    // once at open, quarantine the bad file, and start fresh so the dev server
    // becomes usable again instead of wedging.
    try {
      const candidate = new SQL.Database(bytes);
      this.assertReadable(candidate);
      this.db = candidate;
    } catch (err) {
      await this.quarantineCorruptFile(err);
      this.db = new SQL.Database();
    }
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
   * Move a corrupt database file aside so its bytes are preserved for
   * post-mortem while a fresh, empty database takes its place. Best-effort:
   * failures here must not prevent the server from booting on a clean DB.
   */
  private async quarantineCorruptFile(cause: unknown): Promise<void> {
    if (!this.fs) return;
    const reason =
      typeof cause === 'string' ? cause : (cause as Error)?.message ?? String(cause);
    const backup = `${this.filename}.corrupt-${Date.now()}`;
    try {
      await this.fs.rename(this.filename, backup);
      this.logger.warn(
        `[driver-sqlite-wasm] Database image at ${this.filename} is corrupt ` +
          `(${reason}). Quarantined to ${backup} and starting from an empty ` +
          `database so the server can boot.`,
      );
    } catch (renameErr) {
      // Could not move it aside (e.g. permissions) — overwrite is still better
      // than looping forever on a malformed image. Warn loudly and continue.
      this.logger.warn(
        `[driver-sqlite-wasm] Database image at ${this.filename} is corrupt ` +
          `(${reason}) and could not be quarantined (${String(renameErr)}). ` +
          `Starting from an empty database; the corrupt file will be overwritten ` +
          `on the next flush.`,
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
      void this.flush();
    }
  }

  /** Hint that a mutation just executed; schedule a flush if needed. */
  markDirty(method?: string): void {
    if (this.isEphemeral || !this.fs) return;
    if (method && !WRITE_METHODS.has(method)) return;
    this.dirty = true;

    if (this.persist === 'on-write') {
      void this.flush();
      return;
    }
    if (this.debounceMs > 0) {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.flush();
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
