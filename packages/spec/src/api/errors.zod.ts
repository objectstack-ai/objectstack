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
  'validation_error',           // Generic validation failure
  'invalid_field',              // Invalid field value
  'missing_required_field',     // Required field missing
  'invalid_format',             // Field format invalid (e.g., email, date)
  'value_too_long',             // Field value exceeds max length
  'value_too_short',            // Field value below min length
  'value_out_of_range',         // Numeric value out of range
  'invalid_reference',          // Invalid foreign key reference
  'duplicate_value',            // Unique constraint violation
  'invalid_query',              // Malformed query syntax
  'invalid_filter',             // Invalid filter expression
  'invalid_sort',               // Invalid sort specification
  'max_records_exceeded',       // Query would return too many records
  
  // Authentication Errors (401)
  'unauthenticated',            // No valid authentication provided
  'invalid_credentials',        // Wrong username/password
  'expired_token',              // Authentication token expired
  'invalid_token',              // Authentication token invalid
  'session_expired',            // User session expired
  'mfa_required',               // Multi-factor authentication required
  'email_not_verified',         // Email verification required
  
  // Authorization Errors (403)
  'permission_denied',          // User lacks required permission
  'insufficient_privileges',    // Operation requires higher privileges
  'field_not_accessible',       // Field-level security restriction
  'record_not_accessible',      // Sharing rule restriction
  'license_required',           // Feature requires license
  'ip_restricted',              // IP address not allowed
  'time_restricted',            // Access outside allowed time window
  
  // Not Found Errors (404)
  'resource_not_found',         // Generic resource not found
  'object_not_found',           // Object/table not found
  'record_not_found',           // Record with given ID not found
  'field_not_found',            // Field not found in object
  'endpoint_not_found',         // API endpoint not found
  
  // Conflict Errors (409)
  'resource_conflict',          // Generic resource conflict
  'concurrent_modification',    // Record modified by another user
  'delete_restricted',          // Cannot delete due to dependencies
  'duplicate_record',           // Record already exists
  'lock_conflict',              // Record is locked by another process
  
  // Request Errors (405/428)
  'method_not_allowed',         // Route exists but the HTTP method is not supported
  'precondition_required',      // Request is missing a required precondition (e.g. environment scope)

  // Rate Limiting (429)
  'rate_limit_exceeded',        // Too many requests
  'quota_exceeded',             // API quota exceeded
  'concurrent_limit_exceeded',  // Too many concurrent requests

  // Server Errors (500)
  'internal_error',             // Generic internal server error
  'database_error',             // Database operation failed
  'timeout',                    // Operation timed out
  'service_unavailable',        // Service temporarily unavailable
  'not_implemented',            // Feature not yet implemented
  
  // External Service Errors (502/503)
  'external_service_error',     // External API call failed
  'integration_error',          // Integration service error
  'webhook_delivery_failed',    // Webhook delivery failed
  
  // Batch Operation Errors
  'batch_partial_failure',      // Batch operation partially succeeded
  'batch_complete_failure',     // Batch operation completely failed
  'transaction_failed',         // Transaction rolled back
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
 * `permission_denied`.
 *
 * Vocabulary note (#3841): the values are `StandardErrorCode`'s lowercase
 * snake_case because that is the only error vocabulary the spec declares and
 * `content/docs/api/error-catalog.mdx` documents. Much of the wire is
 * SCREAMING_SNAKE and #3841 owns reconciling the two; this map is deliberately
 * the ONE place a derived code is spelled, so that decision is a one-file sweep
 * rather than a hunt through every producer.
 */
export const HttpStatusErrorCodeMap: Record<number, StandardErrorCode> = {
  400: 'validation_error',
  401: 'unauthenticated',
  403: 'permission_denied',
  404: 'resource_not_found',
  405: 'method_not_allowed',
  409: 'resource_conflict',
  428: 'precondition_required',
  429: 'rate_limit_exceeded',
  500: 'internal_error',
  501: 'not_implemented',
  502: 'external_service_error',
  503: 'service_unavailable',
  504: 'timeout',
};

/**
 * The {@link StandardErrorCode} for an HTTP status, falling back to the
 * client-error / server-error bucket for a status {@link HttpStatusErrorCodeMap}
 * does not name (e.g. `415` → `validation_error`, `507` → `internal_error`).
 * Total by construction: a producer can always fill a required `code`.
 */
export function standardErrorCodeForHttpStatus(status: number): StandardErrorCode {
  return HttpStatusErrorCodeMap[status]
    ?? (status >= 500 ? 'internal_error' : 'validation_error');
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
  code: StandardErrorCode.describe('Error code for this field'),
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
 *   "code": "validation_error",
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
 *         "code": "value_out_of_range",
 *         "message": "Age must be between 0 and 120",
 *         "value": 150,
 *         "constraint": { "min": 0, "max": 120 }
 *       }
 *     ]
 *   },
 *   "timestamp": "2026-01-29T12:00:00Z",
 *   "requestId": "req_123456",
 *   "documentation": "https://docs.objectstack.dev/errors/validation_error"
 * }
 * 
 * @example Rate Limit Error
 * {
 *   "code": "rate_limit_exceeded",
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
 *     "code": "permission_denied",
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
