// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The calendar-day bound primitive (ADR-0053 D-D). It lives in spec because six
 * backends now share it — the SQL compiler, the memory and mongo drivers, the
 * analytics raw-SQL strategy, the dataset preview evaluator, and `formula`'s
 * RLS write-side `check` evaluator. Its refusals are as load-bearing as its
 * answers: every `null` below is a case some backend must NOT widen.
 */

import { describe, expect, it } from 'vitest';
import { nextUtcCalendarDay, utcInstantMs } from './calendar-day';

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

/**
 * [#20550] Every day of the supported years 0001..9999 is a calendar day to
 * both helpers, the years 0001..0099 included. `Date.UTC` reads a year from 0
 * to 99 as 1900 + year, so a construction through it built `0050-01-01` as
 * 1950-01-01, the round trip failed, and both helpers answered `null` for
 * every day of those years: a `$lte` or a `$between` maximum on such a day
 * compiled to that day's midnight and missed the rest of it. Year 0100 is the
 * control that always answered, and 2026 the everyday one.
 */
describe('[#20550] years 0001..0099 are calendar days, not 1900..1999', () => {
  /** day · the day after it */
  const DAYS: ReadonlyArray<readonly [string, string]> = [
    ['0001-01-01', '0001-01-02'],
    ['0050-01-01', '0050-01-02'],
    ['0099-12-31', '0100-01-01'], // the century rolls over, not back to 1900
    ['0100-01-01', '0100-01-02'], // the control that answered before
    ['2026-07-15', '2026-07-16'], // the everyday control
  ];

  it('nextUtcCalendarDay answers the day after, in the year as written', () => {
    for (const [day, next] of DAYS) expect(nextUtcCalendarDay(day), day).toBe(next);
  });

  it("utcInstantMs answers that day's midnight UTC", () => {
    for (const [day] of DAYS) {
      const ms = utcInstantMs(day);
      expect(ms, day).toBe(Date.parse(`${day}T00:00:00.000Z`));
      expect(new Date(ms!).toISOString(), day).toBe(`${day}T00:00:00.000Z`);
    }
  });

  it('an impossible day in those years is still refused by both, not rolled over', () => {
    for (const day of ['0050-02-30', '0001-13-01', '0099-04-31', '0100-02-29', '2026-02-30']) {
      expect(nextUtcCalendarDay(day), day).toBeNull();
      expect(utcInstantMs(day), day).toBeNull();
    }
  });

  it('the leap rule is the proleptic Gregorian one in those years: 0004-02-29 is a day, 0100-02-29 is not', () => {
    expect(nextUtcCalendarDay('0004-02-28')).toBe('0004-02-29');
    expect(nextUtcCalendarDay('0004-02-29')).toBe('0004-03-01');
    expect(utcInstantMs('0004-02-29')).toBe(Date.parse('0004-02-29T00:00:00.000Z'));
    expect(nextUtcCalendarDay('0100-02-28')).toBe('0100-03-01'); // 0100 is not a leap year
    expect(nextUtcCalendarDay('0100-02-29')).toBeNull();
    expect(utcInstantMs('0100-02-29')).toBeNull();
  });
});
