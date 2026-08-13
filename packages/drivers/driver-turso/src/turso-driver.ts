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
 * - `libsql://`, `https://`, `http://`, `wss://` or `ws://` (no syncUrl) → remote
 *   (`http://` / `ws://` = plaintext, for self-hosted / local-dev endpoints)
 */

import { SqlDriver, type SqlDriverConfig } from '@objectstack/driver-sql';
import { StandardErrorCode } from '@objectstack/spec/api';
import type { DriverQuery } from '@objectstack/spec/contracts';
import type { DriverOptions } from '@objectstack/spec/data';
import type { Client } from '@libsql/client';
import { RemoteTransport } from './remote-transport.js';
import {
  backfillRemoteCanonicalColumns,
  type RemoteBackfillClient,
  type RemoteBackfillColumn,
  type RemoteCanonicalBackfillOptions,
  type RemoteCanonicalBackfillReport,
} from './remote-canonical-backfill.js';

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
   * - `libsql://` / `https://` / `http://` / `wss://` / `ws://` without syncUrl → `'remote'`
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

// ── Autonumber on the remote face ────────────────────────────────────────────

/**
 * [#6944] A record number this face cannot issue — refused, not written as NULL.
 *
 * # What was measured, and where the knowledge lives
 *
 * `TursoDriver` picks its transport from `url`. Local and embedded-replica
 * inherit `SqlDriver.create`, which calls `fillAutoNumberFields` and issues the
 * number from the persistent `_objectstack_sequences` table. Remote overrides
 * the write path to `RemoteTransport`, which builds its own `INSERT` and never
 * enters that method — so on this face `auto_number` was only a column mapped to
 * `TEXT`, and the slot the engine deliberately left empty stayed empty. Measured
 * on `main` @ `2f3e79351`, remote, `case_number: { type: 'autonumber' }`:
 *
 * ```
 * create      -> RESOLVED case_number=null
 * bulkCreate  -> RESOLVED [null, null]
 * upsert      -> RESOLVED case_number=null
 * LOCAL create-> RESOLVED case_number="CASE-00001"
 * ```
 *
 * The engine cannot catch this for the caller: `supports.autonumber` is `true`
 * here (inherited through `...super.supports`), so `engine.ts` defers generation
 * to the driver entirely and never runs its own fallback — see the driver table
 * in its `generateAutoNumbers` docblock, which already records `driver-turso` as
 * "inherited, no fallback path". A declared capability that boots and quietly
 * delivers nothing is the shape #3724 ruled on, and triage applied that ruling
 * here (2026-08-09): **disposition B, explicit refusal**. Implementing autonumber
 * on this transport (A) stays behind the appetite door for want of measured
 * demand — it is deferred, not overlooked.
 *
 * ⚠️ The refusal is raised HERE, on the driver, and not inside
 * `RemoteTransport`, because the transport cannot see what it would need to
 * decide: `RemoteTransport.create(object, data)` takes no schema, caches none
 * (`syncSchema` reads one and keeps nothing), and so cannot tell an
 * `auto_number` column from any other `TEXT` one. The driver can:
 * `registerRemoteFieldMetadata` → `SqlDriver.registerExternalObject` classifies
 * every field at remote schema-sync time and keys `autoNumberFields` strictly by
 * OBJECT name — measured populated in remote mode, tenant field and all. So the
 * knowledge exists exactly one layer above the statement builder, and that is
 * the layer that refuses.
 *
 * # Why NOT_IMPLEMENTED / 501 rather than 400
 *
 * The same two-class taxonomy this package already applies to aggregate
 * functions (#5907) and date buckets (#6212), and ADR-0112 for the vocabulary:
 * `autonumber` is a field type `@objectstack/spec` declares and this very
 * driver's other faces generate, so the caller's object definition is spelled
 * correctly and the request contains no mistake. The gap is the backend's.
 *
 * # What is deliberately NOT refused
 *
 * A record that ALREADY carries a value in the slot. `fillAutoNumberFields`
 * skips exactly those (`undefined` / `null` / `''` is its own generate
 * predicate, reused verbatim below rather than re-derived), and on this face
 * they are written through unchanged and correctly — measured. That is the
 * `isSystem` seed replay and the `preserveAudit` historical import, which
 * `engine.ts` exempts from its strip on purpose (#5503); refusing them would
 * break a path that works today and would take the two faces further apart, not
 * closer (#6203).
 */
/**
 * `SqlDriver.fillAutoNumberFields`'s own generate predicate: a slot holding
 * `undefined` / `null` / `''` is one the driver would have had to fill.
 *
 * Stated once, read twice — by the pre-write refusal below and by the
 * post-write report on the one leg that refusal provably cannot classify
 * (#7099). Two spellings of "empty" would be two answers to one question, and
 * the second one would drift.
 */
function isEmptyAutoNumberSlot(held: unknown): boolean {
  return held === undefined || held === null || held === '';
}

