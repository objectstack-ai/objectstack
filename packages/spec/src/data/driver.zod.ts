// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { QuerySchema, DateGranularity } from '../data/query.zod';
import { IsolationLevelEnum } from '../shared/enums.zod';
import { retiredKey } from '../shared/retired-key';

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

  /**
   * Silence the tenant-audit warning a driver emits when it writes to a
   * tenant-scoped object without a `tenantId` — the write is deliberately
   * global, not an isolation bug.
   *
   * This key was live long before it was declared (#4311): `SqlDriver` reads it
   * (`bypassTenantAudit === true` → skip the warning) and its own warning text
   * tells callers to set it, the ObjectQL engine sets it for system-context
   * calls, and `service-settings` / `service-datasource` pass it on every
   * global-scope write. Only the schema never heard of it, so every driver read
   * went through an `as any` and every caller through an untyped options object.
   * Nothing type-checked either side, so the gap stayed invisible.
   *
   * A driver MAY warn on a tenant-scoped write that carries neither `tenantId`
   * nor this flag; it MUST NOT change what the write does. Suppressing an audit
   * warning is not a permission — it does not widen, narrow, or re-target the
   * rows a write touches.
   */
  bypassTenantAudit: z.boolean().optional().describe('Suppress the driver tenant-audit warning for a deliberately global write on a tenant-scoped object (diagnostics only — never changes what the write touches)'),
}));

/**
 * Shared builder for the 31 capability-bit tombstones below (#4634).
 *
 * Kept per-key so each prescription can name the mechanism that ACTUALLY
 * decides the behaviour — a prescription naming the wrong mechanism is worse
 * than none (the #4001 lesson, restated by the datasource `capabilities`
 * tombstones in `datasource.zod.ts`). No `os migrate meta` line on any of
 * them: a driver is CODE, never stack metadata, so there is no source for the
 * conversion chain to rewrite (the #4484 `findStream` precedent) — the D3
 * record is the semantic migration `driver-capabilities-inert-bits-removed`.
 */
const capRemoved = (key: string, mechanism: string) =>
  `\`DriverCapabilities.${key}\` was removed in @objectstack/spec 17.0.0 (ADR-0049 ` +
  `enforce-or-remove) — no code in any repository ever read it, so its value never changed ` +
  `which code path ran. ${mechanism} Delete the key.`;

/**
 * Driver Capabilities Schema
 *
 * Feature flags a driver ADVERTISES so the ObjectQL engine can pick a code
 * path it cannot infer from the driver contract itself.
 *
 * [#4634, ADR-0049 / ADR-0078] This record once declared 34 bits; a two-repo
 * liveness audit (objectstack + cloud, with objectui confirmed clean) found
 * THREE with a decision-making reader and thirty-one that no engine, planner,
 * REST layer or renderer ever consulted — self-description whose `.describe()`
 * strings promised engine adaptation ("if false, ObjectQL will …") that never
 * existed: the ADR-0078 false-affordance shape. The thirty-one are tombstoned
 * below; each prescription names the mechanism that really decides the
 * behaviour.
 *
 * The surviving contract — a capability bit exists here ONLY where method
 * presence on the driver cannot carry the signal:
 *
 * - `queryDateGranularity` — modulates HOW `aggregate()` is planned, per
 *   granularity (engine aggregate dispatch; `checkDateBucketParity`).
 * - `autonumber` — modulates `create()`/`bulkCreate()`: the engine defers
 *   autonumber generation to the driver when set.
 * - `batchSchemaSync` — opt-in for `syncSchemasBatch()` even where a base
 *   class inherits the method; the engine ANDs it with method presence.
 *
 * Everything else IS the method: transactions gate on
 * `driver.beginTransaction`, aggregate pushdown on
 * `typeof driver.aggregate === 'function'`, schema sync on
 * `typeof driver.syncSchema === 'function'`, and the REQUIRED CRUD/bulk
 * methods are called unconditionally. Do not add a boolean here for behaviour
 * that a method's presence — or a caller that does not exist yet — already
 * decides; that is how thirty-one dead bits accumulated.
 */
