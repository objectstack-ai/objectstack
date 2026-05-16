// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Turso/libSQL Driver for ObjectStack
 *
 * Dual-transport architecture supporting:
 * - **Local mode:** file-based or in-memory SQLite via SqlDriver (Knex + better-sqlite3)
 * - **Replica mode:** local SQLite + embedded replica sync via @libsql/client
 * - **Remote mode:** pure remote queries via @libsql/client (HTTP/WebSocket)
 *
 * In local/replica mode, all CRUD, schema, query, filter, and introspection
 * logic is inherited from SqlDriver. In remote mode, TursoDriver delegates
 * all operations to RemoteTransport which uses @libsql/client directly.
 *
 * The transport mode is auto-detected from the URL:
 * - `file:` or `:memory:` → local
 * - `file:` or `:memory:` + `syncUrl` → replica
 * - `libsql://` or `https://` (no syncUrl) → remote
 */

import { SqlDriver, type SqlDriverConfig } from '@objectstack/driver-sql';
import type { Client } from '@libsql/client';
import { RemoteTransport } from './remote-transport.js';

// ── Transport Mode ───────────────────────────────────────────────────────────

/**
 * Transport mode for TursoDriver.
 *
 * - `local`: File-based or in-memory SQLite via Knex + better-sqlite3
 * - `replica`: Local SQLite + embedded replica sync from remote Turso
 * - `remote`: Pure remote queries via @libsql/client (no local DB)
 */
export type TursoTransportMode = 'local' | 'replica' | 'remote';

// ── Configuration Types ──────────────────────────────────────────────────────

/**
 * Turso driver configuration.
 *
 * Supports the following connection modes:
 * 1. **Local (Embedded):** `url: 'file:./data/local.db'`
 * 2. **In-memory (Ephemeral):** `url: ':memory:'`
 * 3. **Embedded Replica (Hybrid):** `url` (local file or `:memory:`) +
 *    `syncUrl` (remote `libsql://` / `https://` Turso endpoint)
 * 4. **Remote (Cloud):** `url: 'libsql://...'` — pure remote queries
 *    via @libsql/client, no local SQLite needed
 *
 * In local/replica modes, the primary query engine runs against a local
 * SQLite database (via SqlDriver / Knex + better-sqlite3). In remote mode,
 * all operations use @libsql/client SDK (HTTP/WebSocket) directly.
 *
 * Transport mode is auto-detected from the URL, or can be forced via `mode`.
 */
export interface TursoDriverConfig {
  /**
   * Database URL.
   *
   * - `file:./data/local.db` → local mode
   * - `:memory:` → local mode (ephemeral)
   * - `libsql://my-db.turso.io` → remote mode (cloud-only)
   * - `https://my-db.turso.io` → remote mode (cloud-only)
   */
  url: string;

  /** JWT auth token for the remote Turso database */
  authToken?: string;

  /**
   * AES-256 encryption key for the local database file.
   * Only effective in local/replica modes.
   */
  encryptionKey?: string;

  /**
   * Maximum concurrent requests to the remote database.
   * Effective in replica and remote modes.
   * Default: 20
   */
  concurrency?: number;

  /** Remote sync URL for embedded replica mode (`libsql://` or `https://`) */
  syncUrl?: string;

  /** Sync configuration for embedded replica mode (requires `syncUrl`) */
  sync?: {
    /** Periodic sync interval in seconds (0 = manual only). Default: 60 */
    intervalSeconds?: number;
    /** Sync immediately on connect. Default: true */
    onConnect?: boolean;
  };

  /**
   * Operation timeout in milliseconds for remote operations.
   * Effective in replica and remote modes.
   */
  timeout?: number;

  /**
   * Force a specific transport mode. If not provided, mode is auto-detected
   * from the URL:
   *
   * - `file:` or `:memory:` without syncUrl → `'local'`
   * - `file:` or `:memory:` with syncUrl → `'replica'`
   * - `libsql://` or `https://` without syncUrl → `'remote'`
   */
  mode?: TursoTransportMode;

