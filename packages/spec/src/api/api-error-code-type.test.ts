// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19920] `ApiError.code` is the code vocabulary `ApiErrorSchema` parses against, not `unknown`.
 *
 * `ErrorCode` was cast to `z.ZodType<StandardErrorCode | RegisteredErrorCode>`. `z.ZodType` takes
 * two type parameters, `<Output, Input>`, and `Input` defaults to `unknown`, so the INPUT type of
 * `ApiErrorSchema` typed `code` as `unknown`: `{ code: 42, message: 'x' }` compiled as an
 * `ApiError`, and as the `error` of every response envelope built on `BaseResponseSchema`, while
 * the schema refuses it at `code`. `makeApiErrorSchema` repeated the one-parameter cast for a
 * caller-supplied vocabulary. Both casts now name both parameters.
 *
 * Two halves, judged by two programs (the `view-overlay-viewkind-type.test.ts` shape):
 *
 * - The TYPE half is judged by `tsc -p tsconfig.test.json` (the package's `typecheck` script, via
 *   `check:test-typecheck`), not by vitest. Each `@ts-expect-error` below asserts that its line
 *   does NOT compile. While `code` was `unknown` every one of them compiled, so each directive was
 *   unused: TS2578 in a file with no `test-typecheck-debt.json` entry, which reds the gate.
 * - The RUNTIME half ties the type to the door: each body the type now refuses is refused by the
 *   schema at `code`, and each body it admits parses.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  ApiErrorSchema,
  BaseResponseSchema,
  makeApiErrorSchema,
  type ApiError,
  type ApiErrorParsed,
  type BaseResponse,
} from './contract.zod';
import { ErrorCode } from './error-code-ledger.zod';

type IsUnknown<T> = unknown extends T ? true : false;

// ── The input type of `code` is the vocabulary ────────────────────────────────────────────────

const codeIsTyped: [
  IsUnknown<z.input<typeof ErrorCode>>, IsUnknown<ApiError['code']>, IsUnknown<ApiErrorParsed['code']>,
] = [false, false, false];
const standardCode: ApiError = { code: 'VALIDATION_ERROR', message: 'x' };
const registeredCode: ApiError['code'] = 'INVALID_ARTIFACT_PACKAGES';
// @ts-expect-error -- `code` is a vocabulary member, not a number.
const numericCode: ApiError = { code: 42, message: 'x' };
// @ts-expect-error -- nor a string outside the vocabulary.
const inventedCode: ApiError = { code: 'NOT_A_REGISTERED_CODE', message: 'x' };
// @ts-expect-error -- the same `code` reaches every envelope built on `BaseResponseSchema`.
const envelopeNumericCode: BaseResponse = { success: false, error: { code: 42, message: 'x' } };
void [codeIsTyped, standardCode, registeredCode, numericCode, inventedCode, envelopeNumericCode];

// ── `makeApiErrorSchema`: standard catalogue ∪ the caller's codes ─────────────────────────────

const AcmeApiErrorSchema = makeApiErrorSchema(['ACME_QUOTA_EXCEEDED'] as const);
type AcmeApiError = z.input<typeof AcmeApiErrorSchema>;
const acmeCodeIsTyped: IsUnknown<AcmeApiError['code']> = false;
const acmeSupplied: AcmeApiError = { code: 'ACME_QUOTA_EXCEEDED', message: 'x' };
const acmeStandard: AcmeApiError = { code: 'RECORD_NOT_FOUND', message: 'x' };
// @ts-expect-error -- a code neither standard nor supplied.
const acmeUnsupplied: AcmeApiError = { code: 'ACME_NOT_SUPPLIED', message: 'x' };
// @ts-expect-error -- nor a number.
const acmeNumeric: AcmeApiError = { code: 42, message: 'x' };
void [acmeCodeIsTyped, acmeSupplied, acmeStandard, acmeUnsupplied, acmeNumeric];

/** The one issue a refused body carries, reduced to what the envelope contract names. */
function refusalAt(result: z.ZodSafeParseResult<unknown>): Array<{ code: string; path: PropertyKey[] }> {
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => ({ code: issue.code, path: issue.path }));
}

describe('ApiError.code is typed as the vocabulary its schema parses against', () => {
  it('every body the type refuses is refused by the schema at `code`', () => {
    expect(refusalAt(ApiErrorSchema.safeParse({ code: 42, message: 'x' }))).toEqual([
      { code: 'invalid_value', path: ['code'] },
    ]);
    expect(refusalAt(ApiErrorSchema.safeParse({ code: 'NOT_A_REGISTERED_CODE', message: 'x' }))).toEqual([
      { code: 'invalid_value', path: ['code'] },
    ]);
    expect(
      refusalAt(BaseResponseSchema.safeParse({ success: false, error: { code: 42, message: 'x' } })),
    ).toEqual([{ code: 'invalid_value', path: ['error', 'code'] }]);
    expect(refusalAt(AcmeApiErrorSchema.safeParse({ code: 'ACME_NOT_SUPPLIED', message: 'x' }))).toEqual([
      { code: 'invalid_value', path: ['code'] },
    ]);
  });

  it('every body the type admits parses', () => {
    expect(ApiErrorSchema.safeParse(standardCode).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ code: registeredCode, message: 'x' }).success).toBe(true);
    expect(AcmeApiErrorSchema.safeParse(acmeSupplied).success).toBe(true);
    expect(AcmeApiErrorSchema.safeParse(acmeStandard).success).toBe(true);
  });
});
