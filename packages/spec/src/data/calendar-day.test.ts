// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The calendar-day bound primitive (ADR-0053 D-D). It lives in spec because six
 * backends now share it — the SQL compiler, the memory and mongo drivers, the
 * analytics raw-SQL strategy, the dataset preview evaluator, and `formula`'s
 * RLS write-side `check` evaluator. Its refusals are as load-bearing as its
 * answers: every `null` below is a case some backend must NOT widen.
 */

import { describe, expect, it } from 'vitest';
import { nextUtcCalendarDay, utcInstantMs, UNBOUNDED_ABOVE, isUnboundedAbove } from './calendar-day';

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
describe('years 0001..0099 are calendar days, not 1900..1999', () => {
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

/**
 * [#20600] `9999-12-31`, the last day of the supported years, has no next day
 * with a `YYYY-MM-DD` spelling. The helper answered the five-digit
 * `'10000-01-01'`, which sorts below `'2026-…'` as text, so a SQLite `datetime`
 * `$lte '9999-12-31'` answered no rows. It now answers `UNBOUNDED_ABOVE`: every
 * supported value is inside that day's whole-day bound, so an emitter compiles
 * no upper bound. The answer is neither `null` ("not a calendar day", which
 * would compile the day's midnight and miss the rest of it) nor a string.
 */
describe('the last supported day answers UNBOUNDED_ABOVE', () => {
  it('9999-12-31 answers UNBOUNDED_ABOVE — not a five-digit day, not null', () => {
    const next = nextUtcCalendarDay('9999-12-31');
    expect(next).toBe(UNBOUNDED_ABOVE);
    expect(next).not.toBeNull();
    expect(typeof next).toBe('symbol');
    expect(nextUtcCalendarDay(' 9999-12-31 ')).toBe(UNBOUNDED_ABOVE); // trimmed, like every day
  });

  it('the days before it still answer the next day (the control)', () => {
    expect(nextUtcCalendarDay('9999-12-30')).toBe('9999-12-31');
    expect(nextUtcCalendarDay('9999-11-30')).toBe('9999-12-01');
    expect(nextUtcCalendarDay('9998-12-31')).toBe('9999-01-01');
  });

  it('it is the one real day that does: every answer is a bare day or that value', () => {
    // Walk the last year day by day; only its final day has no next day.
    let unbounded = 0;
    for (let ms = Date.parse('9999-01-01T00:00:00.000Z'); ms <= Date.parse('9999-12-31T00:00:00.000Z'); ms += 86_400_000) {
      const day = new Date(ms).toISOString().slice(0, 10);
      const next = nextUtcCalendarDay(day);
      if (isUnboundedAbove(next)) unbounded += 1;
      else expect(next, day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(unbounded).toBe(1);
  });

  it('refusals are unchanged: an instant on that day, an impossible day and a five-digit day stay null', () => {
    expect(nextUtcCalendarDay('9999-12-31T10:00:00.000Z')).toBeNull();
    expect(nextUtcCalendarDay(new Date('9999-12-31T00:00:00.000Z'))).toBeNull();
    expect(nextUtcCalendarDay('9999-12-32')).toBeNull();
    expect(nextUtcCalendarDay('10000-01-01')).toBeNull();
  });

  it('is one registered symbol, so a second bundled copy of the helper answers the same value', () => {
    expect(UNBOUNDED_ABOVE).toBe(Symbol.for('objectstack.calendarDay.unboundedAbove'));
  });

  it('isUnboundedAbove is true for that answer alone, and narrows it away', () => {
    expect(isUnboundedAbove(nextUtcCalendarDay('9999-12-31'))).toBe(true);
    expect(isUnboundedAbove(UNBOUNDED_ABOVE)).toBe(true);
    expect(isUnboundedAbove(Symbol.for('objectstack.calendarDay.unboundedAbove'))).toBe(true);
    // An unregistered symbol with the same description is another value.
    expect(isUnboundedAbove(Symbol('objectstack.calendarDay.unboundedAbove'))).toBe(false);
    for (const other of [nextUtcCalendarDay('9999-12-30'), null, undefined, '10000-01-01', '9999-12-31', {}]) {
      expect(isUnboundedAbove(other), String(other)).toBe(false);
    }
    // The false branch is `string | null` to the compiler: a template literal
    // compiles there, and would not on the unnarrowed answer (TS2731).
    const next = nextUtcCalendarDay('9999-12-30');
    const bound = isUnboundedAbove(next) || next === null ? null : `${next}T00:00:00.000Z`;
    expect(bound).toBe('9999-12-31T00:00:00.000Z');
  });

  it("utcInstantMs still reads 9999-12-31 as that day's midnight UTC", () => {
    expect(utcInstantMs('9999-12-31')).toBe(Date.parse('9999-12-31T00:00:00.000Z'));
  });
});