  /**
   * Pre-configured @libsql/client instance. When provided, TursoDriver uses
   * this client directly instead of creating its own. Useful for custom
   * caching, connection pooling, or testing.
   *
   * Only effective in remote and replica modes.
   */
  client?: Client;
}

// ── Turso Driver ─────────────────────────────────────────────────────────────

/**
 * Turso/libSQL Driver for ObjectStack.
 *
 * Dual-transport architecture:
 *
 * - **Local/Replica modes:** Extends SqlDriver (Knex + better-sqlite3) for
 *   all CRUD, schema, filtering, aggregation — zero duplicated logic.
 * - **Remote mode:** Delegates all operations to RemoteTransport which
 *   uses @libsql/client SDK directly (HTTP/WebSocket). No local SQLite needed.
 *
 * Transport mode is auto-detected from the URL or forced via `config.mode`.
 *
 * @example Local mode
 * ```typescript
 * const driver = new TursoDriver({ url: 'file:./data/app.db' });
 * await driver.connect();
 * ```
 *
 * @example In-memory mode (testing)
 * ```typescript
 * const driver = new TursoDriver({ url: ':memory:' });
 * await driver.connect();
 * ```
 *
 * @example Embedded replica mode
 * ```typescript
 * const driver = new TursoDriver({
 *   url: 'file:./data/replica.db',
 *   syncUrl: 'libsql://my-db-orgname.turso.io',
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 *   sync: { intervalSeconds: 60, onConnect: true },
 * });
 * await driver.connect();
 * ```
 *
 * @example Remote mode (cloud-only)
 * ```typescript
 * const driver = new TursoDriver({
 *   url: 'libsql://my-db-orgname.turso.io',
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 * });
 * await driver.connect();
 * ```
 */
export class TursoDriver extends SqlDriver {
  // IDataDriver metadata
  public override readonly name: string = 'com.objectstack.driver.turso';
  public override readonly version: string = '1.0.0';

  public override readonly supports = {
    // Basic CRUD Operations
    create: true,
    read: true,
    update: true,
    delete: true,

    // Bulk Operations
    bulkCreate: true,
    bulkUpdate: true,
    bulkDelete: true,

    // Transaction & Connection Management
    transactions: true,
    savepoints: true,

    // Query Operations
    queryFilters: true,
    queryAggregations: true,
    querySorting: true,
    queryPagination: true,
    queryWindowFunctions: true,
    querySubqueries: true,
    queryCTE: true,
    joins: true,

    // Advanced Features — Turso/libSQL native capabilities
    fullTextSearch: true,  // FTS5
    jsonQuery: true,       // JSON1 extension
    geospatialQuery: false,
    streaming: false,
    jsonFields: true,
    arrayFields: true,
    vectorSearch: false,

    // Schema Management
    schemaSync: true,
    batchSchemaSync: true,
    migrations: false,
    indexes: true,

    // Performance & Optimization
    connectionPooling: false, // Turso uses concurrency limits, not connection pools
    preparedStatements: true,
    queryCache: false,
  };

  private tursoConfig: TursoDriverConfig;
  private libsqlClient: Client | null = null;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * The resolved transport mode for this driver instance.
   * Set during construction based on URL and config.
   */
  public readonly transportMode: TursoTransportMode;

  /**
   * Remote transport delegate — only initialized in remote mode.
   */
  private remoteTransport: RemoteTransport | null = null;

  constructor(config: TursoDriverConfig) {
    const mode = TursoDriver.detectMode(config);
    const knexConfig = TursoDriver.toKnexConfig(config, mode);
    super(knexConfig);
    this.tursoConfig = config;
    this.transportMode = mode;

    if (mode === 'remote') {
      this.remoteTransport = new RemoteTransport();

      // Register a lazy-connect factory so the transport can self-heal when
      // connect() was never called, failed on first attempt, or the client
      // was lost (e.g. serverless cold-start, transient network error).
      this.remoteTransport.setConnectFactory(async () => {
        if (this.tursoConfig.client) {
          this.libsqlClient = this.tursoConfig.client;
        } else {
          const { createClient } = await import('@libsql/client');
          this.libsqlClient = createClient({
            url: this.tursoConfig.url,
            authToken: this.tursoConfig.authToken,
            concurrency: this.tursoConfig.concurrency,
          });
        }
        return this.libsqlClient;
      });
    }
  }

