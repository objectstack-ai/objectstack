// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { StandardErrorCode } from './errors.zod';
import { ERROR_CODE_LEDGER, REGISTERED_ERROR_CODES, ErrorCode } from './error-code-ledger.zod';

/**
 * Ledger admission rules (ADR-0112 D3). These are the invariants that make a
 * registered code a catalogued one rather than an invented string — keep them
 * in sync with the registration instructions in `error-code-ledger.ts`.
 */
describe('ERROR_CODE_LEDGER', () => {
  const entries = Object.entries(ERROR_CODE_LEDGER);

  it('every registered code is SCREAMING_SNAKE', () => {
    for (const [pkg, codes] of entries) {
      for (const code of codes) {
        expect(code, `${pkg} → ${code}`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  it('no package registers the same code twice', () => {
    for (const [pkg, codes] of entries) {
      expect(new Set(codes).size, `duplicate code in ${pkg}`).toBe(codes.length);
    }
  });

  it('no registered code shadows the standard catalog', () => {
    const standard = new Set<string>(StandardErrorCode.options);
    for (const [pkg, codes] of entries) {
      for (const code of codes) {
        expect(standard.has(code), `${pkg} → ${code} is already a StandardErrorCode`).toBe(false);
      }
    }
  });

  it('owner keys are package names', () => {
    for (const [pkg] of entries) {
      expect(pkg).toMatch(/^@objectstack\/[a-z0-9-]+$/);
    }
  });

  it('REGISTERED_ERROR_CODES is the deduped, sorted union', () => {
    const union = [...new Set(entries.flatMap(([, codes]) => [...codes]))].sort();
    expect([...REGISTERED_ERROR_CODES]).toEqual(union);
  });
});

describe('ErrorCode (standard ∪ registered)', () => {
  it('accepts standard-catalog members', () => {
    expect(ErrorCode.parse('VALIDATION_ERROR')).toBe('VALIDATION_ERROR');
    expect(ErrorCode.parse('PERMISSION_DENIED')).toBe('PERMISSION_DENIED');
    expect(ErrorCode.parse('METHOD_NOT_ALLOWED')).toBe('METHOD_NOT_ALLOWED');
  });

  it('accepts registered extension codes', () => {
    expect(ErrorCode.parse('AUTH_REQUIRED')).toBe('AUTH_REQUIRED');
    expect(ErrorCode.parse('ATTACHMENT_DOWNLOAD_DENIED')).toBe('ATTACHMENT_DOWNLOAD_DENIED');
    expect(ErrorCode.parse('VALIDATION_FAILED')).toBe('VALIDATION_FAILED');
    expect(ErrorCode.parse('ROUTE_NOT_FOUND')).toBe('ROUTE_NOT_FOUND');
  });

  it('rejects unregistered, lowercase, and numeric codes', () => {
    expect(() => ErrorCode.parse('TOTALLY_MADE_UP_CODE')).toThrow();
    expect(() => ErrorCode.parse('validation_error')).toThrow(); // pre-ADR-0112 dialect
    expect(() => ErrorCode.parse(400)).toThrow();                // pre-#3842 dispatcher shape
    expect(() => ErrorCode.parse('')).toThrow();
  });
});
