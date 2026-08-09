// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { QuerySchema } from '../data/query.zod';
import { ErrorCode } from './error-code-ledger.zod';
import { StandardErrorCode } from './errors.zod';

// ==========================================
// 1. Base Envelopes
// ==========================================

import { lazySchema } from '../shared/lazy-schema';
export const ApiErrorSchema = lazySchema(() => z.object({
  /**
   * Machine-readable semantic code (ADR-0112): a `StandardErrorCode` member or
   * a code the SERVING side has registered in its ledger. A closed set on
   * purpose — an unregistered code fails parse, so the envelope conformance
   * suites catch invented codes instead of letting a new dialect grow (#3841).
   *
   * The ledger is federated (#4805): this schema unions the standard catalog
   * with `ERROR_CODE_LEDGER`, which registers FRAMEWORK packages only. A
   * downstream product repo maintains its own ledger and validates against
   * `StandardErrorCode ∪ <its own ledger>` — see {@link makeApiErrorSchema},
   * which is that union as a single parse.
   */
  code: ErrorCode.describe('Error code (e.g. VALIDATION_ERROR; StandardErrorCode ∪ the ledger the serving side registers — ERROR_CODE_LEDGER for framework packages)'),
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

/**
 * The error envelope with a CALLER-SUPPLIED code vocabulary:
 * `StandardErrorCode ∪ extraCodes` (#4805).
 *
 * For a downstream product repo — one whose packages are not registered in
 * `ERROR_CODE_LEDGER`, which by rule holds framework packages only — checking
 * a response body used to mean two separate assertions: `envelopeViolations`
 * for the shape, then a hand-written membership test for the code. This is
 * both in one parse, so a conformance suite gets ONE verdict with a Zod issue
 * path pointing at the offending field.
 *
 * ```ts
 * const CloudApiError = makeApiErrorSchema(CLOUD_ERROR_CODES);
 * CloudApiError.safeParse(body);   // shape + vocabulary, one verdict
 * ```
 *
 * The envelope shape is `ApiErrorSchema`'s, reused rather than restated, so a
 * field added to the base envelope reaches every downstream ledger with it.
 *
 * `ERROR_CODE_LEDGER`'s own entries are deliberately NOT included: they are
 * the framework packages' vocabulary, and a downstream service that also
 * relays framework-produced errors states so explicitly by passing them in —
 * `makeApiErrorSchema([...REGISTERED_ERROR_CODES, ...MY_CODES])`.
 *
 * `ApiErrorSchema` itself is unchanged: this is additive, and a code neither
 * standard nor supplied here still fails parse. Federating the ledger does not
 * open the vocabulary, it only moves where the other half of it is declared.
 */
export function makeApiErrorSchema<const TExtra extends readonly string[]>(extraCodes: TExtra) {
  const vocabulary: string[] = [...StandardErrorCode.options, ...extraCodes];
  return ApiErrorSchema.extend({
    code: (z.enum(vocabulary as [string, ...string[]]) as z.ZodType<StandardErrorCode | TExtra[number]>)
      .describe('Error code (StandardErrorCode ∪ the ledger this consumer registered)'),
  });
}

/**
 * The envelope SKELETON — deliberately not the whole response contract.
 *
 * It does not declare `data`: each response type adds its own via
 * `BaseResponseSchema.extend({ data: … })` (see `export.zod.ts`,
 * `automation-api.zod.ts`). It is also a plain `z.object`, so unknown keys are
 * stripped and pass rather than failing.
 *
 * Both are intentional, and both mean `safeParse` alone does NOT prove a body is
 * envelope-conformant. It catches the big one — a missing or non-boolean
 * `success`, which is what `ObjectStackClient.unwrapResponse` keys on and what
 * #3675 / #3689 / #3843 were about — but it accepts `{ success: true }` with no
 * payload at all, and it accepts a payload duplicated into a stray top-level key
 * (`{ success: true, data: link, link }`, the drift #4038 / #4049 removed).
 *
 * Use {@link envelopeViolations} when you mean "is this actually the declared
 * envelope"; use this schema when you mean "does it parse as one".
 */
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

/** The only keys a declared REST body may carry at its top level. */
const ENVELOPE_KEYS = new Set(['success', 'data', 'error', 'meta']);

/**
 * Every way `body` departs from the declared envelope, as readable reasons.
 * Empty array ⇒ conformant.
 *
 * This is the check {@link BaseResponseSchema} cannot express on its own, and it
 * exists because the gap was not theoretical: the `/share-links` dispatcher
 * domain shipped `{ success: true, data: link, link }` for as long as nobody
 * looked, and `safeParse` passed it the whole time (#4038). The conformance
 * suites each hand-wrote their own version of the missing assertions; this is
 * that check, once, so a new module inherits it instead of depending on whoever
 * writes the suite remembering to.
 *
 * The rules, and why each one:
 *
 *   • `success` must be a **boolean** — the flag `unwrapResponse` keys on. A body
 *     without it is handed to callers raw, which is how one SDK method returned
 *     two different shapes depending on which surface served the route (#3636).
 *   • a success body must carry `data` — `{ success: true }` alone tells a caller
 *     nothing and parses fine today.
 *   • a failure body must carry `error` with a string `code` and `message` — the
 *     nested form, not the pre-#3675 bare string.
 *   • no top-level key outside `success` / `data` / `error` / `meta` — this is the
 *     general form of the duplicate-payload drift. A second spelling of the
 *     payload beside `data` is how a producer keeps two dialects alive at once.
 *
 * Deliberately NOT checked: the shape of `data` itself. That is each route's own
 * payload schema, and conflating the two is what let `SettingsNamespacePayload`
 * describe a whole body before #3843 and only `data` after it.
 */
export function envelopeViolations(body: unknown): string[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return [`body is ${Array.isArray(body) ? 'an array' : String(body === null ? 'null' : typeof body)}, not an envelope object`];
  }
  const b = body as Record<string, unknown>;
  const out: string[] = [];

  if (typeof b.success !== 'boolean') {
    out.push(`success is ${b.success === undefined ? 'missing' : `\`${typeof b.success}\``}, must be a boolean`);
  } else if (b.success) {
    if (b.data === undefined) out.push('success body carries no `data`');
    if (b.error !== undefined) out.push('success body carries an `error`');
  } else {
    const err = b.error;
    if (err === undefined || typeof err !== 'object' || err === null) {
      out.push(`failure body's \`error\` is ${err === undefined ? 'missing' : `a ${typeof err}`}, must be an object`);
    } else {
      const e = err as Record<string, unknown>;
      if (typeof e.code !== 'string') out.push('error.code is missing or not a string');
      if (typeof e.message !== 'string') out.push('error.message is missing or not a string');
    }
  }

  for (const key of Object.keys(b)) {
    if (!ENVELOPE_KEYS.has(key)) {
      out.push(`stray top-level key \`${key}\` — the payload belongs under \`data\``);
    }
  }
  return out;
}

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

export type ApiError = z.input<typeof ApiErrorSchema>;
/** Post-parse shape of {@link ApiError} — defaults applied, transforms run (ADR-0122). */
export type ApiErrorParsed = z.infer<typeof ApiErrorSchema>;
export type BaseResponse = z.input<typeof BaseResponseSchema>;
/** Post-parse shape of {@link BaseResponse} — defaults applied, transforms run (ADR-0122). */
export type BaseResponseParsed = z.infer<typeof BaseResponseSchema>;
export type RecordData = z.input<typeof RecordDataSchema>;
export type CreateRequest = z.input<typeof CreateRequestSchema>;
export type UpdateRequest = z.input<typeof UpdateRequestSchema>;
export type BulkRequest = z.input<typeof BulkRequestSchema>;
/** Post-parse shape of {@link BulkRequest} — defaults applied, transforms run (ADR-0122). */
export type BulkRequestParsed = z.infer<typeof BulkRequestSchema>;
export type ExportRequest = z.input<typeof ExportRequestSchema>;
/** Post-parse shape of {@link ExportRequest} — defaults applied, transforms run (ADR-0122). */
export type ExportRequestParsed = z.infer<typeof ExportRequestSchema>;
export type SingleRecordResponse = z.input<typeof SingleRecordResponseSchema>;
/** Post-parse shape of {@link SingleRecordResponse} — defaults applied, transforms run (ADR-0122). */
export type SingleRecordResponseParsed = z.infer<typeof SingleRecordResponseSchema>;
export type ListRecordResponse = z.input<typeof ListRecordResponseSchema>;
/** Post-parse shape of {@link ListRecordResponse} — defaults applied, transforms run (ADR-0122). */
export type ListRecordResponseParsed = z.infer<typeof ListRecordResponseSchema>;
export type IdRequest = z.input<typeof IdRequestSchema>;
export type ModificationResult = z.input<typeof ModificationResultSchema>;
/** Post-parse shape of {@link ModificationResult} — defaults applied, transforms run (ADR-0122). */
export type ModificationResultParsed = z.infer<typeof ModificationResultSchema>;
export type BulkResponse = z.input<typeof BulkResponseSchema>;
/** Post-parse shape of {@link BulkResponse} — defaults applied, transforms run (ADR-0122). */
export type BulkResponseParsed = z.infer<typeof BulkResponseSchema>;
export type DeleteResponse = z.input<typeof DeleteResponseSchema>;
/** Post-parse shape of {@link DeleteResponse} — defaults applied, transforms run (ADR-0122). */
export type DeleteResponseParsed = z.infer<typeof DeleteResponseSchema>;
export type DataLoaderConfig = z.input<typeof DataLoaderConfigSchema>;
/** Post-parse shape of {@link DataLoaderConfig} — defaults applied, transforms run (ADR-0122). */
export type DataLoaderConfigParsed = z.infer<typeof DataLoaderConfigSchema>;
export type BatchLoadingStrategy = z.input<typeof BatchLoadingStrategySchema>;
/** Post-parse shape of {@link BatchLoadingStrategy} — defaults applied, transforms run (ADR-0122). */
export type BatchLoadingStrategyParsed = z.infer<typeof BatchLoadingStrategySchema>;
export type QueryOptimizationConfig = z.input<typeof QueryOptimizationConfigSchema>;
/** Post-parse shape of {@link QueryOptimizationConfig} — defaults applied, transforms run (ADR-0122). */
export type QueryOptimizationConfigParsed = z.infer<typeof QueryOptimizationConfigSchema>;
