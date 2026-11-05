/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30334 — `isExternalWriteRefusal` reads the ADR-0015 write gate's
 * verdict (`403 EXTERNAL_WRITE_FORBIDDEN`) off the code alone, from the same
 * pair `isPermissionError` reads, so a caller can say "read-only" before the
 * permission predicate (which claims every 403) flattens it.
 */

import { describe, it, expect } from 'vitest';
import { EXTERNAL_ERROR_CODES } from '@objectstack/spec/shared';

import { isExternalWriteRefusal, isPermissionError } from './error-message';

const GATE_TEXT =
  "Write 'delete' blocked on object 'spare_parts': datasource 'parts_db' is external (schemaMode=external). " +
  'Requires datasource.external.allowWrites=true (got false) AND object.external.writable=true (got false).';

describe('isExternalWriteRefusal', () => {
  it('reads the code the spec declares for the gate', () => {
    expect(EXTERNAL_ERROR_CODES.writeForbidden).toBe('EXTERNAL_WRITE_FORBIDDEN');
  });

  it('answers true for the gate refusal on the error, and the permission predicate claims it too', () => {
    const err = Object.assign(new Error(GATE_TEXT), { code: 'EXTERNAL_WRITE_FORBIDDEN', httpStatus: 403 });
    expect(isExternalWriteRefusal(err)).toBe(true);
    // Why callers must ask it first.
    expect(isPermissionError(err)).toBe(true);
  });

  it('reads the code from `details` too (the whole body the client parks there)', () => {
    const err = Object.assign(new Error(GATE_TEXT), {
      httpStatus: 403,
      details: { error: GATE_TEXT, code: 'EXTERNAL_WRITE_FORBIDDEN' },
    });
    expect(isExternalWriteRefusal(err)).toBe(true);
  });

  it('CONTROL: every other refusal answers false', () => {
    const refused = (code: string | undefined, httpStatus = 403) =>
      Object.assign(new Error(GATE_TEXT), { code, httpStatus });
    expect(isExternalWriteRefusal(refused('PERMISSION_DENIED'))).toBe(false);
    expect(isExternalWriteRefusal(refused('FORBIDDEN'))).toBe(false);
    expect(isExternalWriteRefusal(refused(undefined))).toBe(false);
    // The remote's own refusal of a write the gate admitted is a different code.
    expect(isExternalWriteRefusal(refused('EXTERNAL_WRITE_REFUSED', 422))).toBe(false);
    // Text alone is never read: the gate's sentence without the code is not the verdict.
    expect(isExternalWriteRefusal(new Error(GATE_TEXT))).toBe(false);
    expect(isExternalWriteRefusal(null)).toBe(false);
    expect(isExternalWriteRefusal('EXTERNAL_WRITE_FORBIDDEN')).toBe(false);
  });
});
