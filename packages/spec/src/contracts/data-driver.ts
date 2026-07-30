// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { DriverOptions, DriverCapabilities } from '../data/driver.zod.js';
import type { QueryAST } from '../data/query.zod.js';

/**
 * IDataDriver - Comprehensive Database Driver Interface
 * 
 * Pure TypeScript interface for all storage adapters (Postgres, Mongo, Excel, Salesforce).
 * Mirrors the capabilities described in `data/driver.zod.ts` (DriverInterfaceSchema) but
 * expressed as a TypeScript interface for type-safe implementation contracts.
 * 
 * This is the contract that all ObjectStack database drivers MUST implement.
 * Use `DriverCapabilitiesSchema` / `DriverConfigSchema` from `data/driver.zod.ts` for
 * runtime capability detection and configuration validation.
 * 
 * @see DriverCapabilitiesSchema for runtime capability flags
 * @see DriverConfigSchema for driver configuration validation
 */
export interface IDataDriver {
  /** Driver unique name (e.g., 'postgresql', 'mongodb', 'rest_api') */
  readonly name: string;

  /** Driver version */
  readonly version: string;

  /** Capabilities descriptor */
  readonly supports: DriverCapabilities;

  // ===========================================================================
  // Lifecycle Management
  // ===========================================================================

  /** Initialize connection pool or authenticate */
  connect(): Promise<void>;

  /** Close connections and cleanup resources */
  disconnect(): Promise<void>;

  /** Check connection health */
  checkHealth(): Promise<boolean>;

  /** Get connection pool statistics (optional) */
  getPoolStats?(): { total: number; idle: number; active: number; waiting: number } | undefined;

  // ===========================================================================
  // Raw Execution (Escape Hatch)
  // ===========================================================================

  /**
   * Execute a raw command/query native to the driver.
   * 
   * @param command - Raw command (SQL string, shell command, or API payload)
   * @param parameters - Bound parameters for safe execution
   * @param options - Driver options (transaction context, timeout)
   * @returns Raw result from the driver
   */
  execute(command: unknown, parameters?: unknown[], options?: DriverOptions): Promise<unknown>;

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Find multiple records matching the structured query.
   * MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  find(object: string, query: QueryAST, options?: DriverOptions): Promise<Record<string, unknown>[]>;

  /**
   * Stream records matching the structured query.
   * Optimized for large datasets to avoid memory overflow.
   * Returns an AsyncIterable or ReadableStream.
   */
  findStream(object: string, query: QueryAST, options?: DriverOptions): unknown;

  /**
   * Find a single record by query.
   * MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  findOne(object: string, query: QueryAST, options?: DriverOptions): Promise<Record<string, unknown> | null>;

  /**
   * Create a new record.
   * MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  create(object: string, data: Record<string, unknown>, options?: DriverOptions): Promise<Record<string, unknown>>;

  /**
   * Update an existing record by ID.
   * MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  update(object: string, id: string | number, data: Record<string, unknown>, options?: DriverOptions): Promise<Record<string, unknown>>;

  /**
   * Upsert (Update or Insert) a record.
   */
  upsert(object: string, data: Record<string, unknown>, conflictKeys?: string[], options?: DriverOptions): Promise<Record<string, unknown>>;

  /**
   * Delete a record by ID.
   * @returns True if deleted, false if not found.
   */
  delete(object: string, id: string | number, options?: DriverOptions): Promise<boolean>;

  /**
   * Count records matching a query.
   */
  count(object: string, query?: QueryAST, options?: DriverOptions): Promise<number>;

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  /** Create multiple records in a single batch */
  bulkCreate(object: string, dataArray: Record<string, unknown>[], options?: DriverOptions): Promise<Record<string, unknown>[]>;

  /** Update multiple records in a single batch */
  bulkUpdate(object: string, updates: Array<{ id: string | number; data: Record<string, unknown> }>, options?: DriverOptions): Promise<Record<string, unknown>[]>;

  /** Delete multiple records in a single batch */
  bulkDelete(object: string, ids: Array<string | number>, options?: DriverOptions): Promise<void>;

  /** Update multiple records matching a query (optional) */
  updateMany?(object: string, query: QueryAST, data: Record<string, unknown>, options?: DriverOptions): Promise<number>;

  /** Delete multiple records matching a query (optional) */
  deleteMany?(object: string, query: QueryAST, options?: DriverOptions): Promise<number>;

