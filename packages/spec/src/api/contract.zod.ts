// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { QuerySchema } from '../data/query.zod';
import { ErrorCode } from './error-code-ledger.zod';

// ==========================================
// 1. Base Envelopes
// ==========================================

import { lazySchema } from '../shared/lazy-schema';
export const ApiErrorSchema = lazySchema(() => z.object({
  /**
   * Machine-readable semantic code (ADR-0112): a `StandardErrorCode` member or
   * a code registered in `ERROR_CODE_LEDGER`. A closed set on purpose — an
   * unregistered code fails parse, so the envelope conformance suites catch
   * invented codes instead of letting a new dialect grow (#3841).
   */
  code: ErrorCode.describe('Error code (e.g. VALIDATION_ERROR; StandardErrorCode ∪ ERROR_CODE_LEDGER)'),
  message: z.string().describe('Readable error message'),
  category: z.string().optional().describe('Error category (e.g. validation, authorization)'),
  /**
   * The numeric HTTP status, when a producer chooses to mirror it into the body.
   *
   * Declared (#3842) because the runtime dispatcher had nowhere to put it and
   * used `code` — the semantic slot above — instead, handing callers `403` where
   * the contract promises a string and forcing the real code into `details`.
   * `EnhancedApiErrorSchema.httpStatus` set the precedent; this is the same
   * field on the base envelope.
   *
   * Optional and redundant on purpose: the response status is authoritative, so
   * a producer that emits only the semantic `code` is fully conformant. Callers
   * should branch on `code`, not on this.
   */
  httpStatus: z.number().int().optional().describe('HTTP status of the response carrying this error'),
  details: z.unknown().optional().describe('Additional error context (e.g. field validation errors)'),
  requestId: z.string().optional().describe('Request ID for tracking'),
}));

export const BaseResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Operation success status'),
  error: ApiErrorSchema.optional().describe('Error details if success is false'),
  meta: z.object({
    timestamp: z.string(),
    duration: z.number().optional(),
    requestId: z.string().optional(),
    traceId: z.string().optional(),
  }).optional().describe('Response metadata'),
}));

// ==========================================
// 2. Request Payloads (Inputs)
// ==========================================

export const RecordDataSchema = lazySchema(() => z.record(z.string(), z.unknown()).describe('Key-value map of record data'));

/**
 * Standard Create Request
 */
export const CreateRequestSchema = lazySchema(() => z.object({
  data: RecordDataSchema.describe('Record data to insert'),
}));

/**
 * Standard Update Request
 */
export const UpdateRequestSchema = lazySchema(() => z.object({
  data: RecordDataSchema.describe('Partial record data to update'),
}));

/**
 * Standard Bulk Request
 */
export const BulkRequestSchema = lazySchema(() => z.object({
  records: z.array(RecordDataSchema).describe('Array of records to process'),
  allOrNone: z.boolean().default(true).describe('If true, rollback entire transaction on any failure'),
}));

/**
 * Export Request
 */
export const ExportRequestSchema = lazySchema(() => z.intersection(
  QuerySchema,
  z.object({
    format: z.enum(['csv', 'json', 'xlsx']).default('csv'),
  })
));

// ==========================================
// 3. Response Payloads (Outputs)
// ==========================================

/**
 * Single Record Response (Get/Create/Update)
 */
export const SingleRecordResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: RecordDataSchema.describe('The requested or modified record'),
}));

/**
 * List/Query Response
 */
export const ListRecordResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.array(RecordDataSchema).describe('Array of matching records'),
  pagination: z.object({
    total: z.number().optional().describe('Total matching records count'),
    limit: z.number().optional().describe('Page size'),
    offset: z.number().optional().describe('Page offset'),
    cursor: z.string().optional().describe('Cursor for next page'),
    nextCursor: z.string().optional().describe('Next cursor for pagination'),
    hasMore: z.boolean().describe('Are there more pages?'),
  }).describe('Pagination info'),
}));

/**
 * ID Request (Get/Delete)
 */
export const IdRequestSchema = lazySchema(() => z.object({
  id: z.string().describe('Record ID'),
}));

/**
 * Modification Result (for Batch/Bulk operations)
 */
export const ModificationResultSchema = lazySchema(() => z.object({
  id: z.string().optional().describe('Record ID if processed'),
  success: z.boolean(),
  errors: z.array(ApiErrorSchema).optional(),
  index: z.number().optional().describe('Index in original request'),
  data: z.unknown().optional().describe('Result data (e.g. created record)'),
}));

/**
 * Bulk Operation Response
 */
export const BulkResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.array(ModificationResultSchema).describe('Results for each item in the batch'),
}));

/**
 * Delete Response
 */
