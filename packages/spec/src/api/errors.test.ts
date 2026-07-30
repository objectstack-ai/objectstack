import { describe, it, expect } from 'vitest';
import {
  ErrorCategory,
  StandardErrorCode,
  RetryStrategy,
  FieldErrorSchema,
  EnhancedApiErrorSchema,
  ErrorResponseSchema,
  ErrorHttpStatusMap,
  HttpStatusErrorCodeMap,
  standardErrorCodeForHttpStatus,
} from './errors.zod';

describe('ErrorCategory', () => {
  it('should accept valid error categories', () => {
    expect(ErrorCategory.parse('validation')).toBe('validation');
    expect(ErrorCategory.parse('authentication')).toBe('authentication');
    expect(ErrorCategory.parse('authorization')).toBe('authorization');
    expect(ErrorCategory.parse('not_found')).toBe('not_found');
    expect(ErrorCategory.parse('conflict')).toBe('conflict');
    expect(ErrorCategory.parse('rate_limit')).toBe('rate_limit');
    expect(ErrorCategory.parse('server')).toBe('server');
  });
});

describe('StandardErrorCode', () => {
  it('should accept validation error codes', () => {
    expect(StandardErrorCode.parse('validation_error')).toBe('validation_error');
    expect(StandardErrorCode.parse('invalid_field')).toBe('invalid_field');
    expect(StandardErrorCode.parse('missing_required_field')).toBe('missing_required_field');
  });

  it('should accept authentication error codes', () => {
    expect(StandardErrorCode.parse('unauthenticated')).toBe('unauthenticated');
    expect(StandardErrorCode.parse('invalid_credentials')).toBe('invalid_credentials');
    expect(StandardErrorCode.parse('expired_token')).toBe('expired_token');
  });

  it('should accept authorization error codes', () => {
    expect(StandardErrorCode.parse('permission_denied')).toBe('permission_denied');
    expect(StandardErrorCode.parse('insufficient_privileges')).toBe('insufficient_privileges');
  });

  it('should accept batch operation error codes', () => {
    expect(StandardErrorCode.parse('batch_partial_failure')).toBe('batch_partial_failure');
    expect(StandardErrorCode.parse('transaction_failed')).toBe('transaction_failed');
  });
});

describe('RetryStrategy', () => {
  it('should accept valid retry strategies', () => {
    expect(RetryStrategy.parse('no_retry')).toBe('no_retry');
    expect(RetryStrategy.parse('retry_immediate')).toBe('retry_immediate');
    expect(RetryStrategy.parse('retry_backoff')).toBe('retry_backoff');
    expect(RetryStrategy.parse('retry_after')).toBe('retry_after');
  });
});

describe('FieldErrorSchema', () => {
  it('should accept basic field error', () => {
    const error = FieldErrorSchema.parse({
      field: 'email',
      code: 'invalid_format',
      message: 'Email format is invalid',
    });

    expect(error.field).toBe('email');
    expect(error.code).toBe('invalid_format');
  });

  it('should accept field error with value and constraint', () => {
    const error = FieldErrorSchema.parse({
      field: 'age',
      code: 'value_out_of_range',
      message: 'Age must be between 0 and 120',
      value: 150,
      constraint: { min: 0, max: 120 },
    });

    expect(error.value).toBe(150);
    expect(error.constraint).toEqual({ min: 0, max: 120 });
  });

  it('should support nested field paths', () => {
    const error = FieldErrorSchema.parse({
      field: 'user.profile.email',
      code: 'invalid_format',
      message: 'Invalid email',
    });

    expect(error.field).toBe('user.profile.email');
  });
});

describe('EnhancedApiErrorSchema', () => {
  it('should accept minimal error', () => {
    const error = EnhancedApiErrorSchema.parse({
      code: 'validation_error',
      message: 'Validation failed',
    });

    expect(error.code).toBe('validation_error');
    expect(error.message).toBe('Validation failed');
    expect(error.retryable).toBe(false);
  });

  it('should accept complete error with all fields', () => {
    const error = EnhancedApiErrorSchema.parse({
      code: 'validation_error',
      message: 'Validation failed for 2 fields',
      category: 'validation',
      httpStatus: 400,
      retryable: false,
      retryStrategy: 'no_retry',
      details: { count: 2 },
      fieldErrors: [
        {
          field: 'email',
          code: 'invalid_format',
          message: 'Invalid email format',
        },
      ],
      timestamp: '2026-01-29T12:00:00Z',
      requestId: 'req_123',
      traceId: 'trace_456',
      documentation: 'https://docs.objectstack.dev/errors/validation_error',
      helpText: 'Please check the field values',
    });

    expect(error.category).toBe('validation');
    expect(error.httpStatus).toBe(400);
    expect(error.fieldErrors).toHaveLength(1);
    expect(error.documentation).toContain('objectstack.dev');
  });

  it('should accept rate limit error with retry info', () => {
    const error = EnhancedApiErrorSchema.parse({
      code: 'rate_limit_exceeded',
      message: 'Rate limit exceeded',
      category: 'rate_limit',
      httpStatus: 429,
      retryable: true,
      retryStrategy: 'retry_after',
      retryAfter: 60,
      details: {
        limit: 1000,
        remaining: 0,
        resetAt: '2026-01-29T13:00:00Z',
      },
    });

    expect(error.retryable).toBe(true);
    expect(error.retryAfter).toBe(60);
    expect(error.details.limit).toBe(1000);
  });

  it('should accept authorization error', () => {
    const error = EnhancedApiErrorSchema.parse({
      code: 'permission_denied',
      message: 'You do not have permission to perform this action',
      category: 'authorization',
      httpStatus: 403,
      retryable: false,
    });

    expect(error.category).toBe('authorization');
    expect(error.httpStatus).toBe(403);
  });
});