  // ===========================================================================
  // Temporal Storage Convention (ADR-0053 D-A1/D-A2, #3912)
  // ===========================================================================
  //
  // A driver is the single source of truth for how a `Field.date` /
  // `Field.datetime` / `Field.time` value is physically stored on its
  // dialect. Any surface
  // that builds queries OUTSIDE the driver's own find()/filter path — the
  // analytics native-SQL strategy today, any future raw-query strategy — must
  // route its temporal comparands AND its column references through these two
  // hooks rather than re-deriving the storage form from the value's textual
  // shape (the drift that produced #3912).
  //
  // The two hooks are a pair on purpose: #3912's lesson is that coercing the
  // comparand alone is NOT sufficient on a dialect whose stored form can
  // diverge from the bound form — the column side of the comparison has to be
  // normalised by the same authority. A driver that implements one without
  // the other reintroduces half the bug, so implement both or neither.
  //
  // Both are optional with identity semantics: a driver whose storage form IS
  // the wire form (memory, mongo) simply omits them, and callers treat
  // "absent" exactly like "returns the input unchanged".

  /**
   * Coerce a filter comparand to the on-disk storage form of `field` on
   * `objectName` — e.g. an ISO instant for a canonical-text datetime column,
   * `YYYY-MM-DD` text for a `Field.date`, canonical `HH:MM:SS[.fff]` text
   * for a `Field.time` (#3994), a dialect-spelled datetime literal
   * where the dialect cannot parse ISO-8601. Non-temporal fields and
   * uninterpretable values are returned unchanged.
   */
  temporalFilterValue?(objectName: string, field: string, value: unknown): unknown;

  /**
   * The companion for the LEFT side of the same comparison: given the SQL the
   * caller was going to emit for the column (an already-quoted, possibly
   * qualified reference), return the SQL it must emit instead so the column
   * reads in the same storage form {@link temporalFilterValue} coerces the
   * comparand into. Returns `columnSql` verbatim for every column that needs
   * no normalisation — which is every column on a fully-converged database.
   */
  temporalFilterColumnSql?(objectName: string, field: string, columnSql: string): string;

  // ===========================================================================
  // Transaction Management
  // ===========================================================================

  /**
   * Begin a new database transaction.
   * @returns A transaction handle to pass via `options.transaction`.
   */
  beginTransaction(options?: { isolationLevel?: string }): Promise<unknown>;

  /** Commit the transaction */
  commit(transaction: unknown): Promise<void>;

  /** Rollback the transaction */
  rollback(transaction: unknown): Promise<void>;

  // ===========================================================================
  // Schema Management
  // ===========================================================================

  /**
   * Synchronize the database schema with the Object definition.
   * Idempotent: creates tables if missing, adds columns, updates indexes.
   */
  syncSchema(object: string, schema: unknown, options?: DriverOptions): Promise<void>;

  /**
   * Batch-synchronize multiple object schemas with fewer round-trips.
   *
   * Drivers that set `supports.batchSchemaSync = true` MUST implement this.
   * The engine calls it once with all `{ object, schema }` pairs instead
   * of calling `syncSchema()` N times, reducing network overhead for
   * remote drivers.
   */
  syncSchemasBatch?(schemas: Array<{ object: string; schema: unknown }>, options?: DriverOptions): Promise<void>;

  /**
   * Register a federated (external) object's read metadata WITHOUT running DDL
   * (ADR-0015). For datasources with `schemaMode !== 'managed'`, the schema is
   * owned by the remote database, so `syncSchema()`/`initObjects()` (which run
   * DDL) are forbidden. Drivers that support federation implement this to record
   * the physical remote table (`external.remoteName` / `remoteSchema`) and the
   * per-object read-coercion metadata so queries resolve to the remote table.
   * Optional: drivers that don't support federation simply omit it (the engine
   * skips external objects for them).
   */
  registerExternalObject?(schema: unknown): void | Promise<void>;

  /** Drop the underlying table or collection (destructive) */
  dropTable(object: string, options?: DriverOptions): Promise<void>;

  /**
   * Reclaim free space after bulk deletions (ADR-0057 §3.4). SQLite issues
   * `PRAGMA incremental_vacuum` (pairs with the `auto_vacuum=INCREMENTAL`
   * connect-time default); engines with their own background reclamation
   * (Postgres autovacuum) may no-op. Optional — the LifecycleService calls
   * it best-effort after every sweep that deleted rows.
   */
  reclaimSpace?(options?: DriverOptions): Promise<void>;

  /**
   * Analyze query performance.
   * Returns execution plan without executing the query (optional).
   */
  explain?(object: string, query: QueryAST, options?: DriverOptions): Promise<unknown>;
}