  /**
   * Detect the transport mode from the URL and config.
   */
  static detectMode(config: TursoDriverConfig): TursoTransportMode {
    // Explicit mode override
    if (config.mode) return config.mode;

    const url = config.url;

    // Local modes: file: or :memory:
    if (url === ':memory:' || url.startsWith('file:')) {
      return config.syncUrl ? 'replica' : 'local';
    }

    // Remote URL (libsql://, https://, wss://)
    if (url.startsWith('libsql://') || url.startsWith('https://') || url.startsWith('wss://')) {
      // When both url and syncUrl are remote, @libsql/client operates in
      // embedded replica mode with an in-memory local cache. The remote URL
      // serves as the primary database and syncUrl configures the sync target.
      if (config.syncUrl) return 'replica';
      return 'remote';
    }

    // Fallback: treat as local
    return 'local';
  }

  /**
   * Convert TursoDriverConfig to a Knex-compatible SqlDriverConfig.
   * Extracts the file path from the URL for local/embedded modes.
   * In remote mode, uses a dummy :memory: config (Knex is not used).
   */
  private static toKnexConfig(config: TursoDriverConfig, mode: TursoTransportMode): SqlDriverConfig {
    // Remote mode: All CRUD/schema operations delegate to RemoteTransport
    // (via @libsql/client). Knex is never used for queries, but the SqlDriver
    // base class constructor requires a valid config. We provide a minimal
    // :memory: config that initializes Knex without side effects.
    if (mode === 'remote') {
      return {
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      };
    }

    if (config.url === ':memory:') {
      return {
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      };
    }

    if (config.url.startsWith('file:')) {
      return {
        client: 'better-sqlite3',
        connection: { filename: config.url.replace(/^file:/, '') },
        useNullAsDefault: true,
      };
    }

    // Remote URL with syncUrl (replica mode) — use :memory: as local backend
    return {
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    };
  }

  /**
   * Check if this driver instance is in remote mode.
   */
  get isRemote(): boolean {
    return this.transportMode === 'remote';
  }

  /**
   * Get the Turso-specific configuration.
   */
  getTursoConfig(): Readonly<TursoDriverConfig> {
    return this.tursoConfig;
  }

  // ===================================
  // Lifecycle (Turso-specific overrides)
  // ===================================

  /**
   * Connect the driver.
   *
   * **Local/Replica modes:**
   * 1. Initializes the Knex/better-sqlite3 connection (via SqlDriver.connect)
   * 2. If syncUrl is configured, creates a @libsql/client for sync operations
   * 3. Triggers initial sync if configured
   * 4. Starts periodic sync interval if configured
   *
   * **Remote mode:**
   * 1. Creates a @libsql/client for remote queries
   * 2. Skips Knex initialization (not needed)
   */
  override async connect(): Promise<void> {
    if (this.isRemote) {
      // Remote mode: initialize @libsql/client only
      if (this.tursoConfig.client) {
        this.libsqlClient = this.tursoConfig.client;
      } else {
        const { createClient } = await import('@libsql/client');
        this.libsqlClient = createClient({
          url: this.tursoConfig.url,
          authToken: this.tursoConfig.authToken,
          concurrency: this.tursoConfig.concurrency,
        });
      }
      this.remoteTransport!.setClient(this.libsqlClient);
      return;
    }

    // Local/Replica mode: initialize Knex first
    await super.connect();

    // Initialize libSQL client for embedded replica sync
    if (this.tursoConfig.syncUrl) {
      if (this.tursoConfig.client) {
        this.libsqlClient = this.tursoConfig.client;
      } else {
        const { createClient } = await import('@libsql/client');
        this.libsqlClient = createClient({
          url: this.tursoConfig.url,
          authToken: this.tursoConfig.authToken,
          encryptionKey: this.tursoConfig.encryptionKey,
          syncUrl: this.tursoConfig.syncUrl,
          concurrency: this.tursoConfig.concurrency,
        });
      }

      // Sync on connect if configured (default: true)
      if (this.tursoConfig.sync?.onConnect !== false) {
        await this.sync();
      }

      // Start periodic sync if configured
      const interval = this.tursoConfig.sync?.intervalSeconds;
      if (interval && interval > 0) {
        this.syncIntervalId = setInterval(() => {
          this.sync().catch(() => {
            /* background sync failure is non-fatal */
          });
        }, interval * 1000);
      }
    }
  }

