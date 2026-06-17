// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FilterConditionSchema } from './filter.zod';
import { SortNodeSchema, QuerySchema, FullTextSearchSchema, FieldNodeSchema, AggregationNodeSchema } from './query.zod';
import { ExecutionContextSchema } from '../kernel/execution-context.zod';

/**
 * Data Engine Protocol
 * 
 * Defines the standard interface for data persistence engines in ObjectStack.
 * This protocol abstracts the underlying storage mechanism (SQL, NoSQL, API, Memory),
 * allowing the ObjectQL engine to execute standardized CRUD and Aggregation operations
 * regardless of where the data resides.
 * 
 * The Data Engine acts as the "Driver" layer in the Hexagonal Architecture.
 */

// ==========================================================================
// 1. Shared Definitions
// ==========================================================================

/**
 * Data Engine Query filter conditions
 * Supports simple key-value map or complex Logic/Field expressions (DSL)
 */
import { lazySchema } from '../shared/lazy-schema';
export const DataEngineFilterSchema = lazySchema(() => z.union([
  z.record(z.string(), z.unknown()),
  FilterConditionSchema
]).describe('Data Engine query filter conditions'));

/**
 * Sort order definition
 * Supports:
 * - { name: 'asc' }
 * - { name: 1 }
 * - [{ field: 'name', order: 'asc' }]
 */
export const DataEngineSortSchema = lazySchema(() => z.union([
  z.record(z.string(), z.enum(['asc', 'desc'])), 
  z.record(z.string(), z.union([z.literal(1), z.literal(-1)])),
  z.array(SortNodeSchema)
]).describe('Sort order definition'));

// ==========================================================================
// 1b. Base Engine Options (shared context)
// ==========================================================================

/**
 * Base Engine Options
 * 
 * All Data Engine operation options extend this schema to carry
 * an optional ExecutionContext for identity, tenant, and transaction propagation.
 */
export const BaseEngineOptionsSchema = lazySchema(() => z.object({
  /** Execution context (identity, tenant, transaction) */
  context: ExecutionContextSchema.optional(),
}));

// ==========================================================================
// 2. method: FIND (QueryAST-aligned)
// ==========================================================================

/**
 * Engine Query Options — QueryAST-aligned parameters for IDataEngine.find/findOne.
 * 
 * Uses standard QueryAST field names (where/fields/orderBy/limit/offset/expand)
 * so that no mechanical translation is needed between the Engine and Driver layers.
 * 
 * @example
 * ```ts
 * engine.find('account', {
 *   where: { status: 'active' },
 *   fields: ['id', 'name', 'email'],
 *   orderBy: [{ field: 'name', order: 'asc' }],
 *   limit: 10,
 *   offset: 20,
 *   expand: { owner: { object: 'user', fields: ['name'] } },
 * });
 * ```
 */
export const EngineQueryOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions (WHERE) — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),

  /** Fields to retrieve (SELECT) — standard QueryAST `fields` */
  fields: z.array(FieldNodeSchema).optional(),

  /** Sorting instructions (ORDER BY) — standard QueryAST `orderBy` */
  orderBy: z.array(SortNodeSchema).optional(),

  /** Max records to return (LIMIT) */
  limit: z.number().optional(),

  /** Records to skip (OFFSET) — standard QueryAST `offset` */
  offset: z.number().optional(),

  /** Alias for limit (OData compatibility) */
  top: z.number().optional(),

  /** Cursor for keyset pagination */
  cursor: z.record(z.string(), z.unknown()).optional(),

  /** Full-text search configuration */
  search: FullTextSearchSchema.optional(),

  /**
   * Recursive relation loading map (expand).
   * 
   * Keys are lookup/master_detail field names; values are nested QueryAST
   * objects that control select, filter, sort, and further expansion on
   * the related object. The engine resolves expand via batch $in queries
   * (driver-agnostic) with a default max depth of 3.
   */
  expand: z.lazy(() => z.record(z.string(), QuerySchema)).optional(),

  /** SELECT DISTINCT flag */
  distinct: z.boolean().optional(),
}).describe('QueryAST-aligned query options for IDataEngine.find() operations'));

