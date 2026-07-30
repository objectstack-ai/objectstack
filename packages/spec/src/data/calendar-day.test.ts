// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The calendar-day bound primitive (ADR-0053 D-D). It lives in spec because six
 * backends now share it — the SQL compiler, the memory and mongo drivers, the
 * analytics raw-SQL strategy, the dataset preview evaluator, and `formula`'s
 * RLS write-side `check` evaluator. Its refusals are as load-bearing as its
 * answers: every `null` below is a case some backend must NOT widen.
 */

import { describe, expect, it } from 'vitest';
import { nextUtcCalendarDay } from './calendar-day';

describe('nextUtcCalendarDay', () => {
  it('advances one calendar day', () => {
    expect(nextUtcCalendarDay('2026-07-28')).toBe('2026-07-29');
    expect(nextUtcCalendarDay(' 2026-07-28 ')).toBe('2026-07-29'); // trimmed
  });

  it('rolls month, year and leap boundaries', () => {
    expect(nextUtcCalendarDay('2026-07-31')).toBe('2026-08-01');
    expect(nextUtcCalendarDay('2026-12-31')).toBe('2027-01-01');
    expect(nextUtcCalendarDay('2024-02-28')).toBe('2024-02-29'); // leap year
    expect(nextUtcCalendarDay('2024-02-29')).toBe('2024-03-01');
    expect(nextUtcCalendarDay('2025-02-28')).toBe('2025-03-01'); // non-leap
  });

  it('refuses instants — they keep exact-instant semantics', () => {
    expect(nextUtcCalendarDay('2026-07-28T12:00:00Z')).toBeNull();
    expect(nextUtcCalendarDay('2026-07-28T00:00:00.000Z')).toBeNull();
    expect(nextUtcCalendarDay(new Date('2026-07-28T00:00:00Z'))).toBeNull();
    expect(nextUtcCalendarDay(1753660800000)).toBeNull();
  });

  it('refuses impossible days rather than rolling them over', () => {
    // `Date.UTC(2026, 1, 30)` is March 2nd — returning that would query a date
    // the author never wrote, so the round-trip check rejects it.
    expect(nextUtcCalendarDay('2026-02-30')).toBeNull();
    expect(nextUtcCalendarDay('2025-02-29')).toBeNull(); // not a leap year
    expect(nextUtcCalendarDay('2026-13-01')).toBeNull();
    expect(nextUtcCalendarDay('2026-00-10')).toBeNull();
    expect(nextUtcCalendarDay('2026-07-32')).toBeNull();
  });

  it('refuses anything that is not the canonical bare-day shape', () => {
    expect(nextUtcCalendarDay('2026-7-28')).toBeNull(); // not zero-padded
    expect(nextUtcCalendarDay('7/28/2026')).toBeNull();
    expect(nextUtcCalendarDay('2026-07')).toBeNull();
    expect(nextUtcCalendarDay('')).toBeNull();
    expect(nextUtcCalendarDay(null)).toBeNull();
    expect(nextUtcCalendarDay(undefined)).toBeNull();
    expect(nextUtcCalendarDay({})).toBeNull();
  });

  it('the result is itself a valid bare day — the rule composes', () => {
    // Chaining is not a use case, but a returned value that the primitive
    // would reject would mean the two halves disagree about the shape.
    const next = nextUtcCalendarDay('2026-12-31')!;
    expect(nextUtcCalendarDay(next)).toBe('2027-01-02');
  });
});