  /**
   * Disconnect the driver, clean up sync intervals, and close libSQL client.
   */
  override async disconnect(): Promise<void> {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    if (this.isRemote) {
      // Remote mode: only clean up remoteTransport / libsqlClient
      if (this.remoteTransport) {
        this.remoteTransport.close();
      }
      this.libsqlClient = null;
      return;
    }

    // Local/Replica mode: clean up libSQL client then Knex
    if (this.libsqlClient) {
      this.libsqlClient.close();
      this.libsqlClient = null;
    }

    await super.disconnect();
  }

  /**
   * Check connection health.
   */
  override async checkHealth(): Promise<boolean> {
    if (this.isRemote) {
      return this.remoteTransport!.checkHealth();
    }
    return super.checkHealth();
  }

  // ===================================
  // CRUD (remote mode overrides)
  // ===================================

  override async find(object: string, query: any, options?: any): Promise<any[]> {
    if (this.isRemote) return this.remoteTransport!.find(object, query);
    return super.find(object, query, options);
  }

  override async findOne(object: string, query: any, options?: any): Promise<any> {
    if (this.isRemote) return this.remoteTransport!.findOne(object, query);
    return super.findOne(object, query, options);
  }

  override findStream(object: string, query: any, options?: any): any {
    if (this.isRemote) return this.remoteTransport!.findStream(object, query);
    return super.findStream(object, query, options);
  }

  override async create(object: string, data: Record<string, any>, options?: any): Promise<any> {
    if (this.isRemote) return this.remoteTransport!.create(object, data);
    return super.create(object, data, options);
  }

  override async update(object: string, id: string | number, data: Record<string, any>, options?: any): Promise<any> {
    if (this.isRemote) return this.remoteTransport!.update(object, id, data);
    return super.update(object, id, data, options);
  }

  override async upsert(object: string, data: Record<string, any>, conflictKeys?: string[], options?: any): Promise<Record<string, any>> {
    if (this.isRemote) return this.remoteTransport!.upsert(object, data, conflictKeys);
    return super.upsert(object, data, conflictKeys, options);
  }

  override async delete(object: string, id: string | number, options?: any): Promise<boolean> {
    if (this.isRemote) return this.remoteTransport!.delete(object, id);
    return super.delete(object, id, options);
  }

  override async count(object: string, query?: any, options?: any): Promise<number> {
    if (this.isRemote) return this.remoteTransport!.count(object, query);
    return super.count(object, query, options);
  }

  override async aggregate(object: string, query: any, options?: any): Promise<any> {
    if (this.isRemote) return this.remoteTransport!.aggregate(object, query);
    return super.aggregate(object, query, options);
  }

  // ===================================
  // Bulk Operations (remote mode overrides)
  // ===================================

  override async bulkCreate(object: string, data: any[], options?: any): Promise<any> {
    if (this.isRemote) return this.remoteTransport!.bulkCreate(object, data);
    return super.bulkCreate(object, data, options);
  }

  override async bulkUpdate(object: string, updates: Array<{ id: string | number; data: Record<string, any> }>, options?: any): Promise<Record<string, any>[]> {
    if (this.isRemote) return this.remoteTransport!.bulkUpdate(object, updates);
    return super.bulkUpdate(object, updates, options);
  }

  override async bulkDelete(object: string, ids: Array<string | number>, options?: any): Promise<void> {
    if (this.isRemote) return this.remoteTransport!.bulkDelete(object, ids);
    return super.bulkDelete(object, ids, options);
  }

  override async updateMany(object: string, query: any, data: any, options?: any): Promise<number> {
    if (this.isRemote) return this.remoteTransport!.updateMany(object, query, data);
    return super.updateMany(object, query, data, options);
  }