// --------------------------------------------------------------------------
// Legacy: DataEngineQueryOptionsSchema (DEPRECATED)
// --------------------------------------------------------------------------

/**
 * @deprecated Use `EngineQueryOptionsSchema` instead.
 * This schema uses legacy parameter names (filter/select/sort/skip/populate)
 * that require mechanical translation to QueryAST. Migrate to the
 * QueryAST-aligned `EngineQueryOptionsSchema` (where/fields/orderBy/offset/expand).
 */
export const DataEngineQueryOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** @deprecated Use `where` (EngineQueryOptionsSchema) */
  filter: DataEngineFilterSchema.optional(),
  /** @deprecated Use `fields` (EngineQueryOptionsSchema) */
  select: z.array(z.string()).optional(),
  /** @deprecated Use `orderBy` (EngineQueryOptionsSchema) */
  sort: DataEngineSortSchema.optional(),
  limit: z.number().int().min(1).optional(),
  /** @deprecated Use `offset` (EngineQueryOptionsSchema) */
  skip: z.number().int().min(0).optional(),
  top: z.number().int().min(1).optional(),
  /** @deprecated Use `expand` (EngineQueryOptionsSchema) */
  populate: z.array(z.string()).optional(),
}).describe('Query options for IDataEngine.find() operations'));

// ==========================================================================
// 3. method: INSERT
// ==========================================================================

export const DataEngineInsertOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** 
   * Return the inserted record(s)? 
   * Some drivers support RETURNING clause for efficiency.
   * Default: true
   */
  returning: z.boolean().default(true).optional(),
}).describe('Options for DataEngine.insert operations'));

// ==========================================================================
// 4. method: UPDATE (QueryAST-aligned)
// ==========================================================================

export const EngineUpdateOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions to identify records to update — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
  /** Perform an upsert? If true, insert if not found. */
  upsert: z.boolean().default(false).optional(),
  /** Update multiple records? If false, only the first match is updated. Default: false */
  multi: z.boolean().default(false).optional(),
  /** Return the updated record(s)? Default: false (returns update count/status) */
  returning: z.boolean().default(false).optional(),
}).describe('QueryAST-aligned options for DataEngine.update operations'));

// --------------------------------------------------------------------------
// Legacy: DataEngineUpdateOptionsSchema (DEPRECATED)
// --------------------------------------------------------------------------

/**
 * @deprecated Use `EngineUpdateOptionsSchema` instead.
 * Migrate `filter` → `where`.
 */
export const DataEngineUpdateOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** @deprecated Use `where` (EngineUpdateOptionsSchema) */
  filter: DataEngineFilterSchema.optional(),
  upsert: z.boolean().default(false).optional(),
  multi: z.boolean().default(false).optional(),
  returning: z.boolean().default(false).optional(),
}).describe('Options for DataEngine.update operations'));

// ==========================================================================
// 5. method: DELETE (QueryAST-aligned)
// ==========================================================================

export const EngineDeleteOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions to identify records to delete — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
  /** Delete multiple records? If false, only the first match is deleted. Default: false */
  multi: z.boolean().default(false).optional(),
}).describe('QueryAST-aligned options for DataEngine.delete operations'));

// --------------------------------------------------------------------------
// Legacy: DataEngineDeleteOptionsSchema (DEPRECATED)
// --------------------------------------------------------------------------

/**
 * @deprecated Use `EngineDeleteOptionsSchema` instead.
 * Migrate `filter` → `where`.
 */
export const DataEngineDeleteOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** @deprecated Use `where` (EngineDeleteOptionsSchema) */
  filter: DataEngineFilterSchema.optional(),
  multi: z.boolean().default(false).optional(),
}).describe('Options for DataEngine.delete operations'));

// ==========================================================================
// 6. method: AGGREGATE (QueryAST-aligned)
// ==========================================================================

