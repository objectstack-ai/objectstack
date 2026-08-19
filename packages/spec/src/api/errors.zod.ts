// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Standardized Error Codes Protocol
 * 
 * Implements P0 requirement for ObjectStack kernel.
 * Provides consistent, machine-readable error codes across the platform.
 * 
 * Features:
 * - Categorized error codes (validation, authentication, authorization, etc.)
 * - HTTP status code mapping
 * - Localization support
 * - Retry guidance
 * 
 * Industry alignment: Google Cloud Errors, AWS Error Codes, Stripe API Errors
 */

// ==========================================
// Error Code Categories
// ==========================================

/**
 * Error Category Enum
 * High-level categorization of errors
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
export const ErrorCategory = z.enum([
  'validation',      // Input validation errors (400)
  'authentication',  // Authentication failures (401)
  'authorization',   // Permission denied errors (403)
  'not_found',       // Resource not found (404)
  'conflict',        // Resource conflict (409)
  'rate_limit',      // Rate limiting (429)
  'server',          // Internal server errors (500)
  'external',        // External service errors (502/503)
  'maintenance',     // Planned maintenance (503)
]);

export type ErrorCategory = z.input<typeof ErrorCategory>;

// ==========================================
// Standard Error Codes
// ==========================================

/**
 * Standard Error Code Enum
 * Machine-readable error codes for common error scenarios
 */
export const StandardErrorCode = z.enum([
  // Validation Errors (400)
  'VALIDATION_ERROR',           // Generic validation failure
  'INVALID_FIELD',              // Invalid field value
  'MISSING_REQUIRED_FIELD',     // Required field missing
  'INVALID_FORMAT',             // Field format invalid (e.g., email, date)
  'VALUE_TOO_LONG',             // Field value exceeds max length
  'VALUE_TOO_SHORT',            // Field value below min length
  'VALUE_OUT_OF_RANGE',         // Numeric value out of range
  'INVALID_REFERENCE',          // Invalid foreign key reference
  'DUPLICATE_VALUE',            // Unique constraint violation
  'INVALID_QUERY',              // Malformed query syntax
  'INVALID_FILTER',             // Invalid filter expression
  'INVALID_SORT',               // Invalid sort specification
  'MAX_RECORDS_EXCEEDED',       // Query would return too many records
  
  // Authentication Errors (401)
  'UNAUTHENTICATED',            // No valid authentication provided
  'INVALID_CREDENTIALS',        // Wrong username/password
  'EXPIRED_TOKEN',              // Authentication token expired
  'INVALID_TOKEN',              // Authentication token invalid
  'SESSION_EXPIRED',            // User session expired
  'MFA_REQUIRED',               // Multi-factor authentication required
  'EMAIL_NOT_VERIFIED',         // Email verification required
  
  // Authorization Errors (403)
  'PERMISSION_DENIED',          // User lacks required permission
  'INSUFFICIENT_PRIVILEGES',    // Operation requires higher privileges
  'FIELD_NOT_ACCESSIBLE',       // Field-level security restriction
  'RECORD_NOT_ACCESSIBLE',      // Sharing rule restriction
  'LICENSE_REQUIRED',           // Feature requires license
  'IP_RESTRICTED',              // IP address not allowed
  'TIME_RESTRICTED',            // Access outside allowed time window
  
  // Not Found Errors (404)
  'RESOURCE_NOT_FOUND',         // Generic resource not found
  'OBJECT_NOT_FOUND',           // Object/table not found
  'RECORD_NOT_FOUND',           // Record with given ID not found
  'FIELD_NOT_FOUND',            // Field not found in object
  'ENDPOINT_NOT_FOUND',         // API endpoint not found
  
  // Conflict Errors (409)
  'RESOURCE_CONFLICT',          // Generic resource conflict
  'CONCURRENT_MODIFICATION',    // Record modified by another user
  'DELETE_RESTRICTED',          // Cannot delete due to dependencies
  'DUPLICATE_RECORD',           // Record already exists
  'LOCK_CONFLICT',              // Record is locked by another process
  
  // Request Errors (405/428)
  'METHOD_NOT_ALLOWED',         // Route exists but the HTTP method is not supported
  'PRECONDITION_REQUIRED',      // Request is missing a required precondition (e.g. environment scope)

  // Rate Limiting (429)
  'RATE_LIMIT_EXCEEDED',        // Too many requests
  'QUOTA_EXCEEDED',             // API quota exceeded
  'CONCURRENT_LIMIT_EXCEEDED',  // Too many concurrent requests

  // Server Errors (500)
  'INTERNAL_ERROR',             // Generic internal server error
  'DATABASE_ERROR',             // Database operation failed
  'TIMEOUT',                    // Operation timed out
  'SERVICE_UNAVAILABLE',        // Service temporarily unavailable
  'NOT_IMPLEMENTED',            // Feature not yet implemented
  
  // External Service Errors (502/503)
  'EXTERNAL_SERVICE_ERROR',     // External API call failed
  'INTEGRATION_ERROR',          // Integration service error
  'WEBHOOK_DELIVERY_FAILED',    // Webhook delivery failed
]);
// Retired (ADR-0112 amendment 2026-08-18, ADR-0049 enforce-or-remove, #9266):
// BATCH_PARTIAL_FAILURE / BATCH_COMPLETE_FAILURE / TRANSACTION_FAILED — never
// emitted by any producer in the repo's history; the batch surface reports these
// conditions per row via the ledger-registered ROLLED_BACK / NOT_ATTEMPTED at
// HTTP 200 instead of an envelope-level code.

