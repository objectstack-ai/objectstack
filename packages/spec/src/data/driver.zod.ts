// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { QuerySchema, DateGranularity } from '../data/query.zod';
import { IsolationLevelEnum } from '../shared/enums.zod';

/**
 * Common Driver Options
 * Passed to most driver methods to control behavior (transactions, timeouts, etc.)
 */
import { lazySchema } from '../shared/lazy-schema';
export const DriverOptionsSchema = lazySchema(() => z.object({
  /**
   * Transaction handle/identifier.
   * If provided, the operation must run within this transaction.
   */
  transaction: z.unknown().optional().describe('Transaction handle'),

  /**
   * Operation timeout in milliseconds.
   */
  timeout: z.number().optional().describe('Timeout in ms'),

  /**
   * Whether to bypass cache and force a fresh read.
   */
  skipCache: z.boolean().optional().describe('Bypass cache'),

  /**
   * Distributed Tracing Context.
   * Used for passing OpenTelemetry span context or request IDs for observability.
   */
  traceContext: z.record(z.string(), z.string()).optional().describe('OpenTelemetry context or request ID'),

  /**
   * Tenant Identifier.
   * For multi-tenant databases (row-level security or schema-per-tenant).
   */
  tenantId: z.string().optional().describe('Tenant Isolation identifier'),

  /**
   * [ADR-0105 D2 / #3623] Tenant access SET for union-scoped postures.
   *
   * Under the `group` tenancy posture a caller's read reach is every
   * organization they hold a membership in (`organization_id IN (...)`), not
   * just the active one. The engine threads `ExecutionContext.accessible_org_ids`
   * here so the driver's NATIVE tenant scoping widens to the same union the
   * Layer 0 authorization wall enforces — otherwise the driver's
   * `organization_id = tenantId` equality ANDs under the union and collapses
   * group reads back to active-org reach.
   *
   * Semantics for drivers that implement native scoping:
   * - non-empty array → scope reads/updates/deletes/aggregates with `IN`,
   *   keeping any NULL-tenant global-row carve-out the equality path has;
   * - absent or empty → fall back to `tenantId` equality (fail toward
   *   isolation, never toward exposure);
   * - insert-side tenant injection ALWAYS uses `tenantId` (the active
   *   organization is the write target — ADR-0105 D5).
   */
  tenantIds: z.array(z.string()).optional().describe('Union tenant access set (group posture): native read scoping widens to organization_id IN (...); inserts still stamp from tenantId'),

  /**
   * Business reference timezone (IANA name, e.g. `Asia/Shanghai`) for the
   * request, threaded from `ExecutionContext.timezone` (ADR-0053). Drivers that
   * generate date-dependent values — notably `autonumber` date tokens
   * (`{YYYYMMDD}`) — resolve the calendar day in this zone, falling back to UTC.
   */
  timezone: z.string().optional().describe('Business reference timezone (IANA) for date-dependent generation, e.g. autonumber date tokens'),

  /**
   * Preserve a caller-supplied `updated_at` on the UPDATE path instead of
   * force-advancing it to `now` (#3493). Threaded from
   * `ExecutionContext.preserveAudit` — set only for an opt-in "historical" data
   * import that reinstates the original timeline. When true AND the row carries
   * an explicit `updated_at`, the driver keeps it; otherwise it stamps `now` as
   * usual. A normal update leaves this unset, so `updated_at` always advances.
   */
  preserveAudit: z.boolean().optional().describe('Historical import: keep a supplied updated_at instead of force-stamping now (from ExecutionContext.preserveAudit)'),
}));

/**
 * Driver Capabilities Schema
 * 
 * Defines what features a database driver supports.
 * This allows ObjectQL to adapt its behavior based on underlying database capabilities.
 * Enhanced with granular capability flags for better feature detection.
 */
