// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ApiErrorSchema, BaseResponseSchema, RecordDataSchema } from './contract.zod';
import { DroppedFieldsEventSchema } from '../data/data-engine.zod';
import { retiredKey } from '../shared/retired-key';

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

export type BatchOperationType = z.input<typeof BatchOperationType>;

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

export type BatchRecord = z.input<typeof BatchRecordSchema>;

/**
 * Batch Operation Options Schema
 * Configuration options for batch operations
 */
export const BatchOptionsSchema = lazySchema(() => z.object({
  // ADR-0119 D4. `atomic` declared `.default(true)` while NO enforcement site
  // delivered atomicity: `batchData` merely broke its loop, leaving every prior
  // write committed, and the REST route deliberately forwards the ORIGINAL body
  // rather than the parsed output, so this default never reached the loop at
  // all. Now that the flag is real, the declaration is aligned DOWN to what
  // every site already does rather than up to what none of them did — honouring
  // the old `true` would silently flip the failure semantics of every existing
  // batch caller and hard-fail ordinary batches on any driver that cannot
  // transact. Callers who were explicitly sending `atomic: true` now get what
  // they asked for; callers sending nothing keep today's behaviour exactly.
  atomic: z.boolean().optional().default(false).describe(
    'Opt-in all-or-nothing. When explicitly true the whole batch runs inside ONE engine transaction: '
    + 'the first failure rolls back every prior write, and the response reports zero successes — each row '
    + 'carries `errors[0].code` ROLLED_BACK (written, then undone), the causal row its own error, and rows '
    + 'never reached NOT_ATTEMPTED. A runtime that cannot roll back REFUSES the request '
    + '(501 NOT_IMPLEMENTED) rather than silently degrading to best-effort — probe '
    + '`capabilities.transactionalBatch` on /discovery first. Takes precedence over continueOnError. '
    + 'Default false: sequential best-effort.'),
  returnRecords: z.boolean().optional().default(false).describe('If true, return full record data in response'),
  continueOnError: z.boolean().optional().default(false).describe(
    'If true (and atomic=false), continue processing remaining records after errors. '
    + 'Default false: the first failure ENDS the run — records before it stay written (nothing is rolled '
    + 'back on this arm), and every record after it is reported `errors[0].code` NOT_ATTEMPTED rather than '
    + 'omitted, so `results` always covers all `total` records and `succeeded + failed === total` (#7539).'),
  // `validateOnly` promised a dry-run — "validate records without persisting" —
  // but no batch surface ever read it (`updateManyData` / `deleteManyData` /
  // `batchData` all persist regardless). A caller sending `validateOnly: true`
  // to preview a mutation got it EXECUTED: a declared flag actively lying about
  // a data-safety guarantee, the worst shape of "declared ≠ enforced" (PD #10).
  // Retired rather than half-implemented: a real dry-run has its own design
  // space (cascade / constraint semantics under no-commit, response contract)
  // and should be reintroduced deliberately, not back-filled to match a promise
  // nothing kept. Tombstoned so writing it is audible, not silently stripped.
  validateOnly: retiredKey(
    '`options.validateOnly` was removed from BatchOptions in @objectstack/spec (#4052). '
    + 'It was never implemented: the batch surfaces persisted regardless, so a "dry-run" would have '
    + 'silently executed. There is no dry-run today — drop the key. If you need to preview a batch '
    + 'without writing, open an issue so it can be designed (no-commit cascade / constraint semantics) '
    + 'and reintroduced as a flag that actually holds.',
  ),
}));

export type BatchOptions = z.input<typeof BatchOptionsSchema>;
/** Post-parse shape of {@link BatchOptions} — defaults applied, transforms run (ADR-0122). */
export type BatchOptionsParsed = z.infer<typeof BatchOptionsSchema>;

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
  // [#3939] No `.max()` here: the batch-size cap is DEPLOYMENT policy
  // (`RestServerConfig.batch.maxBatchSize`, 1..1000, default 200), enforced at
  // the route so one place decides it. A hardcoded bound in the spec was a
  // second source of truth that never matched — it said 200 while the routes
  // enforced nothing at all. `.min(1)` is gone too: an empty batch is a no-op
  // (`total: 0`), not a client error.
  records: z.array(BatchRecordSchema).describe('Array of records to process (server caps the count — see batch.maxBatchSize)'),
  options: BatchOptionsSchema.optional().describe('Batch operation options'),
}));