export type StandardErrorCode = z.input<typeof StandardErrorCode>;

// ==========================================
// Enhanced Error Schema
// ==========================================

/**
 * HTTP Status Code mapping for error categories
 */
export const ErrorHttpStatusMap: Record<string, number> = {
  validation: 400,
  authentication: 401,
  authorization: 403,
  not_found: 404,
  conflict: 409,
  rate_limit: 429,
  server: 500,
  external: 502,
  maintenance: 503,
};

/**
 * The mirror image of {@link ErrorHttpStatusMap}: the {@link StandardErrorCode}
 * that names an HTTP status when the producer has no more specific code of its
 * own. Declared next to the enum it draws from so the pair stays auditable —
 * every value here MUST be a member of `StandardErrorCode`, which is what makes
 * a derived code a catalogued one rather than an invented string.
 *
 * Why a *derived* code exists at all (#3842): `ApiErrorSchema.code` is a
 * REQUIRED semantic string, so a producer that knows only "this failed with
 * 503" still has to fill it. Before this map the runtime dispatcher filled it
 * with the status *number* and parked any real code in `details`, which put a
 * number in the field callers branch on and gave the same condition three
 * different spellings (`details.code`, `details.type`, `error.type`).
 *
 * A specific code always wins — this is the floor, not the ceiling. `403 +
 * PASSWORD_EXPIRED` stays `PASSWORD_EXPIRED`; only a bare `403` becomes
 * `PERMISSION_DENIED`.
 *
 * Vocabulary note (ADR-0112, settles #3841): error codes are SCREAMING_SNAKE —
 * machine constants, not data values (recorded Prime Directive #3 deviation).
 * This map was deliberately the ONE place a derived code is spelled, which is
 * why that decision landed here as a one-file sweep rather than a hunt through
 * every producer.
 */
export const HttpStatusErrorCodeMap: Record<number, StandardErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'RESOURCE_NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'RESOURCE_CONFLICT',
  428: 'PRECONDITION_REQUIRED',
  429: 'RATE_LIMIT_EXCEEDED',
  500: 'INTERNAL_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'EXTERNAL_SERVICE_ERROR',
  503: 'SERVICE_UNAVAILABLE',
  504: 'TIMEOUT',
};

/**
 * The {@link StandardErrorCode} for an HTTP status, falling back to the
 * client-error / server-error bucket for a status {@link HttpStatusErrorCodeMap}
 * does not name (e.g. `415` → `VALIDATION_ERROR`, `507` → `INTERNAL_ERROR`).
 * Total by construction: a producer can always fill a required `code`.
 */
export function standardErrorCodeForHttpStatus(status: number): StandardErrorCode {
  return HttpStatusErrorCodeMap[status]
    ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR');
}

/**
 * Retry Strategy Enum
 * Guidance on whether to retry failed requests
 */
export const RetryStrategy = z.enum([
  'no_retry',          // Do not retry (permanent failure)
  'retry_immediate',   // Retry immediately
  'retry_backoff',     // Retry with exponential backoff
  'retry_after',       // Retry after specified delay
]);

export type RetryStrategy = z.input<typeof RetryStrategy>;

/**
 * Which constraint a single value violated (ADR-0114 D2).
 *
 * A **closed** catalog, and deliberately lowercase `snake_case` where the
 * top-level `StandardErrorCode` is SCREAMING (ADR-0114 D1): a top-level code
 * names a condition the *request* hit, while these name the *constraint* — and
 * constraints are already declared in the metadata's own vocabulary, so the code
 * and the schema property are the same word on purpose:
 *
 *     { required: true }      → code 'required'
 *     { max_length: 50 }      → code 'max_length'
 *     { min_value: 0 }        → code 'min_value'
 *
 * Closed with no ledger tier, unlike the top-level catalog: a constraint *kind*
 * is a property of the type system, so a service does not get to invent one — it
 * adds a member here. That friction is the point.
 *
 * The `field` key of the surrounding record says what was addressed (a column, a
 * dotted path, an action param), so there is no per-surface variant of a code:
 * an unknown action param and an unknown column are both `unknown_field`.
 */