export const DriverCapabilitiesSchema = lazySchema(() => z.object({
  // ============================================================================
  // Basic CRUD Operations
  // ============================================================================
  
  /**
   * Whether the driver supports create operations.
   */
  create: z.boolean().default(true).describe('Supports CREATE operations'),
  
  /**
   * Whether the driver supports read operations.
   */
  read: z.boolean().default(true).describe('Supports READ operations'),
  
  /**
   * Whether the driver supports update operations.
   */
  update: z.boolean().default(true).describe('Supports UPDATE operations'),
  
  /**
   * Whether the driver supports delete operations.
   */
  delete: z.boolean().default(true).describe('Supports DELETE operations'),

  // ============================================================================
  // Bulk Operations
  // ============================================================================
  
  /**
   * Whether the driver supports bulk create operations.
   */
  bulkCreate: z.boolean().default(false).describe('Supports bulk CREATE operations'),
  
  /**
   * Whether the driver supports bulk update operations.
   */
  bulkUpdate: z.boolean().default(false).describe('Supports bulk UPDATE operations'),
  
  /**
   * Whether the driver supports bulk delete operations.
   */
  bulkDelete: z.boolean().default(false).describe('Supports bulk DELETE operations'),

  // ============================================================================
  // Transaction & Connection Management
  // ============================================================================
  
  /**
   * Whether the driver supports database transactions.
   * If true, beginTransaction, commit, and rollback must be implemented.
   */
  transactions: z.boolean().default(false).describe('Supports ACID transactions'),
  
  /**
   * Whether the driver supports savepoints within transactions.
   */
  savepoints: z.boolean().default(false).describe('Supports transaction savepoints'),
  
  /**
   * Supported transaction isolation levels.
   */
  isolationLevels: z.array(IsolationLevelEnum).optional().describe('Supported isolation levels'),

  // ============================================================================
  // Query Operations
  // ============================================================================
  
  /**
   * Whether the driver supports WHERE clause filters.
   * If false, ObjectQL will fetch all records and filter in memory.
   * 
   * Example: Memory driver might not support complex filter conditions.
   */
  queryFilters: z.boolean().default(true).describe('Supports WHERE clause filtering'),

  /**
   * Whether the driver supports aggregation functions (COUNT, SUM, AVG, etc.).
   * If false, ObjectQL will compute aggregations in memory.
   */
  queryAggregations: z.boolean().default(false).describe('Supports GROUP BY and aggregation functions'),

  /**
   * Per-granularity native SQL date bucketing support.
   *
   * Drivers that can emit `DATE_TRUNC` / `DATE_FORMAT` / `strftime` / `$dateTrunc`
   * for `groupBy` items shaped as `{ field, dateGranularity }` should advertise
   * the granularities they handle here, e.g. `{ day: true, week: false }` for a
   * SQLite build whose `strftime` lacks ISO week (`%V`).
   *
   * When omitted (or a granularity is falsy), the engine falls back to fetching
   * raw rows and bucketing in-memory (`applyInMemoryAggregation`), which is
   * always correct but loads the full row set into Node.
   *
   * **Output contract** (CRITICAL): the native SQL expression MUST produce the
   * same string label as `bucketDateValue()` in `@objectstack/objectql` —
   * `YYYY` / `YYYY-MM` / `YYYY-MM-DD` / `YYYY-Q[1-4]` / `YYYY-W[01-53]` (ISO-8601,
   * weeks start Monday). Any drift will misalign drill `groupKey` filters
   * between the two paths.
   */
  queryDateGranularity: z.record(DateGranularity, z.boolean()).optional()
    .describe('Per-granularity native date bucketing (day/week/month/quarter/year). Missing keys fall back to in-memory bucketing.'),

  /**
   * Whether the driver supports ORDER BY sorting.
   * If false, ObjectQL will sort results in memory.
   */
  querySorting: z.boolean().default(true).describe('Supports ORDER BY sorting'),

  /**
   * Whether the driver supports LIMIT/OFFSET pagination.
   * If false, ObjectQL will fetch all records and paginate in memory.
   */
  queryPagination: z.boolean().default(true).describe('Supports LIMIT/OFFSET pagination'),

  /**
   * Whether the driver supports window functions (ROW_NUMBER, RANK, LAG, LEAD, etc.).
   * If false, ObjectQL will compute window functions in memory.
   */
  queryWindowFunctions: z.boolean().default(false).describe('Supports window functions with OVER clause'),

  /**
   * Whether the driver supports subqueries (nested SELECT statements).
   * If false, ObjectQL will execute queries separately and combine results.
   */
  querySubqueries: z.boolean().default(false).describe('Supports subqueries'),
  
  /**
   * Whether the driver supports Common Table Expressions (WITH clause).
   */
  queryCTE: z.boolean().default(false).describe('Supports Common Table Expressions (WITH clause)'),

  /**
   * Whether the driver supports SQL-style joins.
   * If false, ObjectQL will fetch related data separately and join in memory.
   */
  joins: z.boolean().default(false).describe('Supports SQL joins'),

  // ============================================================================
  // Advanced Features
  // ============================================================================
  
  /**
   * Whether the driver supports full-text search.
   * If true, text search queries can be pushed to the database.
   */
  fullTextSearch: z.boolean().default(false).describe('Supports full-text search'),
  
  /**
   * Whether the driver supports JSON querying capabilities.
   */
  jsonQuery: z.boolean().default(false).describe('Supports JSON field querying'),
  
  /**
   * Whether the driver supports geospatial queries.
   */
  geospatialQuery: z.boolean().default(false).describe('Supports geospatial queries'),
  
  /**
   * Whether the driver supports streaming large result sets.
   */
  streaming: z.boolean().default(false).describe('Supports result streaming (cursors/iterators)'),

  /**
   * Whether the driver supports JSON field types.
   * If false, JSON data will be serialized as strings.
   */
  jsonFields: z.boolean().default(false).describe('Supports JSON field types'),

  /**
   * Whether the driver supports array field types.
   * If false, arrays will be stored as JSON strings or in separate tables.
   */
  arrayFields: z.boolean().default(false).describe('Supports array field types'),

  /**
   * Whether the driver supports vector embeddings and similarity search.
   * Required for RAG (Retrieval-Augmented Generation) and AI features.
   */
  vectorSearch: z.boolean().default(false).describe('Supports vector embeddings and similarity search'),

  /**
   * Whether the driver natively generates persistent autonumber / sequence
   * values inside `create()` / `bulkCreate()` / `upsert()` (e.g. a DB-backed
   * `_objectstack_sequences` table that survives restarts and is atomic across
   * concurrent writers / instances).
   *
   * When true, the ObjectQL engine MUST NOT pre-fill `autonumber` fields with
   * its own in-memory counter — the driver owns generation as the single,
   * persistent source of truth, and required-validation exempts the field
   * because the value is assigned after validation. When false/absent (memory,
   * mongodb), the engine falls back to its in-memory generator.
   *
   * Optional so existing driver capability objects need not be updated.
   */
  autonumber: z.boolean().optional().describe('Driver natively generates persistent autonumber/sequence values'),

  // ============================================================================
  // Schema Management
  // ============================================================================
  
  /**
   * Whether the driver supports automatic schema synchronization.
   */
  schemaSync: z.boolean().default(false).describe('Supports automatic schema synchronization'),

  /**
   * Whether the driver supports batching multiple schema sync operations
   * into a single (or fewer) round-trips for the DDL phase. When true,
   * the engine may call `syncSchemasBatch()` instead of calling
   * `syncSchema()` per object, reducing network round-trips for remote drivers.
   */
  batchSchemaSync: z.boolean().default(false).describe('Supports batched schema sync to reduce schema DDL round-trips'),
  
  /**
   * Whether the driver supports database migrations.
   */
  migrations: z.boolean().default(false).describe('Supports database migrations'),
  
  /**
   * Whether the driver supports index management.
   */
  indexes: z.boolean().default(false).describe('Supports index creation and management'),

  // ============================================================================
  // Performance & Optimization
  // ============================================================================
  
  /**
   * Whether the driver supports connection pooling.
   */
  connectionPooling: z.boolean().default(false).describe('Supports connection pooling'),
  
  /**
   * Whether the driver supports prepared statements.
   */
  preparedStatements: z.boolean().default(false).describe('Supports prepared statements (SQL injection prevention)'),
  
  /**
   * Whether the driver supports query result caching.
   */
  queryCache: z.boolean().default(false).describe('Supports query result caching'),
}));

