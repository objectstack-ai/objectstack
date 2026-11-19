/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { DATE_MACRO_TOKENS, PERIOD_KEY_TOKENS } from '@objectstack/spec/data';
import { resolveDateMacros, resolvePeriodKeyTokens } from '../date-macros';

/**
 * The client resolver answers every fixed token the spec declares
 * (objectstack#30134). The list is read from the spec, never copied, so a
 * token added there without a resolver entry here fails this file.
 */
describe('resolveDateMacros covers the spec vocabulary (objectstack#30134)', () => {
  // Monday 2026-05-25, local noon.
  const now = new Date(2026, 4, 25, 12, 0, 0);

  it.each(DATE_MACRO_TOKENS.map((t) => [t]))('{%s} resolves to a day or an instant', (token) => {
    const out = resolveDateMacros(`{${token}}`, now);
    expect(out).not.toContain('{');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}(T|$)/);
  });

  it('{next_week_end} is the Sunday of next week (Monday-start weeks)', () => {
    // From a Monday.
    expect(resolveDateMacros('{next_week_end}', now)).toBe('2026-06-07');
    // From a Sunday: still the week after the one that Sunday closes.
    expect(resolveDateMacros('{next_week_end}', new Date(2026, 4, 31, 12))).toBe('2026-06-07');
    // Across a year boundary: Wednesday 2026-12-30 → next week is Jan 4–10, 2027.
    const dec30 = new Date(2026, 11, 30, 12);
    expect(resolveDateMacros('{next_week_start}', dec30)).toBe('2027-01-04');
    expect(resolveDateMacros('{next_week_end}', dec30)).toBe('2027-01-10');
  });

  it('{next_year_end} is Dec 31 of next year', () => {
    expect(resolveDateMacros('{next_year_end}', now)).toBe('2027-12-31');
    // On Dec 31 itself the answer is a full year out, not today.
    expect(resolveDateMacros('{next_year_end}', new Date(2026, 11, 31, 12))).toBe('2027-12-31');
    // On Jan 1 the year has rolled: next year is 2028.
    expect(resolveDateMacros('{next_year_end}', new Date(2027, 0, 1, 12))).toBe('2028-12-31');
  });
});

/**
 * The sibling pin for the period keys (objectstack#34938): every token in the
 * spec's `PERIOD_KEY_TOKENS` resolves here to a key, read from the spec, never
 * copied. The list is kept out of `DATE_MACRO_TOKENS`, so the block above
 * never sees it.
 */
describe('resolvePeriodKeyTokens covers the spec period-key list (objectstack#34938)', () => {
  const now = new Date(2026, 4, 25, 12, 0, 0);

  it('the list is the real one, not an empty one', () => {
    expect(PERIOD_KEY_TOKENS.length).toBeGreaterThan(0);
  });

  it.each(PERIOD_KEY_TOKENS.map((t) => [t]))('{%s} resolves to a key, and is no date macro here', (token) => {
    const out = resolvePeriodKeyTokens(`{${token}}`, now);
    expect(out).not.toContain('{');
    expect(out).toMatch(/^\d{4}-W\d{2}$/);
    expect((DATE_MACRO_TOKENS as readonly string[]).includes(token)).toBe(false);
    expect(resolveDateMacros(`{${token}}`, now)).toBe(`{${token}}`);
  });
});