function refuseRemoteAutonumber(object: string, fields: string[], path: string): never {
  const err = new Error(
    `Object "${object}" declares auto_number field(s) [${fields.join(', ')}] left empty for this ` +
    `${path}, and the Turso REMOTE transport does not generate record numbers. ` +
    `Generated here: none — remote writes go through \`RemoteTransport\`, which builds its own ` +
    `INSERT and never enters \`SqlDriver.fillAutoNumberFields\`, so on this face \`auto_number\` ` +
    `is only a column mapped to TEXT. The object is spelled correctly and @objectstack/spec ` +
    `declares \`autonumber\` as a field type this driver's local and embedded-replica faces do ` +
    `generate — this is a capability gap in the remote transport, not a mistake in the request, ` +
    `which is why it answers NOT_IMPLEMENTED/501 rather than a 400. Use the local or ` +
    `embedded-replica transport for objects that carry record numbers, or supply the value ` +
    `explicitly (a seed replay or \`preserveAudit\` import keeps its own numbers and is written ` +
    `unchanged). Until this change the same call RESOLVED and wrote NULL into the slot (#6944).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
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

  public override get supports() {
    // Inherit the SqlDriver capability baseline (incl. autonumber via the
    // shared `_objectstack_sequences` mechanism, and any future flags) and
    // override only where Turso/libSQL genuinely differs. Spreading the base
    // keeps this in lock-step with `DriverCapabilities` so a new base flag can
    // never make this override an incomplete type again.
    //
    // Only bits the engine actually READS belong here. `savepoints` /
    // `queryCTE` / `fullTextSearch` / `jsonQuery` / `connectionPooling` used to
    // be declared true/false right below — accurate statements about libSQL
    // that nothing ever consumed, and objectstack#4634 (ADR-0049
    // enforce-or-remove) retired them from `DriverCapabilities` along with 26
    // other zero-reader bits. Do not re-add a bit here to "document" an engine
    // feature: a capability flag is a promise the engine dispatches on, and one
    // nobody reads is a claim that can silently go false. Documentation goes in
    // prose; a real dispatch point goes in the spec first.
    return {
      ...super.supports,

      // Turso/libSQL batches DDL over one round-trip — see `syncSchemasBatch`.
      // The engine ANDs this bit with that method's presence, which is why the
      // bit is load-bearing rather than inferable: this class inherits the
      // method shape from SqlDriver, whose transport genuinely cannot batch.
      batchSchemaSync: true,

      // Remote transport does NOT do native date bucketing. SqlDriver's
      // `aggregate` — which emits `date_trunc`/`strftime` for structured
      // `{ field, dateGranularity }` groupBy items — is only reached in
      // local/replica mode; remote mode delegates `aggregate` to
      // `RemoteTransport.aggregate`, which accepts only string group-by
      // identifiers and has no bucketing. Inheriting SqlDriver's
      // `queryDateGranularity` in remote mode is therefore a FALSE capability:
      // the analytics engine (NativeSQLStrategy declines granularity →
      // ObjectQLStrategy → engine.aggregate) trusts `supports.queryDateGranularity`
      // and pushes the structured groupBy down to `RemoteTransport.aggregate`,
      // which stringifies the object to "[object Object]" and rejects it
      // (500 ANALYTICS_QUERY_FAILED — a whole dashboard widget stuck loading).
      // Advertise no native granularity in remote mode so the engine falls back
      // to `find()` (works remotely) + in-memory `bucketDateValue()` bucketing,
      // which the contract guarantees is always correct. See
      // @objectstack/spec `driver.zod.ts` (`queryDateGranularity`: "missing keys
      // fall back to in-memory bucketing") and objectql `engine.ts` aggregate
      // dispatch. Local/replica keep native bucketing via SqlDriver.
      // (Empty record — not `undefined` — to stay assignable to SqlDriver's
      // inferred `Record<string, boolean>` supports type; every granularity is
      // absent, so all fall back.)
      ...(this.transportMode === 'remote'
        ? { queryDateGranularity: {} as Record<string, boolean> }
        : {}),
    };
  }

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

  /**
   * Objects whose physical table THIS driver created through the remote
   * transport — the remote-mode answer to the one question
   * {@link SqlDriver.paginationTieBreaker} asks.
   *
   * Local mode records that fact inside `SqlDriver.initObjects`, in
   * `managedObjectFields`. Remote DDL never reaches that method (it goes out
   * over `@libsql/client` — see {@link initObjects}), so the base map stays
   * empty however many tables the transport has created, and the inherited
   * rule reading an empty map would answer "not mine" for every object in
   * remote mode. Same question, same answer, different place to look it up.
   */
  private readonly remoteManagedObjects = new Set<string>();

  constructor(config: TursoDriverConfig) {
    const mode = TursoDriver.detectMode(config);
    const knexConfig = TursoDriver.toKnexConfig(config, mode);
    super(knexConfig);
    this.tursoConfig = config;
    this.transportMode = mode;

    if (mode === 'remote') {
      this.remoteTransport = new RemoteTransport();

      // The COLUMN half of the temporal seam (ADR-0053 D-A1). `toRemoteFilter`
      // below puts the comparand into storage form via `temporalFilterValue`;
      // its inherited companion `temporalFilterColumnSql` says how the column
      // must be READ so the two are in the same form, and its own contract
      // calls coercing the value "necessary but NOT sufficient — a caller that
      // binds `temporalFilterValue` must wrap its column with this too, or it
      // keeps half the bug". Handing the transport the rule (not a copy of it)
      // is what keeps a single dialect-aware implementation.
      this.remoteTransport.setFilterColumnSql((object, field, columnSql) =>
        this.temporalFilterColumnSql(object, field, columnSql),
      );

      // [#7929] The server-side half of a REDACTED filter refusal. The remote
      // compiler withholds the operands of a cross-field comparison for the
      // same reason the inherited local one does — an RLS rule's columns are
      // not the caller's to read — and this line is what stops the withheld
      // text from being withheld from the OPERATOR too. `this.logger` is
      // `SqlDriver`'s own sink, so a host that injected a logger for local mode
      // gets remote mode's diagnostics in the same place, and a deployment
      // cannot lose them by changing its connection string.
      this.remoteTransport.setDiagnosticSink((message) => this.logger.warn(message));

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

    // Remote URL (libsql://, https://, http://, wss://, ws://).
    // `http://` and `ws://` are plaintext transports used against a
    // self-hosted / local-dev Turso-compatible endpoint (e.g. an ObjectBase
    // gateway with no TLS termination, or sqld on localhost). @libsql/client
    // natively accepts these schemes; they MUST be classified as remote so
    // queries go over the wire — otherwise the URL falls through to the
    // local-SQLite fallback below and silently writes to an ephemeral
    // in-memory DB (data never reaches the remote, lost on every restart).
    if (
      url.startsWith('libsql://') ||
      url.startsWith('https://') ||
      url.startsWith('http://') ||
      url.startsWith('wss://') ||
      url.startsWith('ws://')
    ) {
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
  //
  // [#6402] Every `options` parameter in this file is a {@link DriverOptions},
  // matching `SqlDriver` / `IDataDriver` — the two faces of one driver may not
  // declare one argument two ways. This was the last `any` axis left in the
  // overrides: #5181 (PR #6076), #6075 (PR #6210) and #6212 each narrowed
  // `query`, and each deliberately left `options` alone because it is a
  // SEPARATE axis whose shape was verbatim-identical across all 17 overrides —
  // narrowing one would have read as a verdict on the other sixteen. #6402
  // closed all 17 in one sweep, so there is no half-narrowed state to
  // interpret. Keep it that way: a new override here declares `DriverOptions`.

  override async find(object: string, query: DriverQuery, options?: DriverOptions): Promise<any[]> {
    if (this.isRemote) return this.formatRemoteRows(object, await this.remoteTransport!.find(object, this.toRemoteReadQuery(object, query)));
    return super.find(object, query, options);
  }

  override async findOne(object: string, query: DriverQuery, options?: DriverOptions): Promise<any> {
    if (this.isRemote) return this.formatRemoteRow(object, await this.remoteTransport!.findOne(object, this.toRemoteReadQuery(object, query, { singleRowLookup: true })));
    return super.findOne(object, query, options);
  }

  // `findStream` was retired from `IDataDriver` in spec 17.0.0
  // (objectstack#4484): a required method with no caller anywhere, whose SQL and
  // memory implementations awaited `find()` for the whole result set before
  // yielding — the opposite of the memory guarantee it was declared for. This
  // override went with the base method; page `find()` with `limit`/`offset`.

  /**
   * [#6944] Refuse a remote write that would need a record number this face
   * cannot issue — see {@link refuseRemoteAutonumber} for the ruling and the
   * measurements.
   *
   * Called BEFORE `toRemoteWriteForms` and before any statement is built, so a
   * refused write costs no round trip — the rule every other refusal on this
   * path already follows, and the one the refusal suites assert.
   *
   * The lookup is `autoNumberFields[object]` with no table-name fallback,
   * unlike `fillAutoNumberFields`. That is not a shortcut: in remote mode the
   * only writer of this registry is `registerRemoteFieldMetadata`, whose own
   * docs record that it keys strictly by `object` ("never let a stray
   * `schema.name` shadow it"), and the Knex path that produces the other key is
   * unreachable here. A second lookup rule would be a second answer.
   *
   * A no-op for an object with no `auto_number` field, which is the overwhelming
   * majority — one map read per remote write.
   */
  private refuseUngeneratableRemoteAutonumber(
    object: string,
    rows: Array<Record<string, any> | null | undefined>,
    path: string,
  ): void {
    const cfgs = this.autoNumberFields[object];
    if (!cfgs || cfgs.length === 0) return;
    const empty = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const cfg of cfgs) {
        if (isEmptyAutoNumberSlot(row[cfg.name])) empty.add(cfg.name);
      }
    }
    if (empty.size > 0) refuseRemoteAutonumber(object, [...empty], path);
  }

  /**
   * [#7099] Say out loud that a remote write landed a row whose declared
   * `auto_number` column holds no record number.
   *
   * # Why this exists beside the refusal, rather than inside it
   *
   * {@link refuseUngeneratableRemoteAutonumber} runs BEFORE the statement is
   * built, which is what makes a refused write cost zero round trips — and is
   * also the reason it cannot cover every leg. An upsert carrying an `id` or
   * explicit `conflictKeys` may merge (safe: the row keeps the number already
   * in its column) or may insert (the slot lands NULL), and which one it did is
   * not knowable before it runs. #6944 left that leg as declared residue.
   *
   * What has since been measured is that the round trip the residue was
   * attributed to is **already paid**: `RemoteTransport.upsert` follows its
   * `INSERT … ON CONFLICT` with `SELECT * FROM "<object>" WHERE "id" = ?` and
   * returns the mapped row, unconditionally. So the NULL is in hand at no extra
   * cost, on the layer that knows which column is an `auto_number` — and the
   * leg can be made loud without buying anything. Note the check is not "did it
   * insert or merge": it is one field read on a row this method already holds.
   *
   * # Report, not refuse — deliberately
   *
   * The write has already happened when this runs. Refusing here would be a
   * different act from the pre-write gate (it would have to undo a landed row),
   * and that trade-off is untouched by this change: nothing about what the
   * remote face accepts or rejects moves. Generating the number on remote stays
   * behind the same appetite door (#6944 disposition A) it always has.
   *
   * # `warn`, not `error`
   *
   * By AGENTS.md §Degradation log levels this is a FUNCTIONAL degradation, not
   * a durability one: everything the caller submitted persisted, nothing it
   * claims to have stored is missing, and the returned row carries the `null`
   * in plain sight rather than reporting a success that did not happen. What is
   * absent is a DERIVED value this face declares it does not issue — the same
   * capability gap the sibling legs answer with `NOT_IMPLEMENTED`/501. Grading
   * it `error` would file a known capability gap beside real data loss, which
   * is the over-application that rule warns about by name.
   *
   * # Not throttled, unlike the tenant-audit warning
   *
   * `SqlDriver.tenantAuditWarned` collapses its warning per `{object}:{op}`
   * because that one reports a CONFIGURATION mistake — the second occurrence
   * carries no information the first did not. Here the row `id` IS the payload:
   * each occurrence names a different row that landed without a record number,
   * and that list is what an operator repairs. One line per unnumbered row is
   * proportional, not noisy.
   */
  private reportUnnumberedRemoteRow(
    object: string,
    row: Record<string, any> | null | undefined,
    path: string,
  ): void {
    const cfgs = this.autoNumberFields[object];
    if (!cfgs || cfgs.length === 0) return;
    if (!row || typeof row !== 'object') return;
    const unfilled = cfgs
      .filter((cfg) => isEmptyAutoNumberSlot(row[cfg.name]))
      .map((cfg) => cfg.name);
    if (unfilled.length === 0) return;
    this.logger.warn(
      `[driver-turso] ${path} on "${object}" returned row id ${JSON.stringify(row.id)} with ` +
      `auto_number field(s) [${unfilled.join(', ')}] left empty. The Turso REMOTE transport does ` +
      `not generate record numbers, so an upsert that matches no existing row inserts one without ` +
      `it — the row is persisted, its record number is not, and nothing else reports this. Supply ` +
      `the value explicitly on this path (a seed replay or import keeps its own numbers and is ` +
      `written unchanged), or use the local / embedded-replica transport, which do issue them ` +
      `(#7099).`,
      { object, fields: unfilled, id: row.id, path },
    );
  }

  override async create(object: string, data: Record<string, any>, options?: DriverOptions): Promise<any> {
    if (this.isRemote) {
      this.refuseUngeneratableRemoteAutonumber(object, [data], 'create');
      return this.formatRemoteRow(object, await this.remoteTransport!.create(object, this.toRemoteWriteForms(object, data)));
    }
    return super.create(object, data, options);
  }

  override async update(object: string, id: string | number, data: Record<string, any>, options?: DriverOptions): Promise<any> {
    if (this.isRemote) return this.formatRemoteRow(object, await this.remoteTransport!.update(object, id, this.toRemoteWriteForms(object, data)));
    return super.update(object, id, data, options);
  }

  override async upsert(object: string, data: Record<string, any>, conflictKeys?: string[], options?: DriverOptions): Promise<Record<string, any>> {
    if (this.isRemote) {
      // [#6944] An upsert is insert-OR-merge, and only the merge leg is safe
      // here: `RemoteTransport.upsert` emits
      // `INSERT … ON CONFLICT(<keys>) DO UPDATE`, so a row that matches keeps
      // the number already in its column and never needed one issued — measured
      // (an `id`-bearing upsert onto an existing `CASE-00042` merged and kept
      // it). Refusing that would break a path that works.
      //
      // The insert leg is refused where it is PROVABLE without a round trip: no
      // `id`/`_id` and no explicit `conflictKeys` means the transport mints a
      // fresh nanoid for the sole default merge key, so the statement can only
      // insert — measured, two such upserts produced two rows with different
      // ids. That is also the shape the engine sends for a new record.
      //
      // ⚠️ The leg the pre-write gate cannot classify: an upsert that DOES
      // carry an id or conflict keys but matches nothing still inserts, and on
      // that leg the slot is still written NULL. That outcome is UNCHANGED by
      // #7099 — what changed is that it is no longer silent. The row comes back
      // through this method, so the NULL can be read AFTER the write and
      // reported, without the probe query the pre-write gate exists to avoid
      // and without turning an accepted write into a refused one. Generating
      // the number here stays behind the deferred half (A).
      const mayMerge = data?.id !== undefined || data?._id !== undefined
        || (Array.isArray(conflictKeys) && conflictKeys.length > 0);
      if (!mayMerge) this.refuseUngeneratableRemoteAutonumber(object, [data], 'upsert');
      const row = this.formatRemoteRow(object, await this.remoteTransport!.upsert(object, this.toRemoteWriteForms(object, data), conflictKeys));
      // Judged on the row the CALLER receives, after read-coercion — reporting
      // a different value than the one handed out would be its own defect. The
      // `!mayMerge` leg reaches this too and is a no-op there by construction:
      // an empty slot was already refused above, and a caller-supplied number
      // comes back filled.
      this.reportUnnumberedRemoteRow(object, row, 'upsert');
      return row;
    }
    return super.upsert(object, data, conflictKeys, options);
  }

  override async delete(object: string, id: string | number, options?: DriverOptions): Promise<boolean> {
    if (this.isRemote) return this.remoteTransport!.delete(object, id);
    return super.delete(object, id, options);
  }

  override async count(object: string, query?: DriverQuery, options?: DriverOptions): Promise<number> {
    if (this.isRemote) return this.remoteTransport!.count(object, this.toRemoteQuery(object, query));
    return super.count(object, query, options);
  }

  /**
   * [#6212] `query` is a {@link DriverQuery}, matching the narrowed
   * `SqlDriver.aggregate` this forwards to — the two faces of one driver may not
   * declare one argument two ways.
   *
   * [#6402] `options` is a {@link DriverOptions} for the same reason, closed as
   * one sweep across every override in this file rather than one method at a
   * time — see the block comment above `find()`.
   */
  override async aggregate(object: string, query: DriverQuery, options?: DriverOptions): Promise<any> {
    if (this.isRemote) return this.remoteTransport!.aggregate(object, this.toRemoteQuery(object, query));
    return super.aggregate(object, query, options);
  }

  // ===================================
  // Remote read-coercion helpers
  // ===================================
  //
  // The remote transport (`@libsql/client`) returns raw SQLite column values —
  // booleans as 0/1, JSON as text, dates as raw strings — because it has no
  // field-type metadata. Local/replica mode routes reads through
  // `SqlDriver.formatOutput()`, which coerces those back to their declared
  // types. These helpers run the SAME `formatOutput()` on remote rows so both
  // transports agree on what a value *is*; without them a CEL guard like
  // `field != true` sees `1 != true` (always true) on cloud/Turso but not
  // locally — the exact divergence behind the case_escalation incident.

  // ===================================
  // Remote temporal seam (ADR-0053 D-A1, #937)
  // ===================================
  //
  // `formatOutput` above closed the READ half of the transport asymmetry. The
  // WRITE and FILTER halves were still open: `RemoteTransport` builds its own
  // SQL (`buildWhereSQL`, `serializeValue`) and never touches the SqlDriver
  // seam, which is exactly the surface ADR-0053 D-A1 legislates about —
  //
  //   any surface that binds a filter comparand into raw SQL MUST coerce
  //   through the driver's dialect-aware temporal coercion, never re-derive a
  //   type from the value's textual shape
  //
  // — and measurement matched the prediction: a bare-day `$lte` dropped the
  // whole final day (framework#3777's shape, worse than pre-fix local because
  // even the midnight row went), `$between` fell through `buildWhereSQL`'s
  // `default:` arm into an equality against a JSON-stringified array and
  // matched NOTHING, and a `Field.date` written as a `Date` was serialised to
  // full ISO while a REST write of the same day stored `YYYY-MM-DD`, so one
  // column held two forms (framework#1874 / D-E1 all over again).
  //
  // The fix is not to grow `buildWhereSQL` a matching set of operator arms —
  // that is the second implementation D-A1 exists to prevent. It is to put the
  // payload and the comparands into the driver's storage form BEFORE they
  // reach the transport, reusing the inherited members. `RemoteTransport` stays
  // the dumb SQL builder it is documented to be.

  /**
   * Put a write payload into the storage form the filter path reads against —
   * the write half `RemoteTransport` skipped by never reaching
   * `SqlDriver.create`.
   *
   * This is `formatInput`, the same function local mode applies, so the two
   * transports cannot disagree about what a written value becomes. Remote mode
   * runs on libsql (SQLite), and the base config is `better-sqlite3`, so every
   * dialect branch inside it resolves the way local mode's does.
   *
   * The write-column map is deliberately NOT applied: a managed object is its
   * own physical table here (see `registerRemoteFieldMetadata`), so the mapping
   * is a no-op, and the transport addresses columns by object-field name.
   */
  private toRemoteWriteForms<T>(object: string, data: T): T {
    if (!data || typeof data !== 'object') return data;
    return this.formatInput(object, data) as T;
  }

  /**
   * Compile a filter into the storage forms and operator shapes the remote
   * transport can bind correctly.
   *
   * Three things happen here, and the ORDER of the last two is load-bearing
   * (ADR-0053 D-E3): the calendar-day widening is a *calendar* operation and
   * must run on the bare-day STRING, with only the resulting bound converted to
   * storage form. Converting first would hand `nextUtcCalendarDay` an instant,
   * which it correctly refuses to widen — silently narrowing a whole-day window
   * back to a midnight one.
   */
  private toRemoteFilter(object: string, where: unknown): unknown {
    if (where == null || typeof where !== 'object') return where;
    if (Array.isArray(where)) return where.map((w) => this.toRemoteFilter(object, w));
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(where as Record<string, unknown>)) {
      if ((key === '$and' || key === '$or') && Array.isArray(val)) {
        out[key] = val.map((sub) => this.toRemoteFilter(object, sub));
        continue;
      }
      // `$not` carries ONE nested filter condition, so it recurses like the two
      // array combinators rather than passing through as an opaque `$`-key
      // (#1076). Skipping it left every condition INSIDE a negation on the raw
      // path, i.e. short of the seam this method IS: `$between` was never
      // lowered (so `{ $not: { amount: { $between: […] } } }` reached a
      // transport that correctly refuses un-lowered `$between`, naming a step
      // that had in fact been skipped), and a bare `YYYY-MM-DD` upper bound was
      // never widened to the whole calendar day (framework#3777) — which under
      // a negation hands BACK exactly the rows the day was meant to cover.
      // Comparand storage form and the operator lowerings apply at every depth
      // a condition can appear at, so the recursion has to reach all of them.
      if (key === '$not') {
        out[key] = this.toRemoteFilter(object, val);
        continue;
      }
      out[key] = key.startsWith('$') ? val : this.toRemoteFieldSpec(object, key, val);
    }
    return out;
  }

  /** One field's comparand(s), in storage form and with `$between` lowered. */
  private toRemoteFieldSpec(object: string, field: string, spec: unknown): unknown {
    if (spec == null) return spec;
    // A bare scalar / `Date` is implicit equality; a bare array is not a valid
    // field spec for this transport, so it is left for `buildWhereSQL` to
    // handle exactly as before.
    if (typeof spec !== 'object' || spec instanceof Date) {
      return this.temporalFilterValue(object, field, spec);
    }
    if (Array.isArray(spec)) return spec;

    const out: Record<string, unknown> = {};
    for (const [op, raw] of Object.entries(spec as Record<string, unknown>)) {
      switch (op) {
        case '$between': {
          // Lowered to its two bounds rather than given an operator of its own
          // (framework#4081): the upper-bound arm below already carries the
          // whole-day calendar rule, so a range's max inherits it by
          // construction instead of via a second implementation.
          if (!Array.isArray(raw) || raw.length !== 2) {
            throw new Error(
              `[TursoDriver] $between on '${object}.${field}' needs exactly two bounds, got ` +
                `${JSON.stringify(raw)}. Refusing rather than widening the query silently.`,
            );
          }
          out.$gte = this.temporalFilterValue(object, field, raw[0]);
          Object.assign(out, this.toRemoteUpperBound(object, field, '$lte', raw[1]));
          break;
        }
        case '$lte':
          Object.assign(out, this.toRemoteUpperBound(object, field, op, raw));
          break;
        case '$in':
        case '$nin':
          out[op] = Array.isArray(raw)
            ? raw.map((v) => this.temporalFilterValue(object, field, v))
            : raw;
          break;
        // Text predicates and existence checks take no temporal comparand.
        // (`$regex` is the better-auth adapter's spelling of a substring search
        // — a comparand the temporal coercion must likewise keep its hands off.)
        case '$contains':
        case '$notContains':
        case '$startsWith':
        case '$endsWith':
        case '$regex':
        case '$null':
        case '$exists':
          out[op] = raw;
          break;
        default:
          out[op] = this.temporalFilterValue(object, field, raw);
      }
    }
    return out;
  }

  /**
   * An inclusive upper bound, compiled half-open when the comparand is a bare
   * calendar day on a `datetime` column (ADR-0053 D-D1, framework#3777).
   *
   * `calendarDayUpperBoundRewrite` is the inherited authority for that rule and
   * already scopes itself to `datetime`, so `date`/`time` columns compile
   * byte-identically to before.
   */
  private toRemoteUpperBound(
    object: string,
    field: string,
    op: string,
    raw: unknown,
  ): Record<string, unknown> {
    const rewritten = this.calendarDayUpperBoundRewrite(object, field, op, raw);
    if (rewritten) return { [rewritten.op]: rewritten.value };
    return { [op]: this.temporalFilterValue(object, field, raw) };
  }

  /** A query with its `where` compiled through {@link toRemoteFilter}. */
  private toRemoteQuery(object: string, query?: DriverQuery): any {
    if (!query || typeof query !== 'object' || query.where == null) return query;
    return { ...query, where: this.toRemoteFilter(object, query.where) };
  }

  /**
   * A READ query as the remote transport should receive it: the caller's
   * `where` compiled through {@link toRemoteQuery}, and the complete ORDER BY
   * the deterministic-paging contract asks for (`IDataDriver.find`,
   * objectstack#4363) already resolved into `orderBy`.
   *
   * The order comes from the inherited {@link SqlDriver.orderKeysFor} — the
   * same method local mode calls, not a second copy of its three-state table —
   * so the two transports of this ONE driver cannot answer the same paged
   * query with different ordering guarantees when only the URL differs. That
   * split is the seam ADR-0053 D-A1 exists to close, and it was open here:
   * `RemoteTransport.buildSelectSQL` mapped the caller's `orderBy` verbatim and
   * appended no unique column, so `ORDER BY status LIMIT 50 OFFSET 50` served
   * its ties in whatever arrangement the plan chose — one row twice, another
   * never, several screens apart (#5653). `RemoteTransport` keeps its job:
   * assemble SQL for the query it is handed.
   *
   * Deriving it HERE rather than inside `buildSelectSQL` is also what keeps
   * `findOne` correct. The transport spells an id lookup as
   * `find(object, { ...query, limit: 1 })`, so by the time the SQL is built a
   * `findOne` is indistinguishable from "page one of a walk with page size 1"
   * — and the two want opposite things: `ORDER BY id LIMIT 1` is the shape
   * that makes a planner abandon the predicate's own index and walk the
   * primary key instead (~100× on the measurement recorded in
   * `SqlDriver.findRows`), and `findOne` promises *a* matching record, never a
   * position in a sequence. Up here the two callers are still distinguishable,
   * and `singleRowLookup` is how they say so — exactly as they do locally.
   *
   * `orderKeysFor` returns `[]` for the third row of its table — an unpaged
   * read with no `orderBy` (#4363's deliberate carve-out) — and an empty
   * `orderBy` makes `buildSelectSQL` emit no ORDER BY clause at all, i.e. the
   * same statement it emitted before this method existed.
   */
  private toRemoteReadQuery(
    object: string,
    query: DriverQuery,
    opts?: { singleRowLookup?: boolean },
  ): any {
    if (!query || typeof query !== 'object') return query;
    const orderBy = this.orderKeysFor(object, query, opts).map((key) => ({
      field: key.field,
      order: key.direction,
    }));
    return this.toRemoteQuery(object, { ...query, orderBy });
  }

  /**
   * The unique column a paged read can be made deterministic with (#4363),
   * answered for remote mode.
   *
   * The RULE is not restated here: {@link SqlDriver.orderKeysFor} still decides
   * *when* a tie-breaker is appended and in which direction, and remote reads
   * go through it (see {@link toRemoteReadQuery}). What is remote-specific is
   * the single FACT that rule needs — did this driver create the table, and
   * does it therefore carry an `id` primary key?
   * `RemoteTransport.buildCreateTableSQL` opens every table it creates with
   * `"id" TEXT PRIMARY KEY`, so for anything this driver synced the answer is
   * yes; it is simply recorded in {@link remoteManagedObjects}, because the
   * base class's `managedObjectFields` is filled by `SqlDriver.initObjects`
   * and remote DDL never calls it.
   *
   * The base method's conservatism is kept deliberately for everything else: a
   * table this driver did not create still gets `null` and no invented ORDER
   * BY. An `id` column that is not there fails the whole statement, and
   * guessing on a federated table (ADR-0015) would trade a reshuffle among
   * ties for the loss of the caller's entire result.
   */
  protected override paginationTieBreaker(object: string): string | null {
    if (!this.isRemote) return super.paginationTieBreaker(object);
    return this.remoteManagedObjects.has(object) ? 'id' : null;
  }

  /** Apply the inherited read-coercion to a single remote row (in place). */
  private formatRemoteRow<T>(object: string, row: T): T {
    if (row && typeof row === 'object') this.formatOutput(object, row as any);
    return row;
  }

  /** Apply read-coercion to every remote row (in place). */
  private formatRemoteRows<T extends any[]>(object: string, rows: T): T {
    if (Array.isArray(rows)) for (const row of rows) this.formatRemoteRow(object, row);
    return rows;
  }

  /**
   * Populate the read-coercion registries (boolean/json/date/numeric/…) for a
   * managed object in REMOTE mode WITHOUT running any DDL. `SqlDriver.initObjects`
   * normally does this, but TursoDriver's remote path routes DDL through
   * `RemoteTransport` and never reaches it, leaving the registries empty so
   * `formatOutput()` had nothing to coerce. Reuse the base `registerExternalObject`,
   * whose sole documented job is exactly this — it classifies fields with the
   * canonical logic, so the two can never drift. A managed object is its own
   * physical table, so the default `remoteName === name` mapping is a no-op for
   * the RemoteTransport SQL (which addresses tables by object name directly).
   *
   * It also records the object as one whose table this driver created, which is
   * the whole input to {@link paginationTieBreaker} in remote mode. That goes
   * FIRST and outside the `try`: both callers reach here only after the DDL has
   * already succeeded, so the table exists with its `id` primary key whether or
   * not the best-effort coercion registration below does.
   */
  private registerRemoteFieldMetadata(obj: { name: string; fields?: Record<string, any> }): void {
    this.remoteManagedObjects.add(obj.name);
    try {
      this.registerExternalObject({ name: obj.name, fields: obj.fields, tenancy: (obj as any).tenancy });
    } catch {
      /* metadata registration is best-effort; never block schema sync on it */
    }
  }

  /**
   * Converge this driver's REMOTE `Field.datetime` / `Field.time` columns on the
   * canonical storage form and mark the ones that are PROVED converged, so their
   * filters stop compiling to the unindexable repair expression
   * (objectstack#5770, cloud#1005 后果 A; the maintainer's 2026-08-03 方案 1).
   *
   * The remote-mode counterpart of `SqlDriver.backfillCanonicalDatetimes` /
   * `backfillCanonicalTimes`, which are Knex paths and therefore never ran here.
   * Same semantics, same expression, same consumption point: this marks
   * `canonicalDatetimeFields` / `canonicalTimeFields`, which is exactly what
   * `needsLegacyDatetimeRepair` / `needsLegacyTimeRepair` read to drop the
   * repair — so remote and local reach the indexable form through one rule
   * rather than two. It additionally recovers the TEXT-affinity numeric epochs
   * only a remote table can hold (后果 B); see `remote-canonical-backfill.ts`
   * for why that limb is safe HERE and was rejected in the shared expression.
   *
   * Called automatically after remote schema sync, and public so an operator can
   * drive a large table to completion with a bigger budget:
   *
   * ```typescript
   * await driver.backfillRemoteCanonicalTemporal({ batchSize: 2000, maxBatches: 5000 });
   * ```
   *
   * Never throws and never marks on anything but measured evidence. A column
   * that errors, or that a batch budget stopped short, stays unmarked and keeps
   * its read-side repair — correct answers, just unindexed. Nothing in any read
   * or write path may depend on this having run (ADR-0053 D-B3 / cloud#1003).
   *
   * A no-op outside remote mode: local and replica reach the same state through
   * the inherited Knex backfill during `initObjects`.
   */
  async backfillRemoteCanonicalTemporal(
    options?: RemoteCanonicalBackfillOptions,
  ): Promise<RemoteCanonicalBackfillReport> {
    if (!this.isRemote) return { columns: [] };
    const client = this.remoteTransport?.getClient() as RemoteBackfillClient | null | undefined;
    if (!client) return { columns: [] };

    // Only tables this driver synced remotely, and only columns not already
    // marked — re-running is cheap by design, but skipping a proved column
    // makes it free.
    const columns: RemoteBackfillColumn[] = [];
    for (const table of this.remoteManagedObjects) {
      for (const field of this.datetimeFields[table] ?? []) {
        if (this.canonicalDatetimeFields[table]?.has(field)) continue;
        columns.push({ table, field, kind: 'datetime' });
      }
      for (const field of this.timeFields[table] ?? []) {
        if (this.canonicalTimeFields[table]?.has(field)) continue;
        columns.push({ table, field, kind: 'time' });
      }
    }
    if (columns.length === 0) return { columns: [] };

    const report = await backfillRemoteCanonicalColumns(
      client,
      columns,
      // The driver's OWN repair expression — handed over, never copied, so the
      // backfill cannot drift from the read path it is retiring.
      (kind, columnSql) =>
        kind === 'datetime'
          ? this.sqliteCanonicalDatetimeSql(columnSql)
          : this.sqliteCanonicalTimeSql(columnSql),
      options,
      this.logger,
    );

    for (const column of report.columns) {
      if (!column.canonical) continue;
      const marks =
        column.kind === 'datetime'
          ? (this.canonicalDatetimeFields[column.table] ??= new Set<string>())
          : (this.canonicalTimeFields[column.table] ??= new Set<string>());
      marks.add(column.field);
    }

    return report;
  }

  /**
   * Run {@link backfillRemoteCanonicalTemporal} off the back of a remote schema
   * sync, swallowing everything.
   *
   * The local twin is invoked from inside `SqlDriver.initObjects` for the same
   * reason and with the same posture: schema sync is the moment the driver knows
   * which columns are temporal, and a migration must never be able to fail a
   * boot. `backfillRemoteCanonicalTemporal` already reports rather than throws;
   * this catch covers the paths that could still reject (a client lost between
   * the sync and here).
   */
  private async backfillRemoteCanonicalTemporalQuietly(): Promise<void> {
    try {
      await this.backfillRemoteCanonicalTemporal();
    } catch (err) {
      this.logger.warn(
        `[driver-turso] remote canonical temporal backfill failed; ` +
        `queries stay correct via the read-side repair`,
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  // ===================================
  // Bulk Operations (remote mode overrides)
  // ===================================

  override async bulkCreate(object: string, data: any[], options?: DriverOptions): Promise<any> {
    if (this.isRemote) {
      // [#6944] Same refusal as `create`, and it has to be stated here rather
      // than inherited: `RemoteTransport.bulkCreate` loops its OWN `create`, not
      // this class's, so nothing about the single-row override reaches this
      // path. Refused for the whole batch before any row is written — the
      // statement is all-or-nothing on this transport too, so a partial batch is
      // not a state this can leave behind.
      this.refuseUngeneratableRemoteAutonumber(object, Array.isArray(data) ? data : [], 'bulkCreate');
      const formatted = Array.isArray(data) ? data.map((d) => this.toRemoteWriteForms(object, d)) : data;
      return this.formatRemoteRows(object, await this.remoteTransport!.bulkCreate(object, formatted));
    }
    return super.bulkCreate(object, data, options);
  }

  override async bulkUpdate(object: string, updates: Array<{ id: string | number; data: Record<string, any> }>, options?: DriverOptions): Promise<Record<string, any>[]> {
    if (this.isRemote) {
      const formatted = Array.isArray(updates)
        ? updates.map((u) => ({ ...u, data: this.toRemoteWriteForms(object, u.data) }))
        : updates;
      return this.formatRemoteRows(object, await this.remoteTransport!.bulkUpdate(object, formatted));
    }
    return super.bulkUpdate(object, updates, options);
  }

  override async bulkDelete(object: string, ids: Array<string | number>, options?: DriverOptions): Promise<void> {
    if (this.isRemote) return this.remoteTransport!.bulkDelete(object, ids);
    return super.bulkDelete(object, ids, options);
  }

  override async updateMany(object: string, query: DriverQuery, data: any, options?: DriverOptions): Promise<number> {
    if (this.isRemote) {
      return this.remoteTransport!.updateMany(object, this.toRemoteQuery(object, query), this.toRemoteWriteForms(object, data));
    }
    return super.updateMany(object, query, data, options);
  }

  override async deleteMany(object: string, query: DriverQuery, options?: DriverOptions): Promise<number> {
    if (this.isRemote) return this.remoteTransport!.deleteMany(object, this.toRemoteQuery(object, query));
    return super.deleteMany(object, query, options);
  }

  // ===================================
  // Raw Execution (remote mode override)
  // ===================================

  override async execute(command: any, params?: any[], options?: DriverOptions): Promise<any> {
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

  override async syncSchema(object: string, schema: unknown, options?: DriverOptions): Promise<void> {
    if (this.isRemote) {
      await this.remoteTransport!.syncSchema(object, schema);
      // See initObjects(): populate the read-coercion registries for remote mode.
      // Key strictly by `object` (what find()/formatOutput look up) — never let a
      // stray `schema.name` shadow it.
      this.registerRemoteFieldMetadata({ ...(schema as Record<string, any>), name: object });
      // #5770: the remote twin of the `backfillCanonicalDatetimes` call
      // `SqlDriver.initObjects` makes at exactly this point. Must run AFTER the
      // registration above — that is what tells it which columns are temporal.
      await this.backfillRemoteCanonicalTemporalQuietly();
      return;
    }
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
      // Remote DDL bypasses SqlDriver.initObjects, which is what normally
      // populates the boolean/json/date/numeric read-coercion registries.
      // Register the field-type metadata explicitly (no DDL) so remote reads
      // run the same formatOutput() coercion as local/replica mode — otherwise
      // a boolean reads back as raw 0/1, JSON as a string, dates as raw text.
      // (Root cause of the 2026-07-06 case_escalation `1 != true` incident.)
      for (const obj of objects) this.registerRemoteFieldMetadata(obj);
      // #5770: the remote twin of the `backfillCanonicalDatetimes` /
      // `backfillCanonicalTimes` calls `SqlDriver.initObjects` makes per table.
      // One batched probe covers every column synced here, so the steady state
      // (nothing to converge) costs a single round-trip for the whole boot.
      await this.backfillRemoteCanonicalTemporalQuietly();
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
  async syncSchemasBatch(schemas: Array<{ object: string; schema: unknown }>, options?: DriverOptions): Promise<void> {
    if (this.isRemote) {
      return this.remoteTransport!.syncSchemasBatch(schemas);
    }
    // Local/replica fallback: sequential sync (already fast with local SQLite)
    for (const { object, schema } of schemas) {
      await super.syncSchema(object, schema, options);
    }
  }

  override async dropTable(object: string, options?: DriverOptions): Promise<void> {
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