/**
 * Unified Database Driver Interface
 * 
 * This is the contract that all storage adapters (Postgres, Mongo, Excel, Salesforce) must implement.
 * It abstracts the underlying engine, enabling ObjectStack to be "Database Agnostic".
 */
export const DriverInterfaceSchema = lazySchema(() => z.object({
  /**
   * Driver name (e.g., 'postgresql', 'mongodb', 'rest_api').
   */
  name: z.string().describe('Driver unique name'),

  /**
   * Driver version.
   */
  version: z.string().describe('Driver version'),

  /**
   * Capabilities descriptor.
   */
  supports: DriverCapabilitiesSchema,

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  /**
   * Initialize connection pool or authenticate.
   */
  connect: z.function()
    .input(z.tuple([]))
    .output(z.promise(z.void()))
    .describe('Establish connection'),

  /**
   * Close connections and cleanup resources.
   */
  disconnect: z.function()
    .input(z.tuple([]))
    .output(z.promise(z.void()))
    .describe('Close connection'),

  /**
   * Check connection health.
   * @returns true if healthy, false otherwise.
   */
  checkHealth: z.function()
    .input(z.tuple([]))
    .output(z.promise(z.boolean()))
    .describe('Health check'),
  
  /**
   * Get Connection Pool Statistics.
   * Useful for monitoring database load.
   */
  getPoolStats: z.function()
    .input(z.tuple([]))
    .output(z.object({
      total: z.number(),
      idle: z.number(),
      active: z.number(),
      waiting: z.number(),
    }).optional())
    .optional()
    .describe('Get connection pool statistics'),

  // ============================================================================
  // Raw Execution (Escape Hatch)
  // ============================================================================

  /**
   * Execute a raw command/query native to the driver.
   * Useful for complex reports, stored procedures, or DDL not covered by standard sync.
   * 
   * @param command - The raw command (e.g., SQL string, shell command, or remote API payload).
   * @param parameters - Optional array of bound parameters for safe execution (prevention of injection).
   * @param options - Driver options (transaction context, timeout).
   * @returns Promise resolving to the raw result from the driver.
   * 
   * @example
   * // SQL Driver
   * await driver.execute('SELECT * FROM complex_view WHERE id = ?', [123]);
   * 
   * // Mongo Driver
   * await driver.execute({ aggregate: 'orders', pipeline: [...] });
   */
  execute: z.function()
    .input(z.tuple([z.unknown(), z.array(z.unknown()).optional(), DriverOptionsSchema.optional()]))
    .output(z.promise(z.unknown()))
    .describe('Execute raw command'),

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  /**
   * Find multiple records matching the structured query.
   * Parsing the QueryAST is the responsibility of the driver implementation.
   * 
   * @param object - The name of the object/table to query (e.g. 'account').
   * @param query - The structured QueryAST (filters, sorts, joins, pagination).
   * @param options - Driver options.
   * @returns Array of records.
   * 
   * @example
   * await driver.find('account', {
   *   filters: [['status', '=', 'active'], 'and', ['amount', '>', 500]],
   *   sort: [{ field: 'created_at', order: 'desc' }],
   *   top: 10
   * });
   * @returns Array of records.
   *          MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  find: z.function()
    .input(z.tuple([z.string(), QuerySchema, DriverOptionsSchema.optional()]))
    .output(z.promise(z.array(z.record(z.string(), z.unknown()))))
    .describe('Find records'),

  /**
   * Stream records matching the structured query.
   * Optimized for large datasets to avoid memory overflow.
   * 
   * @param object - The name of the object.
   * @param query - The structured QueryAST.
   * @param options - Driver options.
   * @returns AsyncIterable/ReadableStream of records.
   */
  findStream: z.function()
    .input(z.tuple([z.string(), QuerySchema, DriverOptionsSchema.optional()]))
    .output(z.unknown())
    .describe('Stream records (AsyncIterable)'),

  /**
   * Find a single record by query.
   * Similar to find(), but returns only the first match or null.
   * 
   * @param object - The name of the object.
   * @param query - QueryAST.
   * @param options - Driver options.
   * @returns The record or null.
   *          MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  findOne: z.function()
    .input(z.tuple([z.string(), QuerySchema, DriverOptionsSchema.optional()]))
    .output(z.promise(z.record(z.string(), z.unknown()).nullable()))
    .describe('Find one record'),

  /**
   * Create a new record.
   * 
   * @param object - The object name.
   * @param data - Key-value map of field data.
   * @param options - Driver options.
   * @returns The created record, including server-generated fields (id, created_at, etc.).
   *          MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  create: z.function()
    .input(z.tuple([z.string(), z.record(z.string(), z.unknown()), DriverOptionsSchema.optional()]))
    .output(z.promise(z.record(z.string(), z.unknown())))
    .describe('Create record'),

  /**
   * Update an existing record by ID.
   * 
   * @param object - The object name.
   * @param id - The unique identifier of the record.
   * @param data - The fields to update.
   * @param options - Driver options.
   * @returns The updated record.
   *          MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  update: z.function()
    .input(z.tuple([z.string(), z.string().or(z.number()), z.record(z.string(), z.unknown()), DriverOptionsSchema.optional()]))
    .output(z.promise(z.record(z.string(), z.unknown())))
    .describe('Update record'),

  /**
   * Upsert (Update or Insert) a record.
   * 
   * @param object - The object name.
   * @param data - The data to upsert.
   * @param conflictKeys - Fields to check for conflict (uniqueness).
   * @param options - Driver options.
   * @returns The created or updated record.
   */
  upsert: z.function()
    .input(z.tuple([z.string(), z.record(z.string(), z.unknown()), z.array(z.string()).optional(), DriverOptionsSchema.optional()]))
    .output(z.promise(z.record(z.string(), z.unknown())))
    .describe('Upsert record'),

  /**
   * Delete a record by ID.
   * 
   * @param object - The object name.
   * @param id - The unique identifier of the record.
   * @param options - Driver options.
   * @returns True if deleted, false if not found.
   */
  delete: z.function()
    .input(z.tuple([z.string(), z.string().or(z.number()), DriverOptionsSchema.optional()]))
    .output(z.promise(z.boolean()))
    .describe('Delete record'),

  /**
   * Count records matching a query.
   * 
   * @param object - The object name.
   * @param query - Optional filtering criteria.
   * @param options - Driver options.
   * @returns Total count.
   */
  count: z.function()
    .input(z.tuple([z.string(), QuerySchema.optional(), DriverOptionsSchema.optional()]))
    .output(z.promise(z.number()))
    .describe('Count records'),

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * Create multiple records in a single batch.
   * Optimized for performance.
   * 
   * @param object - The object name.
   * @param dataArray - Array of record data.
   * @returns Array of created records.
   */
  bulkCreate: z.function()
    .input(z.tuple([z.string(), z.array(z.record(z.string(), z.unknown())), DriverOptionsSchema.optional()]))
    .output(z.promise(z.array(z.record(z.string(), z.unknown())))),

  /**
   * Update multiple records in a single batch.
   * 
   * @param object - The object name.
   * @param updates - Array of objects containing {id, data}.
   * @returns Array of updated records.
   */
  bulkUpdate: z.function()
    .input(z.tuple([z.string(), z.array(z.object({ id: z.string().or(z.number()), data: z.record(z.string(), z.unknown()) })), DriverOptionsSchema.optional()]))
    .output(z.promise(z.array(z.record(z.string(), z.unknown())))),

  /**
   * Delete multiple records in a single batch.
   * 
   * @param object - The object name.
   * @param ids - Array of record IDs.
   */
  bulkDelete: z.function()
    .input(z.tuple([z.string(), z.array(z.string().or(z.number())), DriverOptionsSchema.optional()]))
    .output(z.promise(z.void())),

  /**
   * Update multiple records matching a query.
   * Direct database push-down. DOES NOT trigger per-record hooks.
   * 
   * @param object - The object name.
   * @param query - The filtering criteria.
   * @param data - The data to update.
   * @returns Count of modified records.
   */
  updateMany: z.function()
    .input(z.tuple([z.string(), QuerySchema, z.record(z.string(), z.unknown()), DriverOptionsSchema.optional()]))
    .output(z.promise(z.number()))
    .optional(),

  /**
   * Delete multiple records matching a query.
   * Direct database push-down. DOES NOT trigger per-record hooks.
   * 
   * @param object - The object name.
   * @param query - The filtering criteria.
   * @returns Count of deleted records.
   */
  deleteMany: z.function()
    .input(z.tuple([z.string(), QuerySchema, DriverOptionsSchema.optional()]))
    .output(z.promise(z.number()))
    .optional(),

  // ============================================================================
  // Transaction Management
  // ============================================================================

  /**
   * Begin a new database transaction.
   * @param options - Isolation level and other settings.
   * @returns A transaction handle to be passed to subsequent operations via `options.transaction`.
   */
  beginTransaction: z.function()
    .input(z.tuple([z.object({
      isolationLevel: IsolationLevelEnum.optional()
    }).optional()]))
    .output(z.promise(z.unknown()))
    .describe('Start transaction'),

  /**
   * Commit the transaction.
   * @param transaction - The transaction handle.
   */
  commit: z.function()
    .input(z.tuple([z.unknown()]))
    .output(z.promise(z.void()))
    .describe('Commit transaction'),

  /**
   * Rollback the transaction.
   * @param transaction - The transaction handle.
   */
  rollback: z.function()
    .input(z.tuple([z.unknown()]))
    .output(z.promise(z.void()))
    .describe('Rollback transaction'),

  // ============================================================================
  // Schema Management
  // ============================================================================

  /**
   * Synchronize the database schema with the Object definition.
   * This is an idempotent operation: it should create tables if missing, 
   * add columns if missing, and update indexes.
   * 
   * @param object - The object name.
   * @param schema - The full Object Schema (fields, indexes, etc).
   * @param options - Driver options.
   */
  syncSchema: z.function()
    .input(z.tuple([z.string(), z.unknown(), DriverOptionsSchema.optional()]))
    .output(z.promise(z.void()))
    .describe('Sync object schema to DB'),

  /**
   * Batch-synchronize multiple object schemas with fewer round-trips.
   *
   * Drivers that advertise `supports.batchSchemaSync = true` MUST implement
   * this method.  The engine will call it once with every
   * `{ object, schema }` pair instead of calling `syncSchema()` N times.
   *
   * @param schemas - Array of `{ object: string; schema: unknown }` pairs.
   * @param options - Driver options.
   */
  syncSchemasBatch: z.function()
    .input(z.tuple([
      z.array(z.object({ object: z.string(), schema: z.unknown() })),
      DriverOptionsSchema.optional(),
    ]))
    .output(z.promise(z.void()))
    .optional()
    .describe('Batch sync multiple schemas in one round-trip'),
  
  /**
   * Drop the underlying table or collection for an object.
   * WARNING: Destructive operation.
   * 
   * @param object - The object name.
   */
  dropTable: z.function()
    .input(z.tuple([z.string(), DriverOptionsSchema.optional()]))
    .output(z.promise(z.void())),

  /**
   * Analyze query performance.
   * Returns execution plan without executing the query (where possible).
   * 
   * @param object - The object name.
   * @param query - The query to explain.
   * @returns The execution plan details.
   */
  explain: z.function()
    .input(z.tuple([z.string(), QuerySchema, DriverOptionsSchema.optional()]))
    .output(z.promise(z.unknown()))
    .optional(),
}));