export const EngineAggregateOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions (WHERE) — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
  /** Group By fields */
  groupBy: z.array(z.string()).optional(),
  /**
   * Aggregation definitions — uses standard AggregationNodeSchema (`function` key).
   * e.g. [{ function: 'sum', field: 'amount', alias: 'total' }]
   */
  aggregations: z.array(AggregationNodeSchema).optional(),
  /**
   * Reference timezone (IANA name) for date bucketing (ADR-0053 Phase 2).
   * When set to a non-UTC zone, `groupBy` items carrying a `dateGranularity`
   * bucket on that zone's calendar days. Unset or `'UTC'` keeps the UTC
   * fast path (native driver `date_trunc`).
   */
  timezone: z.string().optional(),
}).describe('QueryAST-aligned options for DataEngine.aggregate operations'));

// --------------------------------------------------------------------------
// Legacy: DataEngineAggregateOptionsSchema (DEPRECATED)
// --------------------------------------------------------------------------

/**
 * @deprecated Use `EngineAggregateOptionsSchema` instead.
 * Migrate `filter` → `where`, aggregation `method` → `function`.
 */
export const DataEngineAggregateOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** @deprecated Use `where` (EngineAggregateOptionsSchema) */
  filter: DataEngineFilterSchema.optional(),
  groupBy: z.array(z.string()).optional(),
  /** 
   * @deprecated Use `EngineAggregateOptionsSchema` with standard AggregationNodeSchema (`function` key).
   */
  aggregations: z.array(z.object({
    field: z.string(),
    method: z.enum(['count', 'sum', 'avg', 'min', 'max', 'count_distinct']),
    alias: z.string().optional()
  })).optional(),
}).describe('Options for DataEngine.aggregate operations'));

// ==========================================================================
// 7. method: COUNT (QueryAST-aligned)
// ==========================================================================

export const EngineCountOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
}).describe('QueryAST-aligned options for DataEngine.count operations'));

// --------------------------------------------------------------------------
// Legacy: DataEngineCountOptionsSchema (DEPRECATED)
// --------------------------------------------------------------------------

/**
 * @deprecated Use `EngineCountOptionsSchema` instead.
 * Migrate `filter` → `where`.
 */
export const DataEngineCountOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** @deprecated Use `where` (EngineCountOptionsSchema) */
  filter: DataEngineFilterSchema.optional(),
}).describe('Options for DataEngine.count operations'));

// ==========================================================================
// 8. Definition (Contract)
// ==========================================================================

export const DataEngineContractSchema = lazySchema(() => z.object({
  find: z.function()
    .input(z.tuple([z.string(), EngineQueryOptionsSchema.optional()]))
    .output(z.promise(z.array(z.unknown()))),
    
  findOne: z.function()
    .input(z.tuple([z.string(), EngineQueryOptionsSchema.optional()]))
    .output(z.promise(z.unknown())),
    
  insert: z.function()
    .input(z.tuple([z.string(), z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]), DataEngineInsertOptionsSchema.optional()]))
    .output(z.promise(z.unknown())),
    
  update: z.function()
    .input(z.tuple([z.string(), z.record(z.string(), z.unknown()), EngineUpdateOptionsSchema.optional()]))
    .output(z.promise(z.unknown())),
    
  delete: z.function()
    .input(z.tuple([z.string(), EngineDeleteOptionsSchema.optional()]))
    .output(z.promise(z.unknown())),
    
  count: z.function()
    .input(z.tuple([z.string(), EngineCountOptionsSchema.optional()]))
    .output(z.promise(z.number())),
    
  aggregate: z.function()
    .input(z.tuple([z.string(), EngineAggregateOptionsSchema]))
    .output(z.promise(z.array(z.unknown())))
}).describe('Standard Data Engine Contract'));

// ==========================================================================
// 9. Virtualization & RPC Protocol
// ==========================================================================

