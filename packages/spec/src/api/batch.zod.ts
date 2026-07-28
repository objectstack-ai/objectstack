// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ApiErrorSchema, BaseResponseSchema, RecordDataSchema } from './contract.zod';
import { DroppedFieldsEventSchema } from '../data/data-engine.zod';

/**
 * Batch Operations API
 * 
 * Provides efficient bulk data operations with transaction support.
 * Implements P0/P1 requirements for ObjectStack kernel.
 * 
 * Features:
 * - Batch create/update/delete operations
 * - Atomic transaction support (all-or-none)
 * - Partial success handling
 * - Detailed error reporting per record
 * 
 * Industry alignment: Salesforce Bulk API, Microsoft Dynamics Bulk Operations
 */

// ==========================================
// Batch Operation Types
// ==========================================

/**
 * Batch Operation Type Enum
 * Defines the type of batch operation to perform
 */
import { lazySchema } from '../shared/lazy-schema';
export const BatchOperationType = z.enum([
  'create',    // Batch insert
  'update',    // Batch update
  'upsert',    // Batch upsert (insert or update based on external ID)
  'delete',    // Batch delete
]);

export type BatchOperationType = z.infer<typeof BatchOperationType>;

// ==========================================
// Batch Request Schemas
// ==========================================

/**
 * Batch Record Schema
 * Individual record in a batch operation
 */
export const BatchRecordSchema = lazySchema(() => z.object({
  id: z.string().optional().describe('Record ID (required for update/delete)'),
  data: RecordDataSchema.optional().describe('Record data (required for create/update/upsert)'),
  externalId: z.string().optional().describe('External ID for upsert matching'),
}));

export type BatchRecord = z.infer<typeof BatchRecordSchema>;

/**
 * Batch Operation Options Schema
 * Configuration options for batch operations
 */
export const BatchOptionsSchema = lazySchema(() => z.object({
  atomic: z.boolean().optional().default(true).describe('If true, rollback entire batch on any failure (transaction mode)'),
  returnRecords: z.boolean().optional().default(false).describe('If true, return full record data in response'),
  continueOnError: z.boolean().optional().default(false).describe('If true (and atomic=false), continue processing remaining records after errors'),
  validateOnly: z.boolean().optional().default(false).describe('If true, validate records without persisting changes (dry-run mode)'),
}));

export type BatchOptions = z.infer<typeof BatchOptionsSchema>;

/**
 * Batch Update Request Schema
 * Request payload for batch update operations
 * 
 * @example
 * // POST /api/v1/data/{object}/batch
 * {
 *   "operation": "update",
 *   "records": [
 *     { "id": "1", "data": { "name": "Updated Name 1", "status": "active" } },
 *     { "id": "2", "data": { "name": "Updated Name 2", "status": "active" } }
 *   ],
 *   "options": {
 *     "atomic": true,
 *     "returnRecords": true
 *   }
 * }
 */
export const BatchUpdateRequestSchema = lazySchema(() => z.object({
  operation: BatchOperationType.describe('Type of batch operation'),
  records: z.array(BatchRecordSchema).min(1).max(200).describe('Array of records to process (max 200 per batch)'),
  options: BatchOptionsSchema.optional().describe('Batch operation options'),
}));

export type BatchUpdateRequest = z.input<typeof BatchUpdateRequestSchema>;

/**
 * Simplified Batch Update Request (for updateMany API)
 * Simplified request for batch updates without operation field
 * 
 * @example
 * // POST /api/v1/data/{object}/updateMany
 * {
 *   "records": [
 *     { "id": "1", "data": { "name": "Updated Name 1" } },
 *     { "id": "2", "data": { "name": "Updated Name 2" } }
 *   ],
 *   "options": { "atomic": true }
 * }
 */
export const UpdateManyRequestSchema = lazySchema(() => z.object({
  records: z.array(BatchRecordSchema).min(1).max(200).describe('Array of records to update (max 200 per batch)'),
  options: BatchOptionsSchema.optional().describe('Update options'),
}));

export type UpdateManyRequest = z.input<typeof UpdateManyRequestSchema>;

// ==========================================
// Batch Response Schemas
// ==========================================

/**
 * Batch Operation Result Schema
 * Result for a single record in a batch operation
 */
