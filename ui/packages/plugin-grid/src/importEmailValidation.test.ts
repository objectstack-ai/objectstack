/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * isRecordEmail() is the Import Wizard preview's check of an `email` cell
 * (objectui#11889). The server's import passes such a cell through coercion
 * untouched, and the engine's record validator then judges it with its
 * `EMAIL_RE`, so that rule is the import's verdict and the preview's.
 *
 * The preview used to apply the identity import's stricter rule
 * (`isLikelyEmail`: printable ASCII, framework#3566) to every email field, and
 * so marked `735431496@柴仟.com`, which a record's email field takes.
 */
import { describe, it, expect } from 'vitest';
import { isRecordEmail } from './importCoercionContract';

/**
 * The record validator's pattern, as `record-validator.ts` in
 * `@objectstack/objectql` declares it (`const EMAIL_RE`). It is the oracle the
 * one-pass check is compared against. If the server's pattern changes, change
 * it here and in `isRecordEmail` together.
 */
const SERVER_EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

describe('isRecordEmail (the record validator EMAIL_RE)', () => {
  it('takes an address with a non-ASCII domain or local part, as the server does', () => {
    expect(isRecordEmail('735431496@柴仟.com')).toBe(true);
    expect(isRecordEmail('ａｂｃ@b.com')).toBe(true);
    expect(isRecordEmail('ü@ü.ü')).toBe(true);
  });

  it('takes normal addresses', () => {
    expect(isRecordEmail('name@example.com')).toBe(true);
    expect(isRecordEmail('first.last@sub.example.co')).toBe(true);
    expect(isRecordEmail('a+tag@b.co')).toBe(true);
  });

  it('refuses what the server refuses', () => {
    for (const value of [
      'a@b', 'no-at.example.com', 'a@@b.co', 'a@.co', 'a@b.', '@b.co', 'a@b..c', 'a@b@c.d',
      'has space@b.co', 'a@b.c ', 'a @b.c', 'a@b　.c', 'a@b.c\n', 'x@柴仟',
    ]) {
      expect(isRecordEmail(value), value).toBe(false);
    }
  });

  it('agrees with the server pattern on every value here', () => {
    const values = [
      '735431496@柴仟.com', 'a@b', 'a@b.c', 'name@example.com', 'a@@b.co', 'a@.co', 'a@b.', '@b.co', 'a@b..c',
      '.a@b.c', 'a.@b.c', 'a@b.c.', 'a@b@c.d', 'has space@b.co', 'a@b.c ', ' a@b.c', 'a @b.c', 'a@b　.c',
      'a@b.c\n', 'a@b.c ', 'a@﻿b.c', 'a@b\tc.d', 'x@柴仟', 'x@柴.仟', 'a@b.c.d.e', '"q"@b.co', '!@'.repeat(50),
    ];
    for (const value of values) {
      expect(isRecordEmail(value), JSON.stringify(value)).toBe(SERVER_EMAIL_RE.test(value));
    }
  });

  it('is fast on adversarial input (no backtracking)', () => {
    const t0 = Date.now();
    expect(isRecordEmail('!@'.repeat(100_000))).toBe(false);
    expect(isRecordEmail(`a@${'b.'.repeat(100_000)}`)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