export type BatchUpdateRequest = z.input<typeof BatchUpdateRequestSchema>;
/** Post-parse shape of {@link BatchUpdateRequest} — defaults applied, transforms run (ADR-0122). */
export type BatchUpdateRequestParsed = z.infer<typeof BatchUpdateRequestSchema>;

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
/**
 * One row of an `updateMany` batch.
 *
 * [#3939] Deliberately NOT {@link BatchRecordSchema}, which makes `id` and
 * `data` optional because the generic `/batch` route serves create (no id) and
 * delete (no data) through the same shape. `updateMany` needs both on every
 * row — `updateManyData` reads `record.id` and `record.data` unconditionally —
 * so reusing the loose shape declared a contract that accepted `{}` and an
 * implementation that could not. This is the shape the route actually
 * validates; {@link UpdateManyDataRequestSchema} extends it with the object
 * name from the URL path.
 */
export const UpdateManyRecordSchema = lazySchema(() => z.object({
  id: z.string().describe('Record ID'),
  data: RecordDataSchema.describe('Fields to update'),
}));

export type UpdateManyRecord = z.input<typeof UpdateManyRecordSchema>;

export const UpdateManyRequestSchema = lazySchema(() => z.object({
  // [#3939] Cap lives at the route (`batch.maxBatchSize`), not here — see
  // BatchUpdateRequestSchema above.
  records: z.array(UpdateManyRecordSchema).describe('Array of records to update (server caps the count — see batch.maxBatchSize)'),
  options: BatchOptionsSchema.optional().describe('Update options'),
}));

export type UpdateManyRequest = z.input<typeof UpdateManyRequestSchema>;
/** Post-parse shape of {@link UpdateManyRequest} — defaults applied, transforms run (ADR-0122). */
export type UpdateManyRequestParsed = z.infer<typeof UpdateManyRequestSchema>;

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
  errors: z.array(ApiErrorSchema).optional().describe(
    'Array of errors if operation failed. Branch on `errors[0].code` — an atomic batch that rolled back '
    + 'marks rows that were written then undone with code ROLLED_BACK and rows never reached with '
    + 'NOT_ATTEMPTED, while the causal row keeps its own error (#4793). A NON-atomic batch that stopped '
    + '(the `continueOnError: false` default) marks its un-attempted tail with the same NOT_ATTEMPTED code '
    + '— rows before the failure stay written and keep reporting success, since nothing was rolled back '
    + '(#7539).'),
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

export type BatchOperationResult = z.input<typeof BatchOperationResultSchema>;
/** Post-parse shape of {@link BatchOperationResult} — defaults applied, transforms run (ADR-0122). */
export type BatchOperationResultParsed = z.infer<typeof BatchOperationResultSchema>;

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

export type BatchUpdateResponse = z.input<typeof BatchUpdateResponseSchema>;
/** Post-parse shape of {@link BatchUpdateResponse} — defaults applied, transforms run (ADR-0122). */
export type BatchUpdateResponseParsed = z.infer<typeof BatchUpdateResponseSchema>;

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
  // [#3939] Cap lives at the route (`batch.maxBatchSize`), not here — see
  // BatchUpdateRequestSchema above. This matters more since #3897 made the
  // route delete per id by primary key (for cascade + per-row results): an
  // unbounded list is now N engine round-trips, not one statement.
  ids: z.array(z.string()).describe('Array of record IDs to delete (server caps the count — see batch.maxBatchSize)'),
  options: BatchOptionsSchema.optional().describe('Delete options'),
}));

export type DeleteManyRequest = z.input<typeof DeleteManyRequestSchema>;
/** Post-parse shape of {@link DeleteManyRequest} — defaults applied, transforms run (ADR-0122). */
export type DeleteManyRequestParsed = z.infer<typeof DeleteManyRequestSchema>;

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

export type BatchConfig = z.input<typeof BatchConfigSchema>;
/** Post-parse shape of {@link BatchConfig} — defaults applied, transforms run (ADR-0122). */
export type BatchConfigParsed = z.infer<typeof BatchConfigSchema>;

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
/** Post-parse shape of {@link CrossObjectBatchOperation} — defaults applied, transforms run (ADR-0122). */
export type CrossObjectBatchOperationParsed = z.infer<typeof CrossObjectBatchOperationSchema>;

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
/** Post-parse shape of {@link CrossObjectBatchRequest} — defaults applied, transforms run (ADR-0122). */
export type CrossObjectBatchRequestParsed = z.infer<typeof CrossObjectBatchRequestSchema>;

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

export type CrossObjectBatchDroppedFields = z.input<typeof CrossObjectBatchDroppedFieldsSchema>;

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

export type CrossObjectBatchResponse = z.input<typeof CrossObjectBatchResponseSchema>;