export const BatchOperationResultSchema = lazySchema(() => z.object({
  id: z.string().optional().describe('Record ID if operation succeeded'),
  success: z.boolean().describe('Whether this record was processed successfully'),
  errors: z.array(ApiErrorSchema).optional().describe('Array of errors if operation failed'),
  data: RecordDataSchema.optional().describe('Full record data (if returnRecords=true)'),
  index: z.number().optional().describe('Index of the record in the request array'),
  droppedFields: z.array(DroppedFieldsEventSchema).optional().describe(
    'Write-observability (#3407/#3431/#3455): caller-supplied fields LEGALLY stripped from ' +
    'THIS row before it was written — static `readonly` (#2948) / TRUE `readonlyWhen` ' +
    '(#3042) on update, or the #3043 create-ingress strip. Per-row because a batch can drop ' +
    'different fields on different rows (`readonlyWhen` is record-state-dependent). Present ' +
    'ONLY when ≥1 field was dropped for this row; the row still succeeded (success unchanged). ' +
    'A single response header cannot express per-row drops, so this body field is the ' +
    'canonical bulk channel — REST does not emit `X-ObjectStack-Dropped-Fields` for batches. ' +
    'Optional — omit-when-empty keeps the shape backward-compatible.'
  ),
}));

export type BatchOperationResult = z.infer<typeof BatchOperationResultSchema>;

/**
 * Batch Update Response Schema
 * Response payload for batch operations
 * 
 * @example Success Response
 * {
 *   "success": true,
 *   "operation": "update",
 *   "total": 2,
 *   "succeeded": 2,
 *   "failed": 0,
 *   "results": [
 *     { "id": "1", "success": true, "index": 0 },
 *     { "id": "2", "success": true, "index": 1 }
 *   ],
 *   "meta": {
 *     "timestamp": "2026-01-29T12:00:00Z",
 *     "duration": 150
 *   }
 * }
 * 
 * @example Partial Success Response (atomic=false)
 * {
 *   "success": false,
 *   "operation": "update",
 *   "total": 2,
 *   "succeeded": 1,
 *   "failed": 1,
 *   "results": [
 *     { "id": "1", "success": true, "index": 0 },
 *     { 
 *       "success": false, 
 *       "index": 1,
 *       "errors": [{ "code": "validation_error", "message": "Invalid email format" }]
 *     }
 *   ],
 *   "meta": {
 *     "timestamp": "2026-01-29T12:00:00Z"
 *   }
 * }
 */
export const BatchUpdateResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  operation: BatchOperationType.optional().describe('Operation type that was performed'),
  total: z.number().describe('Total number of records in the batch'),
  succeeded: z.number().describe('Number of records that succeeded'),
  failed: z.number().describe('Number of records that failed'),
  results: z.array(BatchOperationResultSchema).describe('Detailed results for each record'),
}));

export type BatchUpdateResponse = z.infer<typeof BatchUpdateResponseSchema>;

// ==========================================
// Batch Delete Schemas
// ==========================================

/**
 * Batch Delete Request Schema
 * Simplified request for batch delete operations
 * 
 * @example
 * // POST /api/v1/data/{object}/deleteMany
 * {
 *   "ids": ["1", "2", "3"],
 *   "options": { "atomic": true }
 * }
 */
export const DeleteManyRequestSchema = lazySchema(() => z.object({
  ids: z.array(z.string()).min(1).max(200).describe('Array of record IDs to delete (max 200)'),
  options: BatchOptionsSchema.optional().describe('Delete options'),
}));

export type DeleteManyRequest = z.infer<typeof DeleteManyRequestSchema>;

// ==========================================
// API Contract Exports
// ==========================================

/**
 * Batch API Contracts
 * Standardized contracts for batch operations
 */
export const BatchApiContracts = {
  batchOperation: {
    input: BatchUpdateRequestSchema,
    output: BatchUpdateResponseSchema,
  },
  updateMany: {
    input: UpdateManyRequestSchema,
    output: BatchUpdateResponseSchema,
  },
  deleteMany: {
    input: DeleteManyRequestSchema,
    output: BatchUpdateResponseSchema,
  },
};

/**
 * Batch Configuration Schema
 * 
 * Configuration for enabling batch operations API.
 */
export const BatchConfigSchema = lazySchema(() => z.object({
  /** Enable batch operations */
  enabled: z.boolean().default(true).describe('Enable batch operations'),
  
  /** Maximum records per batch */
  maxRecordsPerBatch: z.number().int().min(1).max(1000).default(200).describe('Maximum records per batch'),
  
  /** Default options */
  defaultOptions: BatchOptionsSchema.optional().describe('Default batch options'),
}).passthrough()); // Allow additional properties