export const DeleteResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  id: z.string().describe('ID of the deleted record'),
}));

// ==========================================
// 4. API Contract Registry
// ==========================================

/**
 * Standard API Contracts map
 * Used for generating SDKs and Documentation
 */
export const StandardApiContracts = {
  create: {
    input: CreateRequestSchema,
    output: SingleRecordResponseSchema
  },
  delete: {
    input: IdRequestSchema,
    output: DeleteResponseSchema
  },
  get: {
    input: IdRequestSchema,
    output: SingleRecordResponseSchema
  },
  update: {
    input: UpdateRequestSchema,
    output: SingleRecordResponseSchema
  },
  list: {
    input: QuerySchema,
    output: ListRecordResponseSchema
  },
  bulkCreate: {
    input: BulkRequestSchema,
    output: BulkResponseSchema
  },
  bulkUpdate: {
    input: BulkRequestSchema,
    output: BulkResponseSchema
  },
  bulkUpsert: {
    input: BulkRequestSchema,
    output: BulkResponseSchema
  },
  bulkDelete: {
    input: z.object({ ids: z.array(z.string()) }),
    output: BulkResponseSchema
  }
};

// ==========================================
// 5. DataLoader / N+1 Query Prevention
// ==========================================

/**
 * DataLoader Configuration Schema
 * Batch loading configuration to prevent N+1 query problems
 */
export const DataLoaderConfigSchema = lazySchema(() => z.object({
  maxBatchSize: z.number().int().default(100).describe('Maximum number of keys per batch load'),
  batchScheduleFn: z.enum(['microtask', 'timeout', 'manual']).default('microtask')
    .describe('Scheduling strategy for collecting batch keys'),
  cacheEnabled: z.boolean().default(true).describe('Enable per-request result caching'),
  cacheKeyFn: z.string().optional().describe('Name or identifier of the cache key function'),
  cacheTtl: z.number().min(0).optional().describe('Cache time-to-live in seconds (0 = no expiration)'),
  coalesceRequests: z.boolean().default(true).describe('Deduplicate identical requests within a batch window'),
  maxConcurrency: z.number().int().optional().describe('Maximum parallel batch requests'),
}));

/**
 * Batch Loading Strategy Schema
 * Defines how batched data loading is orchestrated
 */
export const BatchLoadingStrategySchema = lazySchema(() => z.object({
  strategy: z.enum(['dataloader', 'windowed', 'prefetch']).describe('Batch loading strategy type'),
  windowMs: z.number().optional().describe('Collection window duration in milliseconds (for windowed strategy)'),
  prefetchDepth: z.number().int().optional().describe('Depth of relation prefetching (for prefetch strategy)'),
  associationLoading: z.enum(['lazy', 'eager', 'batch']).default('batch')
    .describe('How to load related associations'),
}));

/**
 * Query Optimization Configuration Schema
 * Top-level configuration for N+1 prevention and query optimization
 */
export const QueryOptimizationConfigSchema = lazySchema(() => z.object({
  preventNPlusOne: z.boolean().describe('Enable N+1 query detection and prevention'),
  dataLoader: DataLoaderConfigSchema.optional().describe('DataLoader batch loading configuration'),
  batchStrategy: BatchLoadingStrategySchema.optional().describe('Batch loading strategy configuration'),
  maxQueryDepth: z.number().int().describe('Maximum depth for nested relation queries'),
  queryComplexityLimit: z.number().optional().describe('Maximum allowed query complexity score'),
  enableQueryPlan: z.boolean().default(false).describe('Log query execution plans for debugging'),
}));

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type BaseResponse = z.infer<typeof BaseResponseSchema>;
export type RecordData = z.infer<typeof RecordDataSchema>;
export type CreateRequest = z.infer<typeof CreateRequestSchema>;
export type UpdateRequest = z.infer<typeof UpdateRequestSchema>;
export type BulkRequest = z.infer<typeof BulkRequestSchema>;
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type SingleRecordResponse = z.infer<typeof SingleRecordResponseSchema>;
export type ListRecordResponse = z.infer<typeof ListRecordResponseSchema>;
export type IdRequest = z.infer<typeof IdRequestSchema>;
export type ModificationResult = z.infer<typeof ModificationResultSchema>;
export type BulkResponse = z.infer<typeof BulkResponseSchema>;
export type DeleteResponse = z.infer<typeof DeleteResponseSchema>;
export type DataLoaderConfig = z.infer<typeof DataLoaderConfigSchema>;
export type BatchLoadingStrategy = z.infer<typeof BatchLoadingStrategySchema>;
export type QueryOptimizationConfig = z.infer<typeof QueryOptimizationConfigSchema>;
