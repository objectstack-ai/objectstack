import { describe, it, expect } from 'vitest';
import {
  ErrorCategory,
  StandardErrorCode,
  RetryStrategy,
  FieldErrorSchema,
  FieldErrorCode,
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
    expect(StandardErrorCode.parse('VALIDATION_ERROR')).toBe('VALIDATION_ERROR');
    expect(StandardErrorCode.parse('INVALID_FIELD')).toBe('INVALID_FIELD');
    expect(StandardErrorCode.parse('MISSING_REQUIRED_FIELD')).toBe('MISSING_REQUIRED_FIELD');
  });

  it('should accept authentication error codes', () => {
    expect(StandardErrorCode.parse('UNAUTHENTICATED')).toBe('UNAUTHENTICATED');
    expect(StandardErrorCode.parse('INVALID_CREDENTIALS')).toBe('INVALID_CREDENTIALS');
    expect(StandardErrorCode.parse('EXPIRED_TOKEN')).toBe('EXPIRED_TOKEN');
  });

  it('should accept authorization error codes', () => {
    expect(StandardErrorCode.parse('PERMISSION_DENIED')).toBe('PERMISSION_DENIED');
    expect(StandardErrorCode.parse('INSUFFICIENT_PRIVILEGES')).toBe('INSUFFICIENT_PRIVILEGES');
  });

  it('refuses the retired batch-operation codes (ADR-0112 amendment 2026-08-18, #9266)', () => {
    // Retired under ADR-0049 enforce-or-remove: no producer ever emitted them;
    // the batch surface reports these conditions per row via the ledger-registered
    // ROLLED_BACK / NOT_ATTEMPTED codes instead. The wrong spelling must fail at
    // the vocabulary boundary rather than compile into a branch that never fires.
    expect(StandardErrorCode.safeParse('BATCH_PARTIAL_FAILURE').success).toBe(false);
    expect(StandardErrorCode.safeParse('BATCH_COMPLETE_FAILURE').success).toBe(false);
    expect(StandardErrorCode.safeParse('TRANSACTION_FAILED').success).toBe(false);
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
  // Field-level codes are the validators' own lowercase vocabulary, catalogued
  // by ADR-0114 — these literals mirror what record-validator actually emits.
  it('should accept basic field error', () => {
    const error = FieldErrorSchema.parse({
      field: 'email',
      code: 'invalid_email',
      message: 'Email format is invalid',
    });

    expect(error.field).toBe('email');
    expect(error.code).toBe('invalid_email');
  });

  it('should accept field error with value and constraint', () => {
    const error = FieldErrorSchema.parse({
      field: 'age',
      code: 'max_value',
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
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
    });

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Validation failed');
    expect(error.retryable).toBe(false);
  });

  it('should accept complete error with all fields', () => {
    const error = EnhancedApiErrorSchema.parse({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed for 2 fields',
      category: 'validation',
      httpStatus: 400,
      retryable: false,
      retryStrategy: 'no_retry',
      details: { count: 2 },
      // `fields` — the name every producer already emitted. `fieldErrors` is
      // tombstoned (ADR-0114 D4); the case below asserts that it now rejects.
      fields: [
        {
          field: 'email',
          code: 'invalid_email',
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
    expect(error.fields).toHaveLength(1);
    expect(error.documentation).toContain('objectstack.dev');
  });

  // [#9934] Same field, same semantics as `ApiErrorSchema.userMessage` — the
  // producer-side user-facing marking of the objectui#5210 ruling.
  it('carries a producer-marked `userMessage` verbatim, and stays absent when unmarked', () => {
    const marked = EnhancedApiErrorSchema.parse({
      code: 'PERMISSION_DENIED',
      message: 'close-period guard refused the write',
      userMessage: '该记录已进入结账期，暂不能修改。',
    });
    expect(marked.userMessage).toBe('该记录已进入结账期，暂不能修改。');
    expect(marked.message).toBe('close-period guard refused the write');

    const unmarked = EnhancedApiErrorSchema.parse({
      code: 'PERMISSION_DENIED',
      message: 'refused',
    });
    expect('userMessage' in unmarked).toBe(false);
  });

  it('should accept rate limit error with retry info', () => {
    const error = EnhancedApiErrorSchema.parse({
      code: 'RATE_LIMIT_EXCEEDED',
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
      code: 'PERMISSION_DENIED',
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
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      },
    });

    expect(response.success).toBe(false);
    expect(response.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('should accept error response with metadata', () => {
    const response = ErrorResponseSchema.parse({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
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
          code: 'VALIDATION_ERROR',
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
    expect(standardErrorCodeForHttpStatus(400)).toBe('VALIDATION_ERROR');
    expect(standardErrorCodeForHttpStatus(401)).toBe('UNAUTHENTICATED');
    expect(standardErrorCodeForHttpStatus(403)).toBe('PERMISSION_DENIED');
    expect(standardErrorCodeForHttpStatus(404)).toBe('RESOURCE_NOT_FOUND');
    expect(standardErrorCodeForHttpStatus(405)).toBe('METHOD_NOT_ALLOWED');
    expect(standardErrorCodeForHttpStatus(409)).toBe('RESOURCE_CONFLICT');
    expect(standardErrorCodeForHttpStatus(428)).toBe('PRECONDITION_REQUIRED');
    expect(standardErrorCodeForHttpStatus(500)).toBe('INTERNAL_ERROR');
    expect(standardErrorCodeForHttpStatus(501)).toBe('NOT_IMPLEMENTED');
    expect(standardErrorCodeForHttpStatus(503)).toBe('SERVICE_UNAVAILABLE');
  });

  it('is total — an unmapped status still yields a code', () => {
    // `ApiErrorSchema.code` is REQUIRED, so a producer that knows only the
    // status must always be able to fill it. Falling back per class rather than
    // to one catch-all keeps a 4xx from being reported as a server fault.
    expect(standardErrorCodeForHttpStatus(415)).toBe('VALIDATION_ERROR');
    expect(standardErrorCodeForHttpStatus(507)).toBe('INTERNAL_ERROR');
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
    expect(standardErrorCodeForHttpStatus(ErrorHttpStatusMap['authorization'])).toBe('PERMISSION_DENIED');
    expect(standardErrorCodeForHttpStatus(ErrorHttpStatusMap['not_found'])).toBe('RESOURCE_NOT_FOUND');
  });
});

/**
 * The field-level catalog (ADR-0114). What is load-bearing here is not that the
 * members parse — it is the two invariants that keep this vocabulary from drifting
 * back into the top-level one, and the correspondence that justifies its casing.
 */
describe('FieldErrorCode', () => {
  const members = FieldErrorCode.options;

  it('is lowercase snake_case throughout — the opposite of StandardErrorCode', () => {
    // ADR-0114 D1: these name a violated CONSTRAINT, and constraints are declared
    // in the metadata's own snake_case. A SCREAMING member here means someone
    // reached for the top-level catalog's convention by reflex.
    for (const m of members) {
      expect(m, `${m} must be lowercase snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('names the constraint property it reports on', () => {
    // The whole argument for D1's casing: the code IS the schema property name.
    // If these ever diverge, the field vocabulary has lost its reason to be
    // lowercase and the decision should be revisited rather than patched.
    for (const constraint of ['required', 'max_length', 'min_length', 'max_value', 'min_value'] as const) {
      expect(members).toContain(constraint);
    }
  });

  it('overlaps the top-level catalog only where the overlap is declared', () => {
    // Two vocabularies on two structural levels (ADR-0112 D6). A name in both is
    // not automatically wrong — the top-level code says why the REQUEST failed,
    // the field-level one says which value and which constraint — but it must be
    // deliberate. An unlisted overlap means someone added a field member by
    // copying a top-level one, which is the reflex the casing test above guards
    // from the other side.
    //
    // `invalid_format` is the only case, and it exists because the top-level
    // catalog still carries field-shaped members it inherited (`INVALID_FORMAT`,
    // `VALUE_TOO_LONG`, `MISSING_REQUIRED_FIELD`, …) — see ADR-0114's note on
    // them. Their field-level counterparts mostly have better names here
    // (`max_length` over `VALUE_TOO_LONG`); this one happens to coincide.
    const DECLARED_OVERLAPS = new Set(['invalid_format']);
    const top = new Set<string>(StandardErrorCode.options.map((c) => c.toLowerCase()));
    for (const m of members) {
      if (DECLARED_OVERLAPS.has(m)) continue;
      expect(top.has(m), `${m} collides with a StandardErrorCode member`).toBe(false);
    }
  });

  it('rejects a code from the vocabulary it replaced', () => {
    // The pre-ADR-0114 leak: Zod's own issue codes reaching the wire.
    for (const zodCode of ['too_small', 'too_big', 'unrecognized_keys', 'invalid_union']) {
      expect(() => FieldErrorCode.parse(zodCode)).toThrow();
    }
    // …and a top-level code, which is what the schema used to declare.
    expect(() => FieldErrorCode.parse('VALIDATION_ERROR')).toThrow();
  });
});

describe('EnhancedApiErrorSchema.fieldErrors retirement (ADR-0114 D4)', () => {
  it('rejects the old name instead of silently dropping the array', () => {
    // The whole reason for a tombstone rather than a delete: this schema is not
    // `.strict()`, so a plain removal would let the write parse clean and lose
    // the per-field detail — a validation response that mentions no field.
    const attempt = () => EnhancedApiErrorSchema.parse({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      fieldErrors: [{ field: 'email', code: 'invalid_email', message: 'nope' }],
    });
    expect(attempt).toThrow();
    // …and the rejection carries the fix, not just "invalid".
    try {
      attempt();
    } catch (e) {
      expect(String(e)).toContain('fields');
    }
  });

  it('accepts the new name', () => {
    const parsed = EnhancedApiErrorSchema.parse({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      fields: [{ field: 'email', code: 'invalid_email', message: 'nope' }],
    });
    expect(parsed.fields).toHaveLength(1);
  });
});