export type BatchConfig = z.infer<typeof BatchConfigSchema>;

// ==========================================
// Cross-Object Transactional Batch (issue #1604)
// ==========================================

/**
 * A single operation in a cross-object transactional batch. Targets one object
 * with a create/update/delete action. A value inside `data` may carry an
 * intra-batch reference `{ $ref: <earlier op index> }` that the server resolves
 * to that op's created id — so a child row can point at a parent created earlier
 * in the SAME transaction (master-detail). See ADR-0034 / #1604.
 */
export const CrossObjectBatchOperationSchema = lazySchema(() => z.object({
  object: z.string().min(1).describe('Target object (table) name'),
  action: z.enum(['create', 'update', 'delete']).optional().default('create').describe('Operation to perform (default: create)'),
  id: z.string().optional().describe('Target record id — required for update and delete'),
  data: RecordDataSchema.optional().describe('Record payload for create/update; a value may be { $ref: <opIndex> } to reference an earlier op\'s created id'),
}));

export type CrossObjectBatchOperation = z.input<typeof CrossObjectBatchOperationSchema>;

/**
 * Request payload for the cross-object transactional batch
 * (`POST {basePath}/batch`). Every operation runs in ONE engine transaction —
 * commit all or roll back all. `atomic` is accepted for contract symmetry but
 * MUST be true (the endpoint is all-or-nothing by construction); a non-atomic
 * per-object batch is served by `POST /data/:object/batch` instead.
 *
 * @example
 * // POST /api/v1/batch — parent + child in one transaction (master-detail)
 * {
 *   "operations": [
 *     { "object": "project", "action": "create", "data": { "name": "Apollo" } },
 *     { "object": "task", "action": "create", "data": { "title": "Kickoff", "project": { "$ref": 0 } } }
 *   ]
 * }
 */
export const CrossObjectBatchRequestSchema = lazySchema(() => z.object({
  operations: z.array(CrossObjectBatchOperationSchema).max(1000).describe('Ordered operations executed in one transaction'),
  atomic: z.boolean().optional().default(true).describe('Always true — the cross-object batch is all-or-nothing'),
}));

export type CrossObjectBatchRequest = z.input<typeof CrossObjectBatchRequestSchema>;

/**
 * One strip event on a cross-object batch, tagged with the operation it
 * belongs to (#3794). The per-object bulk paths hang `droppedFields` on their
 * per-row result object; this batch's `results` entries are the raw record
 * echoes (`z.unknown()`), with no envelope to hang anything on — so the events
 * ride a parallel top-level list and carry `index` to point back at the
 * operation that produced them.
 */
export const CrossObjectBatchDroppedFieldsSchema = lazySchema(() => DroppedFieldsEventSchema.extend({
  index: z.number().int().min(0).describe('Index of the operation in the request `operations` array'),
}).describe('A cross-object batch strip event: dropped fields plus the operation index'));

export type CrossObjectBatchDroppedFields = z.infer<typeof CrossObjectBatchDroppedFieldsSchema>;

/**
 * Response for the cross-object transactional batch — one result per operation,
 * index-aligned with the request `operations` (create/update echo the record,
 * delete echoes the driver's delete result).
 */
export const CrossObjectBatchResponseSchema = lazySchema(() => z.object({
  results: z.array(z.unknown()).describe('Per-operation result, index-aligned with the request operations'),
  droppedFields: z.array(CrossObjectBatchDroppedFieldsSchema).optional().describe(
    'Write-observability (#3407/#3431/#3455/#3794): caller-supplied fields the engine LEGALLY ' +
    'stripped from an operation before it was written — static `readonly` (#2948) or a TRUE ' +
    '`readonlyWhen` predicate (#3042). This endpoint is the console record form\'s save path ' +
    '(master-detail writes parent + children in one transaction), so without it the ONE surface ' +
    'where a user edits a `readonlyWhen` field reported plain success while the value never ' +
    'landed. Each event carries the `index` of its operation. Present ONLY when ≥1 field was ' +
    'dropped; the batch still committed without them (results/success semantics unchanged). ' +
    'Optional — omit-when-empty keeps the shape backward-compatible.'
  ),
}));

export type CrossObjectBatchResponse = z.infer<typeof CrossObjectBatchResponseSchema>;