export const FieldErrorCode = z.enum([
  // presence and shape
  'required',                   // no value where one is mandatory
  'invalid_type',               // a value of the wrong primitive type
  'invalid_shape',              // an object/array whose structure does not fit
  'unknown_field',              // a key the target does not declare
  // per-type parse failures
  'invalid_boolean',
  'invalid_number',
  'invalid_date',
  'invalid_time',
  'invalid_email',
  'invalid_url',
  'invalid_phone',
  'invalid_json',
  'invalid_format',             // a declared pattern/format the value does not match
  // bounded ranges — the property names they mirror
  'min_length',
  'max_length',
  'min_value',
  'max_value',
  // more decimal places than the field's declared `scale` allows (#7501) —
  // `scale` is an upper bound on the fractional-digit COUNT, so it joins the
  // max_* family the way `max_length` bounds the character count.
  'max_scale',
  'min_items',
  'max_items',
  // closed sets and references
  'invalid_option',             // not a member of the field's declared options
  'invalid_value',              // rejected for a reason no other member names
  'reference_not_found',        // a lookup target that does not exist
  'reference_ambiguous',        // a lookup that matched more than one record
  // declarative rules layered above the field's own type
  'rule_violation',             // a validation rule said no
  'json_schema_violation',      // a declared JSON Schema said no
  'invalid_initial_state',      // state machine: not a legal starting state
  'invalid_transition',         // state machine: not a legal move from here
]);

export type FieldErrorCode = z.input<typeof FieldErrorCode>;

/**
 * Field Error Schema
 * Detailed error for a specific field
 */
export const FieldErrorSchema = lazySchema(() => z.object({
  field: z.string().describe('Field path (supports dot notation)'),
  /**
   * Which constraint the value violated — a `FieldErrorCode` (ADR-0114 D2).
   *
   * Closed on purpose. This was `z.string()` between ADR-0112 (which widened it,
   * because declaring `StandardErrorCode` here was a lie the wire never
   * honoured) and ADR-0114 (which gave the field level its own catalog). One
   * route used to leak raw Zod issue codes through this position; they are now
   * mapped at the boundary (`zodIssuesToFields`, ADR-0114 D3).
   */
  code: FieldErrorCode.describe('Which constraint the value violated (field-level catalog, ADR-0114)'),
  message: z.string().describe('Human-readable error message, rendered in the caller’s locale'),
  /**
   * The field's DISPLAY name in the caller's locale — what `message` names it by
   * (#3957).
   *
   * Separate from `field` because they answer different questions: a form needs
   * the API name to focus the right input, a human needs the label to read the
   * sentence. Collapsing them is how `penalty_amount must be ≥ 0` reached end
   * users for a field declared `label: '处罚金额'`.
   */
  label: z.string().optional().describe('Field display label in the caller’s locale'),
  value: z.unknown().optional().describe('The invalid value that was provided'),
  /**
   * The violated constraint's discrete values, so a client can format its own
   * text instead of parsing `message` (#3957) — `{ min: 0 }`,
   * `{ maxLength: 512, actual: 3000 }`, `{ allowed: 'draft, sent' }`. The keys
   * mirror the metadata properties they come from, and are what the message
   * templates interpolate.
   */
  constraint: z.record(z.string(), z.unknown()).optional()
    .describe('The constraint that was violated, as discrete values (e.g. { maxLength: 512, actual: 3000 })'),
}));

export type FieldError = z.input<typeof FieldErrorSchema>;

/**
 * Enhanced API Error Schema
 * Standardized error response with detailed metadata
 * 
 * @example Validation Error
 * {
 *   "code": "VALIDATION_ERROR",
 *   "message": "Validation failed for 2 fields",
 *   "category": "validation",
 *   "httpStatus": 400,
 *   "retryable": false,
 *   "retryStrategy": "no_retry",
 *   "details": {
 *     "fields": [
 *       {
 *         "field": "email",
 *         "code": "invalid_format",
 *         "message": "Email format is invalid",
 *         "value": "not-an-email"
 *       },
 *       {
 *         "field": "age",
 *         "code": "max_value",
 *         "message": "Age must be between 0 and 120",
 *         "value": 150,
 *         "constraint": { "min": 0, "max": 120 }
 *       }
 *     ]
 *   },
 *   "timestamp": "2026-01-29T12:00:00Z",
 *   "requestId": "req_123456",
 *   "documentation": "https://docs.objectstack.dev/errors/VALIDATION_ERROR"
 * }
 * 
 * @example Rate Limit Error
 * {
 *   "code": "RATE_LIMIT_EXCEEDED",
 *   "message": "Rate limit exceeded. Try again in 60 seconds.",
 *   "category": "rate_limit",
 *   "httpStatus": 429,
 *   "retryable": true,
 *   "retryStrategy": "retry_after",
 *   "retryAfter": 60,
 *   "details": {
 *     "limit": 1000,
 *     "remaining": 0,
 *     "resetAt": "2026-01-29T13:00:00Z"
 *   }
 * }
 */