/**
 * Data Engine RPC Request (Virtual ObjectQL)
 * 
 * This schema defines the serialized format for executing Data Engine operations
 * via HTTP, Message Queue, or Plugin boundaries.
 * 
 * It enables "Virtual Data Engines" where the implementation resides in a 
 * separate microservice or plugin.
 */

/**
 * RPC backward-compatibility mixin — shared `@deprecated filter` field.
 * When both `filter` and `where` are present, the protocol/engine ignores
 * `filter` in favor of `where`; only one should be provided.
 */
const RpcLegacyFilterMixin = {
  /** @deprecated Use `where` */
  filter: DataEngineFilterSchema.optional(),
};

/**
 * RPC query options that accept BOTH new (where/fields/orderBy) and
 * legacy (filter/select/sort/skip/populate) parameter names.
 * 
 * **Precedence:** When both legacy and new keys are present for the same
 * concern, the protocol normalizer uses the new key (`where` > `filter`,
 * `fields` > `select`, `orderBy` > `sort`, `offset` > `skip`,
 * `expand` > `populate`). Callers should not mix vocabularies.
 */
const RpcQueryOptionsSchema = EngineQueryOptionsSchema.extend({
  ...RpcLegacyFilterMixin,
  /** @deprecated Use `fields` */
  select: z.array(z.string()).optional(),
  /** @deprecated Use `orderBy` */
  sort: DataEngineSortSchema.optional(),
  /** @deprecated Use `offset` */
  skip: z.number().int().min(0).optional(),
  /** @deprecated Use `expand` */
  populate: z.array(z.string()).optional(),
});

export const DataEngineFindRequestSchema = lazySchema(() => z.object({
  method: z.literal('find'),
  object: z.string(),
  query: RpcQueryOptionsSchema.optional()
}));

export const DataEngineFindOneRequestSchema = lazySchema(() => z.object({
  method: z.literal('findOne'),
  object: z.string(),
  query: RpcQueryOptionsSchema.optional()
}));

export const DataEngineInsertRequestSchema = lazySchema(() => z.object({
  method: z.literal('insert'),
  object: z.string(),
  data: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]),
  options: DataEngineInsertOptionsSchema.optional()
}));

export const DataEngineUpdateRequestSchema = lazySchema(() => z.object({
  method: z.literal('update'),
  object: z.string(),
  data: z.record(z.string(), z.unknown()),
  id: z.union([z.string(), z.number()]).optional().describe('ID for single update, or use where in options'),
  options: EngineUpdateOptionsSchema.extend(RpcLegacyFilterMixin).optional()
}));

export const DataEngineDeleteRequestSchema = lazySchema(() => z.object({
  method: z.literal('delete'),
  object: z.string(),
  id: z.union([z.string(), z.number()]).optional().describe('ID for single delete, or use where in options'),
  options: EngineDeleteOptionsSchema.extend(RpcLegacyFilterMixin).optional()
}));

export const DataEngineCountRequestSchema = lazySchema(() => z.object({
  method: z.literal('count'),
  object: z.string(),
  query: EngineCountOptionsSchema.extend(RpcLegacyFilterMixin).optional()
}));

export const DataEngineAggregateRequestSchema = lazySchema(() => z.object({
  method: z.literal('aggregate'),
  object: z.string(),
  query: EngineAggregateOptionsSchema.extend(RpcLegacyFilterMixin)
}));

/**
 * Data Engine Execute Request (Raw Command)
 * Execute a raw command/query native to the driver (e.g. SQL, Shell, Remote API).
 */
export const DataEngineExecuteRequestSchema = lazySchema(() => z.object({
  method: z.literal('execute'),
  /** The abstract command (string SQL, or JSON object) */
  command: z.unknown(),
  /** Optional options */
  options: z.record(z.string(), z.unknown()).optional()
}));

/**
 * Data Engine Vector Find Request (AI/RAG)
 * Perform a similarity search using vector embeddings.
 */
