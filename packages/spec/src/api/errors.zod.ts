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

export type ErrorCategory = z.infer<typeof ErrorCategory>;

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
  
  // Batch Operation Errors
  'BATCH_PARTIAL_FAILURE',      // Batch operation partially succeeded
  'BATCH_COMPLETE_FAILURE',     // Batch operation completely failed
  'TRANSACTION_FAILED',         // Transaction rolled back
]);

export type StandardErrorCode = z.infer<typeof StandardErrorCode>;

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

export type RetryStrategy = z.infer<typeof RetryStrategy>;

/**
 * Field Error Schema
 * Detailed error for a specific field
 */
export const FieldErrorSchema = lazySchema(() => z.object({
  field: z.string().describe('Field path (supports dot notation)'),
  // ⚠️ DELIBERATELY WIDE (ADR-0112 D6, #3977): field-level codes are a separate
  // vocabulary from top-level `error.code` and were never `StandardErrorCode` in
  // practice — the validators emit `required` / `max_length` / `invalid_email` /
  // …, import coercion adds its own, and one route leaks raw Zod issue codes.
  // Declaring the enum here was a lie the wire never honoured. #3977 owns the
  // real field-level catalog; when it lands, this tightens to that enum.
  code: z.string().describe('Error code for this field (field-level vocabulary — see #3977)'),
  message: z.string().describe('Human-readable error message'),
  value: z.unknown().optional().describe('The invalid value that was provided'),
  constraint: z.unknown().optional().describe('The constraint that was violated (e.g., max length)'),
}));

export type FieldError = z.infer<typeof FieldErrorSchema>;

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
 *     "fieldErrors": [
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
  category: ErrorCategory.optional().describe('Error category'),
  httpStatus: z.number().optional().describe('HTTP status code'),
  retryable: z.boolean().default(false).describe('Whether the request can be retried'),
  retryStrategy: RetryStrategy.optional().describe('Recommended retry strategy'),
  retryAfter: z.number().optional().describe('Seconds to wait before retrying'),
  details: z.unknown().optional().describe('Additional error context'),
  fieldErrors: z.array(FieldErrorSchema).optional().describe('Field-specific validation errors'),
  timestamp: z.string().datetime().optional().describe('When the error occurred'),
  requestId: z.string().optional().describe('Request ID for tracking'),
  traceId: z.string().optional().describe('Distributed trace ID'),
  documentation: z.string().url().optional().describe('URL to error documentation'),
  helpText: z.string().optional().describe('Suggested actions to resolve the error'),
}));

export type EnhancedApiError = z.infer<typeof EnhancedApiErrorSchema>;

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

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