/**
 * Connection Pool Configuration Schema
 * Manages database connection pooling for performance
 */
export const PoolConfigSchema = lazySchema(() => z.object({
  min: z.number().min(0).default(2).describe('Minimum number of connections in pool'),
  max: z.number().min(1).default(10).describe('Maximum number of connections in pool'),
  idleTimeoutMillis: z.number().min(0).default(30000).describe('Time in ms before idle connection is closed'),
  connectionTimeoutMillis: z.number().min(0).default(5000).describe('Time in ms to wait for available connection'),
}));

/**
 * Driver Configuration Schema
 * Base configuration for database drivers
 */
export const DriverConfigSchema = lazySchema(() => z.object({
  name: z.string().describe('Driver instance name'),
  type: z.enum(['sql', 'nosql', 'cache', 'search', 'graph', 'timeseries']).describe('Driver type category'),
  capabilities: DriverCapabilitiesSchema.describe('Driver capability flags'),
  connectionString: z.string().optional().describe('Database connection string (driver-specific format)'),
  poolConfig: PoolConfigSchema.optional().describe('Connection pool configuration'),
}));

/**
 * TypeScript types
 */
export type DriverOptions = z.infer<typeof DriverOptionsSchema>;
export type DriverCapabilities = z.infer<typeof DriverCapabilitiesSchema>;
export type DriverInterface = z.infer<typeof DriverInterfaceSchema>;
export type DriverConfig = z.infer<typeof DriverConfigSchema>;
export type PoolConfig = z.infer<typeof PoolConfigSchema>;