export const DataEngineVectorFindRequestSchema = lazySchema(() => z.object({
  method: z.literal('vectorFind'),
  object: z.string(),
  /** The vector embedding to search for */
  vector: z.array(z.number()),
  /** Optional pre-filter (Metadata filtering) — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
  /** Fields to retrieve — standard QueryAST `fields` */
  fields: z.array(z.string()).optional(),
  /** Number of results */
  limit: z.number().int().default(5).optional(),
  /** Minimum similarity score (0-1) or distance threshold */
  threshold: z.number().optional()
}));

/**
 * Data Engine Batch Request
 * Execute multiple operations in a single transaction/request efficiently.
 */
export const DataEngineBatchRequestSchema = lazySchema(() => z.object({
  method: z.literal('batch'),
  requests: z.array(z.discriminatedUnion('method', [
    DataEngineFindRequestSchema,
    DataEngineFindOneRequestSchema,
    DataEngineInsertRequestSchema,
    DataEngineUpdateRequestSchema,
    DataEngineDeleteRequestSchema,
    DataEngineCountRequestSchema,
    DataEngineAggregateRequestSchema,
    DataEngineExecuteRequestSchema,
    DataEngineVectorFindRequestSchema
  ])),
  /** 
   * Transaction Mode
   * - true: All or nothing (Atomic)
   * - false: Best effort, continue on error
   */
  transaction: z.boolean().default(true).optional()
}));

/**
 * Unified Data Engine Request Union
 * Use this to validate any incoming "Virtual ObjectQL" request.
 */
export const DataEngineRequestSchema = lazySchema(() => z.discriminatedUnion('method', [
  DataEngineFindRequestSchema,
  DataEngineFindOneRequestSchema,
  DataEngineInsertRequestSchema,
  DataEngineUpdateRequestSchema,
  DataEngineDeleteRequestSchema,
  DataEngineCountRequestSchema,
  DataEngineAggregateRequestSchema,
  DataEngineBatchRequestSchema,
  DataEngineExecuteRequestSchema,
  DataEngineVectorFindRequestSchema
]).describe('Virtual ObjectQL Request Protocol'));

// ==========================================================================
// 10. Type Exports
// ==========================================================================

// --- New: QueryAST-aligned types (preferred) ---
export type EngineQueryOptions = z.infer<typeof EngineQueryOptionsSchema>;
export type EngineUpdateOptions = z.infer<typeof EngineUpdateOptionsSchema>;
export type EngineDeleteOptions = z.infer<typeof EngineDeleteOptionsSchema>;
export type EngineAggregateOptions = z.infer<typeof EngineAggregateOptionsSchema>;
export type EngineCountOptions = z.infer<typeof EngineCountOptionsSchema>;

// --- Legacy: deprecated types (kept for backward compatibility) ---
export type DataEngineFilter = z.infer<typeof DataEngineFilterSchema>;
/** @deprecated Use standard `SortNode[]` from QueryAST instead. */
export type DataEngineSort = z.infer<typeof DataEngineSortSchema>;
export type BaseEngineOptions = z.infer<typeof BaseEngineOptionsSchema>;
/** @deprecated Use `EngineQueryOptions` instead. */
export type DataEngineQueryOptions = z.infer<typeof DataEngineQueryOptionsSchema>;
export type DataEngineInsertOptions = z.infer<typeof DataEngineInsertOptionsSchema>;
/** @deprecated Use `EngineUpdateOptions` instead. */
export type DataEngineUpdateOptions = z.infer<typeof DataEngineUpdateOptionsSchema>;
/** @deprecated Use `EngineDeleteOptions` instead. */
export type DataEngineDeleteOptions = z.infer<typeof DataEngineDeleteOptionsSchema>;
/** @deprecated Use `EngineAggregateOptions` instead. */
export type DataEngineAggregateOptions = z.infer<typeof DataEngineAggregateOptionsSchema>;
/** @deprecated Use `EngineCountOptions` instead. */
export type DataEngineCountOptions = z.infer<typeof DataEngineCountOptionsSchema>;
export type DataEngineRequest = z.infer<typeof DataEngineRequestSchema>;