export const DriverCapabilitiesSchema = lazySchema(() => z.object({
  // ============================================================================
  // Live capability bits — each one has a named reader (see the TSDoc above)
  // ============================================================================

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
   *
   * The EMPTY bucket is part of that contract: a row with no instant MUST key as
   * `null`, never a sentinel string (#3839). Propagating NULL through the bucket
   * expression — what `strftime` / `date_trunc` / `to_char` already do — is the
   * whole of it; a driver only breaks this by going out of its way to COALESCE.
   * The same rule holds for a plain (non-date) `groupBy` column: a NULL value
   * keys as `null`. `checkDateBucketParity` (`@objectstack/verify`) probes it.
   */
  queryDateGranularity: z.record(DateGranularity, z.boolean()).optional()
    .describe('Per-granularity native date bucketing (day/week/month/quarter/year). Missing keys fall back to in-memory bucketing.'),

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

  /**
   * Whether the driver supports batching multiple schema sync operations
   * into a single (or fewer) round-trips for the DDL phase. When true,
   * the engine may call `syncSchemasBatch()` instead of calling
   * `syncSchema()` per object, reducing network round-trips for remote drivers.
   *
   * This is the one bit the engine ANDs with method presence
   * (`typeof driver.syncSchemasBatch === 'function' && supports.batchSchemaSync`):
   * a base class can inherit the METHOD while a transport genuinely cannot
   * batch, so presence alone cannot carry the signal.
   *
   * Optional since 17.0.0 (#4634): absence means `false`, exactly as both
   * readers (`engine.ts` / `plugin.ts`) already treated it — the previous
   * `.default(false)` forced every capability object to spell out a bit whose
   * absence says the same thing.
   */
  batchSchemaSync: z.boolean().optional().describe('Supports batched schema sync to reduce schema DDL round-trips (absence = false)'),

  // ============================================================================
  // Retired capability bits (#4634, ADR-0049 enforce-or-remove) — 17.0.0
  // ============================================================================
  //
  // Tombstoned, not deleted: this schema is not `.strict()`, so a plain delete
  // would let Zod silently STRIP the key — an author (or driver vendor) who
  // kept writing it would get a clean parse and a bit that never existed,
  // which is the very defect the removal closes. `retiredKey()` keeps each
  // key authored-unwritable: tsc rejects it at the authoring site (the class
  // literal of every driver that `implements IDataDriver`), and a parse
  // rejects it with the prescription below. Tombstones age out ~two majors
  // after 17 (see shared/retired-key.ts).

  create: retiredKey(capRemoved('create',
    'CRUD is not optional for a driver: `create`/`find`/`findOne`/`update`/`delete` are '
    + 'REQUIRED `IDataDriver` methods and the engine calls them unconditionally.')),
  read: retiredKey(capRemoved('read',
    'CRUD is not optional for a driver: reads go through the REQUIRED `find`/`findOne`/`count` '
    + 'methods, called unconditionally.')),
  update: retiredKey(capRemoved('update',
    'CRUD is not optional for a driver: `update`/`upsert` are REQUIRED `IDataDriver` methods, '
    + 'called unconditionally.')),
  delete: retiredKey(capRemoved('delete',
    'CRUD is not optional for a driver: `delete` is a REQUIRED `IDataDriver` method, called '
    + 'unconditionally.')),

  bulkCreate: retiredKey(capRemoved('bulkCreate',
    'The bulk methods (`bulkCreate`/`bulkUpdate`/`bulkDelete`) are REQUIRED `IDataDriver` '
    + 'methods and the engine calls them directly; wire-level batch capability is advertised '
    + 'by REST discovery from the live composition (#3298), never from this record.')),
  bulkUpdate: retiredKey(capRemoved('bulkUpdate',
    'The bulk methods are REQUIRED `IDataDriver` methods and the engine calls them directly; '
    + 'wire-level batch capability is advertised by REST discovery from the live composition '
    + '(#3298), never from this record.')),
  bulkDelete: retiredKey(capRemoved('bulkDelete',
    'The bulk methods are REQUIRED `IDataDriver` methods and the engine calls them directly; '
    + 'wire-level batch capability is advertised by REST discovery from the live composition '
    + '(#3298), never from this record.')),

  transactions: retiredKey(capRemoved('transactions',
    'Transaction use is gated on METHOD PRESENCE — `driver.beginTransaction` '
    + '(`engine.transaction()`, ADR-0034 ambient transactions): a driver without the method '
    + 'gets the non-transactional fallback, whatever this bit claimed. Discovery\'s '
    + '`transactionalBatch` capability is likewise derived from `engine.transaction` plus the '
    + 'mounted batch route, never from this bit.')),
  savepoints: retiredKey(capRemoved('savepoints',
    'No savepoint code path exists in the engine — a capability bit for a feature the '
    + 'platform does not call is a false affordance, not documentation.')),
  isolationLevels: retiredKey(capRemoved('isolationLevels',
    'Isolation is requested per transaction via `beginTransaction({ isolationLevel })`; no '
    + 'planner ever consulted this list to decide anything.')),

  queryFilters: retiredKey(capRemoved('queryFilters',
    '`find()` receives the full QueryAST (`where`/`orderBy`/`limit`/`offset`) and MUST '
    + 'execute all of it — the "ObjectQL will filter in memory" fallback this bit\'s '
    + 'description promised was never built.')),
  querySorting: retiredKey(capRemoved('querySorting',
    '`find()` receives the full QueryAST and MUST execute all of it — the "ObjectQL will '
    + 'sort in memory" fallback this bit\'s description promised was never built.')),
  queryPagination: retiredKey(capRemoved('queryPagination',
    '`find()` receives the full QueryAST and MUST execute all of it — the "ObjectQL will '
    + 'paginate in memory" fallback this bit\'s description promised was never built.')),
  queryAggregations: retiredKey(capRemoved('queryAggregations',
    'Aggregate pushdown is decided by `typeof driver.aggregate === \'function\'` plus '
    + '`queryDateGranularity` (engine aggregate dispatch) — never by this bit.')),
  queryWindowFunctions: retiredKey(capRemoved('queryWindowFunctions',
    'ObjectQL never plans window functions through a driver, so there was nothing for the '
    + 'bit to switch on.')),
  querySubqueries: retiredKey(capRemoved('querySubqueries',
    'ObjectQL never plans subqueries through a driver, so there was nothing for the bit to '
    + 'switch on.')),
  queryCTE: retiredKey(capRemoved('queryCTE',
    'ObjectQL never plans Common Table Expressions through a driver, so there was nothing '
    + 'for the bit to switch on.')),
  joins: retiredKey(capRemoved('joins',
    'Related data is resolved by the engine (lookup expansion over `find()`), not by '
    + 'driver-side JOIN planning — no code consulted the bit.')),

  fullTextSearch: retiredKey(capRemoved('fullTextSearch',
    '`$search` is compiled by the engine into an `$or` of `$contains` predicates over the '
    + 'searchable fields (ADR-0061) and removed from the AST before the driver sees it — no '
    + 'driver-side full-text path exists.')),
  jsonQuery: retiredKey(capRemoved('jsonQuery',
    'No engine path ever branched on driver-side JSON querying.')),
  geospatialQuery: retiredKey(capRemoved('geospatialQuery',
    'No geospatial query path exists in the platform — declaring the bit advertised a '
    + 'capability nothing delivers.')),
  streaming: retiredKey(
    '`DriverCapabilities.streaming` was removed in @objectstack/spec 17.0.0 (ADR-0049 '
    + 'enforce-or-remove) — no code in any repository ever read it, and `findStream`, the only '
    + 'read this bit could describe, was itself removed in 17.0.0: nothing ever called '
    + 'it, and two of its three implementations materialised the entire result set before '
    + 'yielding. The bit carried the same defect one level up (`SqlDriver` implemented '
    + '`findStream` yet declared `streaming: false`; `InMemoryDriver` declared `true` over a '
    + 'full-table read) — which is what zero readers makes inevitable. Page large reads '
    + 'through `find()` with `limit`/`offset`. Delete the key.'),
  jsonFields: retiredKey(capRemoved('jsonFields',
    'Field-type handling is negotiated per object at `syncSchema` time by the driver itself '
    + '(e.g. `SqlDriver`\'s per-object JSON/date column tracking); no engine path consulted '
    + 'the bit.')),
  arrayFields: retiredKey(capRemoved('arrayFields',
    'Field-type handling is negotiated per object at `syncSchema` time by the driver itself; '
    + 'no engine path consulted the bit.')),
  vectorSearch: retiredKey(capRemoved('vectorSearch',
    'No vector read path routes through `IDataDriver`. When one exists it should arrive '
    + 'WITH its caller and its capability bit together (the honest order under '
    + 'enforce-or-remove), not as a dangling boolean.')),

  schemaSync: retiredKey(capRemoved('schemaSync',
    'Schema sync is gated on METHOD PRESENCE — `typeof driver.syncSchema === \'function\'` '
    + '(engine and ObjectQL plugin init).')),
  migrations: retiredKey(capRemoved('migrations',
    'No migration engine ever consulted it.')),
  indexes: retiredKey(capRemoved('indexes',
    'Declared indexes are materialised by the driver itself during schema sync '
    + '(`SqlDriver.syncDeclaredIndexes`); no engine path consulted the bit.')),

  connectionPooling: retiredKey(capRemoved('connectionPooling',
    'Pooling is configured via `poolConfig` and owned by the driver; `getPoolStats` is '
    + 'duck-typed where monitoring wants it. Nothing consulted the bit.')),
  preparedStatements: retiredKey(capRemoved('preparedStatements',
    'Parameterised execution is an implementation detail of the driver '
    + '(`execute(command, parameters)`); nothing consulted the bit.')),
  queryCache: retiredKey(capRemoved('queryCache',
    'No query-cache layer keyed off it exists; `DriverOptions.skipCache` is a per-call hint '
    + 'to the driver, not a switch on this bit.')),
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
   * @param query - The structured QueryAST (where, orderBy, fields, pagination).
   * @param options - Driver options.
   *
   * @example
   * // The engine hands drivers CANONICAL QueryAST keys only — wire spellings
   * // (`filters`/`sort`/`top`) are folded away before this layer (#4371).
   * await driver.find('account', {
   *   where: { status: 'active', amount: { $gt: 500 } },
   *   orderBy: [{ field: 'created_at', order: 'desc' }],
   *   limit: 10
   * });
   * @returns Array of records.
   *          MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  find: z.function()
    .input(z.tuple([z.string(), QuerySchema, DriverOptionsSchema.optional()]))
    .output(z.promise(z.array(z.record(z.string(), z.unknown()))))
    .describe('Find records'),

  // `findStream` was removed in 17.0.0 (#4484, ADR-0049 enforce-or-remove) — see the
  // matching note on `IDataDriver` in `contracts/data-driver.ts`. Nothing ever called
  // it, and two of the three drivers implementing it materialised the whole result set
  // before yielding, inverting the memory guarantee it was declared for. Page through
  // `find()` with `limit`/`offset` instead.

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
export type DriverOptions = z.input<typeof DriverOptionsSchema>;
export type DriverCapabilities = z.input<typeof DriverCapabilitiesSchema>;
export type DriverInterface = z.input<typeof DriverInterfaceSchema>;
/** Post-parse shape of {@link DriverInterface} — defaults applied, transforms run (ADR-0122). */
export type DriverInterfaceParsed = z.infer<typeof DriverInterfaceSchema>;
export type DriverConfig = z.input<typeof DriverConfigSchema>;
/** Post-parse shape of {@link DriverConfig} — defaults applied, transforms run (ADR-0122). */
export type DriverConfigParsed = z.infer<typeof DriverConfigSchema>;
export type PoolConfig = z.input<typeof PoolConfigSchema>;
/** Post-parse shape of {@link PoolConfig} — defaults applied, transforms run (ADR-0122). */
export type PoolConfigParsed = z.infer<typeof PoolConfigSchema>;