export const EnhancedApiErrorSchema = lazySchema(() => z.object({
  code: StandardErrorCode.describe('Machine-readable error code'),
  message: z.string().describe('Human-readable error message'),
  /**
   * The producer's user-facing refusal text, verbatim — the same field, with
   * the same semantics, as `ApiErrorSchema.userMessage` (`contract.zod.ts`,
   * which carries the full rationale): the producer-side opt-in that marks a
   * refusal message as addressed to the END USER (#9934, maintainer ruling
   * 2026-08-19 on objectui#5210). Present exactly when the producer opted in
   * at throw time; absent means consumers keep their generic substitution
   * (#3821 preserved by construction). Status-agnostic; never replaces
   * `message`.
   */
  userMessage: z.string().optional().describe(
    'Producer-marked user-facing refusal text, verbatim (#9934) — see ApiErrorSchema.userMessage. '
    + 'Present only when the producer opted in at throw time; unmarked errors keep the generic '
    + 'consumer substitution (#3821).',
  ),
  category: ErrorCategory.optional().describe('Error category'),
  httpStatus: z.number().optional().describe('HTTP status code'),
  retryable: z.boolean().default(false).describe('Whether the request can be retried'),
  retryStrategy: RetryStrategy.optional().describe('Recommended retry strategy'),
  retryAfter: z.number().optional().describe('Seconds to wait before retrying'),
  details: z.unknown().optional().describe('Additional error context'),
  /**
   * One entry per offending value.
   *
   * Named `fields` because that is what the wire has always carried — the
   * validators, import coercion, `validation-failure.ts`, `@objectstack/client`
   * and the console's field-error extractor all say `fields`. This property was
   * declared as `fieldErrors` and emitted by nothing, which is ADR-0078's
   * silently-inert declaration sitting on the error envelope; the rename points
   * the declaration at reality rather than the reverse (ADR-0114 D4).
   */
  fields: z.array(FieldErrorSchema).optional().describe('One entry per offending value'),
  /**
   * Tombstoned, not deleted (ADR-0104): `EnhancedApiErrorSchema` is not
   * `.strict()`, so a plain deletion would let anyone still writing `fieldErrors`
   * parse clean and lose the array — the silent-strip shape ADR-0114 D4 refused
   * to ship. `retiredKey()` turns that into a rejection carrying the fix.
   */
  fieldErrors: retiredKey(
    '`EnhancedApiError.fieldErrors` was renamed to `fields` in @objectstack/spec 17 ' +
    '(ADR-0114 D4, #3977) — the array is unchanged, only the property name. Every ' +
    'producer already emitted `fields`; `fieldErrors` was declared and never emitted, ' +
    'so a reader keying on it was reading a field no server sent.',
  ),
  timestamp: z.string().datetime().optional().describe('When the error occurred'),
  requestId: z.string().optional().describe('Request ID for tracking'),
  traceId: z.string().optional().describe('Distributed trace ID'),
  documentation: z.string().url().optional().describe('URL to error documentation'),
  helpText: z.string().optional().describe('Suggested actions to resolve the error'),
}));

export type EnhancedApiError = z.input<typeof EnhancedApiErrorSchema>;
/** Post-parse shape of {@link EnhancedApiError} — defaults applied, transforms run (ADR-0122). */
export type EnhancedApiErrorParsed = z.infer<typeof EnhancedApiErrorSchema>;

// ==========================================
// Error Response Schema
// ==========================================

/**
 * Standardized Error Response Schema
 * Complete error response envelope
 * 
 * @example
 * {
 *   "success": false,
 *   "error": {
 *     "code": "PERMISSION_DENIED",
 *     "message": "You do not have permission to update this record",
 *     "category": "authorization",
 *     "httpStatus": 403,
 *     "retryable": false
 *   }
 * }
 */
export const ErrorResponseSchema = lazySchema(() => z.object({
  success: z.literal(false).describe('Always false for error responses'),
  error: EnhancedApiErrorSchema.describe('Error details'),
  meta: z.object({
    timestamp: z.string().datetime().optional(),
    requestId: z.string().optional(),
    traceId: z.string().optional(),
  }).optional().describe('Response metadata'),
}));

export type ErrorResponse = z.input<typeof ErrorResponseSchema>;
/** Post-parse shape of {@link ErrorResponse} — defaults applied, transforms run (ADR-0122). */
export type ErrorResponseParsed = z.infer<typeof ErrorResponseSchema>;
