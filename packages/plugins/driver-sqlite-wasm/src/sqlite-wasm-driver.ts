// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SQLite-on-WASM driver for ObjectStack.
 *
 * Extends {@link SqlDriver} so all CRUD / schema / introspection / multi-tenant
 * logic is inherited as-is. Only the Knex transport is swapped to a custom
 * dialect ({@link Client_WasmSqlite}) backed by sql.js + Node `fs` persistence,
 * which lets the same `SqlDriver` codepath run inside StackBlitz WebContainer
 * (Node-in-browser) without the native `better-sqlite3` N-API binding.
 */

import type { SqlJsStatic } from 'sql.js';
import { SqlDriver, type SqlDriverConfig } from '@objectstack/driver-sql';

import { getClient_WasmSqlite } from './knex-wasm-dialect.js';
import type {
  PersistMode,
  WasmConnectionOptions,
} from './wasm-connection.js';

/** Public configuration for {@link SqliteWasmDriver}. */
export interface SqliteWasmDriverConfig {
  /**
   * SQLite filename. Use `:memory:` for an ephemeral database that is never
   * persisted. Any other value is treated as a Node `fs` path and the
   * sql.js database bytes are flushed back to disk according to {@link persist}.
   */
  filename: string;

  /**
   * Persistence strategy. Default: `'on-disconnect'`.
   *
   * - `'on-disconnect'` — flush once when the driver disconnects (and on
   *   `process.beforeExit`).
   * - `'on-write'` — flush after every mutation. Safest, slowest.
   * - `` `debounced:${ms}` `` — debounce flushes by N milliseconds. Good
   *   balance under bursty writes.
   */
  persist?: PersistMode;

  /** Pre-loaded sql.js module — skips lazy import. */
  sqlJs?: SqlJsStatic;

  /**
   * Override for sql.js's `locateFile`. Defaults to resolving the `.wasm`
   * file inside the installed `sql.js` package, which works in Node and
   * WebContainer.
   */
  locateFile?: (file: string) => string;

  /** Knex pool overrides. The dialect already defaults to `{ min: 1, max: 1 }`. */
  pool?: SqlDriverConfig['pool'];

  /** Optional logger. Defaults to `console`. */
  logger?: WasmConnectionOptions['logger'];
}

/**
 * SqlDriver subclass that runs Knex against sql.js (WASM SQLite).
 *
 * Behaves identically to the standard SQLite path — the dialect's
 * {@link Client_WasmSqlite._query} reports `lastID`/`changes` exactly the
 * way better-sqlite3 does, so {@link SqlDriver}'s SQL generation, returning
 * clauses, and schema introspection all keep working.
 */
export class SqliteWasmDriver extends SqlDriver {
  public override readonly name: string = 'com.objectstack.driver.sqlite-wasm';
  public override readonly version: string = '1.0.0';

  /**
   * Force the SQLite branch in {@link SqlDriver}. The base class detects
   * SQLite by string-matching `config.client`, but we pass the dialect class
   * directly so the string check would miss.
   */
  protected override get isSqlite(): boolean {
    return true;
  }

  /**
   * Never WAL (#3941). The base driver switches a file-backed SQLite database to
   * WAL so several processes can share one file. Nothing here is shared: the live
   * database sits in this process's WASM heap, and what reaches disk is a byte
   * image {@link flush} exports from it — another process reads that snapshot,
   * never the database. So the pragma buys this transport nothing.
   *
   * It is also not free. Journal mode is a persistent header change in the
   * operator's file, and under WAL the export path's correctness would rest on
   * sql.js checkpointing the log while `export()` closes and reopens the
   * database. Measured, it does — no row is lost today — which is why this is a
   * declined default and not a bug report. But a transport that persists by
   * serializing an image should not be one implementation detail away from
   * dropping committed rows for a concurrency benefit it cannot use.
   *
   * Declared rather than discovered: sql.js *accepts* `journal_mode = WAL`,
   * because its VFS is memory-backed, so the refusal the base class gets from
   * `:memory:` never comes — and an image whose header already says WAL (one a
   * native run left behind) reports `wal` here too.
   */
  protected override get supportsWalJournal(): boolean {
    return false;
  }

  private wasmConfig: SqliteWasmDriverConfig;
  private beforeExitHandler: (() => void) | null = null;

  constructor(config: SqliteWasmDriverConfig) {
    const knexConfig = SqliteWasmDriver.toKnexConfig(config);
    super(knexConfig);
    this.wasmConfig = config;
    if (config.logger) this.logger = config.logger as any;
  }

  /** Translate the public config into a Knex config that uses our dialect. */
  static toKnexConfig(config: SqliteWasmDriverConfig): SqlDriverConfig {
    return {
      // Knex accepts a Client class as `client`. The dialect's `driverName`
      // is `'wasm-sqlite'` and its `dialect` is `'sqlite3'` so the SQLite
      // query compiler is reused.
      client: getClient_WasmSqlite() as any,
      connection: {
        filename: config.filename,
        persist: config.persist,
        sqlJs: config.sqlJs,
        locateFile: config.locateFile,
        logger: config.logger,
      } as any,
      // sql.js is single-threaded WASM — a single connection per pool keeps
      // semantics consistent with the upstream SQLite dialect.
      pool: config.pool ?? { min: 1, max: 1 },
      useNullAsDefault: true,
    } as SqlDriverConfig;
  }

  override async connect(): Promise<void> {
    await super.connect();

    // Best-effort flush on process exit so `on-disconnect` mode still saves
    // user data if the host process is shut down without explicit cleanup.
    if (
      this.wasmConfig.filename !== ':memory:' &&
      !this.wasmConfig.filename.startsWith(':') &&
      typeof process !== 'undefined' &&
      typeof process.once === 'function'
    ) {
      this.beforeExitHandler = () => {
        // Fire-and-forget — beforeExit cannot await.
        void this.flush().catch(() => {
          /* ignore */
        });
      };
      process.once('beforeExit', this.beforeExitHandler);
    }
  }

  override async disconnect(): Promise<void> {
    if (this.beforeExitHandler && typeof process !== 'undefined') {
      try {
        process.removeListener('beforeExit', this.beforeExitHandler);
      } catch {
        /* ignore */
      }
      this.beforeExitHandler = null;
    }
    await super.disconnect();
  }

  /**
   * Force a flush of the in-memory database to disk. No-op for ephemeral
   * databases or when no fs is available.
   */
  async flush(): Promise<void> {
    // Reach into the Knex pool and ask every live connection to flush.
    const knex = (this as any).knex;
    const client = knex?.client;
    const pool = client?.pool;
    if (!pool || typeof pool.numUsed !== 'function') return;

    const acquire = client.acquireConnection?.bind(client);
    const release = client.releaseConnection?.bind(client);
    if (!acquire || !release) return;

    const conn = await acquire();
    try {
      if (conn && typeof conn.flush === 'function') {
        await conn.flush();
      }
    } finally {
      await release(conn);
    }
  }
}