describe('ErrorResponseSchema', () => {
  it('should accept error response', () => {
    const response = ErrorResponseSchema.parse({
      success: false,
      error: {
        code: 'resource_not_found',
        message: 'Resource not found',
      },
    });

    expect(response.success).toBe(false);
    expect(response.error.code).toBe('resource_not_found');
  });

  it('should accept error response with metadata', () => {
    const response = ErrorResponseSchema.parse({
      success: false,
      error: {
        code: 'internal_error',
        message: 'Internal server error',
      },
      meta: {
        timestamp: '2026-01-29T12:00:00Z',
        requestId: 'req_123',
      },
    });

    expect(response.meta?.requestId).toBe('req_123');
  });

  it('should only accept success=false', () => {
    expect(() =>
      ErrorResponseSchema.parse({
        success: true,
        error: {
          code: 'validation_error',
          message: 'Error',
        },
      })
    ).toThrow();
  });
});

describe('ErrorHttpStatusMap', () => {
  it('should map correct HTTP status for each category', () => {
    expect(ErrorHttpStatusMap['validation']).toBe(400);
    expect(ErrorHttpStatusMap['authentication']).toBe(401);
    expect(ErrorHttpStatusMap['authorization']).toBe(403);
    expect(ErrorHttpStatusMap['not_found']).toBe(404);
    expect(ErrorHttpStatusMap['conflict']).toBe(409);
    expect(ErrorHttpStatusMap['rate_limit']).toBe(429);
    expect(ErrorHttpStatusMap['server']).toBe(500);
    expect(ErrorHttpStatusMap['external']).toBe(502);
    expect(ErrorHttpStatusMap['maintenance']).toBe(503);
  });
});

describe('HttpStatusErrorCodeMap / standardErrorCodeForHttpStatus (#3842)', () => {
  it('names each status the runtime actually returns', () => {
    expect(standardErrorCodeForHttpStatus(400)).toBe('validation_error');
    expect(standardErrorCodeForHttpStatus(401)).toBe('unauthenticated');
    expect(standardErrorCodeForHttpStatus(403)).toBe('permission_denied');
    expect(standardErrorCodeForHttpStatus(404)).toBe('resource_not_found');
    expect(standardErrorCodeForHttpStatus(405)).toBe('method_not_allowed');
    expect(standardErrorCodeForHttpStatus(409)).toBe('resource_conflict');
    expect(standardErrorCodeForHttpStatus(428)).toBe('precondition_required');
    expect(standardErrorCodeForHttpStatus(500)).toBe('internal_error');
    expect(standardErrorCodeForHttpStatus(501)).toBe('not_implemented');
    expect(standardErrorCodeForHttpStatus(503)).toBe('service_unavailable');
  });

  it('is total — an unmapped status still yields a code', () => {
    // `ApiErrorSchema.code` is REQUIRED, so a producer that knows only the
    // status must always be able to fill it. Falling back per class rather than
    // to one catch-all keeps a 4xx from being reported as a server fault.
    expect(standardErrorCodeForHttpStatus(415)).toBe('validation_error');
    expect(standardErrorCodeForHttpStatus(507)).toBe('internal_error');
  });

  it('only ever yields catalogued codes', () => {
    // The whole claim of the map: a derived code is a StandardErrorCode, not an
    // invented string. Guards the map's values and both fallbacks in one pass.
    const derived = [
      ...Object.values(HttpStatusErrorCodeMap),
      standardErrorCodeForHttpStatus(415),
      standardErrorCodeForHttpStatus(507),
    ];
    for (const code of derived) {
      expect(StandardErrorCode.safeParse(code).success).toBe(true);
    }
  });

  it('mirrors ErrorHttpStatusMap where the two overlap', () => {
    // The pair is only auditable if it round-trips: every category's status maps
    // back to a code, and the obvious ones agree on meaning.
    for (const status of Object.values(ErrorHttpStatusMap)) {
      expect(StandardErrorCode.safeParse(standardErrorCodeForHttpStatus(status)).success).toBe(true);
    }
    expect(standardErrorCodeForHttpStatus(ErrorHttpStatusMap['authorization'])).toBe('permission_denied');
    expect(standardErrorCodeForHttpStatus(ErrorHttpStatusMap['not_found'])).toBe('resource_not_found');
  });
});