  override async deleteMany(object: string, query: any, options?: any): Promise<number> {
    if (this.isRemote) return this.remoteTransport!.deleteMany(object, query);
    return super.deleteMany(object, query, options);
  }

  // ===================================
  // Raw Execution (remote mode override)
  // ===================================

  override async execute(command: any, params?: any[], options?: any): Promise<any> {
    if (this.isRemote) return this.remoteTransport!.execute(command, params);
    return super.execute(command, params, options);
  }

  // ===================================
  // Transactions (remote mode overrides)
  // ===================================

  override async beginTransaction(): Promise<any> {
    if (this.isRemote) return this.remoteTransport!.beginTransaction();
    return super.beginTransaction();
  }

  override async commit(transaction: unknown): Promise<void> {
    if (this.isRemote) return this.remoteTransport!.commit(transaction);
    return super.commit(transaction);
  }

  override async rollback(transaction: unknown): Promise<void> {
    if (this.isRemote) return this.remoteTransport!.rollback(transaction);
    return super.rollback(transaction);
  }

  // ===================================
  // Schema Management (remote mode overrides)
  // ===================================

  override async syncSchema(object: string, schema: unknown, options?: any): Promise<void> {
    if (this.isRemote) return this.remoteTransport!.syncSchema(object, schema);
    return super.syncSchema(object, schema, options);
  }

  /**
   * Provision (CREATE/ALTER) physical tables for the given object definitions.
   *
   * In **remote** mode the base `SqlDriver.initObjects()` cannot be used because
   * it relies on Knex (`better-sqlite3`) to introspect and emit DDL — that
   * native binding is unavailable in serverless environments such as Vercel
   * Lambdas. Instead we route DDL through `RemoteTransport.syncSchemasBatch()`,
   * which uses `@libsql/client.batch()` against the Turso endpoint directly.
   *
   * In local / replica modes the existing Knex-based path remains in effect.
   */
  override async initObjects(
    objects: Array<{ name: string; fields?: Record<string, any> }>,
  ): Promise<void> {
    if (this.isRemote) {
      if (objects.length === 0) return;
      await this.remoteTransport!.syncSchemasBatch(
        objects.map((obj) => ({ object: obj.name, schema: obj })),
      );
      return;
    }
    return super.initObjects(objects);
  }

  /**
   * Batch-synchronize multiple schemas in a single round-trip.
   *
   * In remote mode, delegates to `RemoteTransport.syncSchemasBatch()` which
   * uses `client.batch()` to submit all DDL as one network call.
   * In local/replica mode, falls back to sequential `syncSchema()` calls
   * (Knex + better-sqlite3 is already local, so batching has no benefit).
   */
  async syncSchemasBatch(schemas: Array<{ object: string; schema: unknown }>, options?: any): Promise<void> {
    if (this.isRemote) {
      return this.remoteTransport!.syncSchemasBatch(schemas);
    }
    // Local/replica fallback: sequential sync (already fast with local SQLite)
    for (const { object, schema } of schemas) {
      await super.syncSchema(object, schema, options);
    }
  }

  override async dropTable(object: string, options?: any): Promise<void> {
    if (this.isRemote) return this.remoteTransport!.dropTable(object);
    return super.dropTable(object, options);
  }

  // ===================================
  // Turso-specific: Embedded Replica Sync
  // ===================================

  /**
   * Trigger manual sync of the embedded replica with the remote primary.
   * No-op if no syncUrl is configured or libSQL client is not initialized.
   */
  async sync(): Promise<void> {
    if (this.libsqlClient && this.tursoConfig.syncUrl) {
      await this.libsqlClient.sync();
    }
  }

  /**
   * Check if embedded replica sync is configured and active.
   */
  isSyncEnabled(): boolean {
    return !!this.tursoConfig.syncUrl && this.libsqlClient !== null;
  }

  /**
   * Get the underlying @libsql/client instance (if available).
   * Available in both remote and replica modes after connect().
   */
  getLibsqlClient(): Client | null {
    return this.libsqlClient;
  }

  /**
   * Get the RemoteTransport instance (only available in remote mode).
   */
  getRemoteTransport(): RemoteTransport | null {
    return this.remoteTransport;
  }
}
