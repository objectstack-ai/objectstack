// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `zonedDateStartToUtcMs` turns a bucket's first calendar day (in the reference
// timezone) into the UTC instant that day BEGINS — used to scope a `datetime`
// date-bucket drill (#1752). It must be DST-safe: the offset comes from the tz
// database, and midnight must land exactly on the day boundary in that zone.

import { describe, it, expect } from 'vitest';
import { zonedDateStartToUtcMs, calendarPartsInTz, nextUtcCalendarDay } from './datetime.js';

const iso = (s: string) => Date.parse(s);

describe('zonedDateStartToUtcMs — exact boundaries', () => {
  it('UTC / unset / unknown zone → plain UTC midnight', () => {
    expect(zonedDateStartToUtcMs('2026-06-01', 'UTC')).toBe(iso('2026-06-01T00:00:00Z'));
    expect(zonedDateStartToUtcMs('2026-06-01')).toBe(iso('2026-06-01T00:00:00Z'));
    expect(zonedDateStartToUtcMs('2026-06-01', 'Not/AZone')).toBe(iso('2026-06-01T00:00:00Z'));
  });

  it('fixed positive offset (Asia/Shanghai, +08, no DST)', () => {
    // Shanghai June 1 00:00 (+08) === May 31 16:00 UTC.
    expect(zonedDateStartToUtcMs('2026-06-01', 'Asia/Shanghai')).toBe(iso('2026-05-31T16:00:00Z'));
  });

  it('DST zone — summer vs winter offset (America/New_York)', () => {
    // June → EDT (−04): midnight === 04:00 UTC.
    expect(zonedDateStartToUtcMs('2026-06-01', 'America/New_York')).toBe(iso('2026-06-01T04:00:00Z'));
    // January → EST (−05): midnight === 05:00 UTC.
    expect(zonedDateStartToUtcMs('2026-01-01', 'America/New_York')).toBe(iso('2026-01-01T05:00:00Z'));
  });

  it('DST transition days — midnight is before the 2am switch, so uses the pre-switch offset', () => {
    // Spring-forward day (2026-03-08): midnight still EST (−05).
    expect(zonedDateStartToUtcMs('2026-03-08', 'America/New_York')).toBe(iso('2026-03-08T05:00:00Z'));
    // Fall-back day (2026-11-01): midnight still EDT (−04).
    expect(zonedDateStartToUtcMs('2026-11-01', 'America/New_York')).toBe(iso('2026-11-01T04:00:00Z'));
  });

  it('unparseable input → NaN', () => {
    expect(Number.isNaN(zonedDateStartToUtcMs('2026-06', 'UTC'))).toBe(true);
    expect(Number.isNaN(zonedDateStartToUtcMs('nope', 'America/New_York'))).toBe(true);
  });
});

describe('zonedDateStartToUtcMs — round-trips to the day boundary in the zone', () => {
  const cases: Array<[string, string]> = [
    ['2026-06-01', 'Asia/Shanghai'],
    ['2026-06-01', 'America/New_York'],
    ['2026-01-01', 'America/New_York'],
    ['2026-02-15', 'UTC'],
  ];
  for (const [ymd, tz] of cases) {
    it(`${ymd} @ ${tz}: the instant is that calendar day, and 1ms earlier is the previous day`, () => {
      const ms = zonedDateStartToUtcMs(ymd, tz);
      const [y, m, d] = ymd.split('-').map(Number);
      // The instant falls on the target calendar day in `tz`…
      expect(calendarPartsInTz(new Date(ms), tz)).toEqual({ year: y, month: m, day: d });
      // …and one millisecond earlier is the day before → it is exactly midnight.
      expect(calendarPartsInTz(new Date(ms - 1), tz)).not.toEqual({ year: y, month: m, day: d });
    });
  }
});

describe('nextUtcCalendarDay — the exclusive upper bound of a bare calendar day (#3777)', () => {
  it('advances one day, rolling month, year and leap boundaries', () => {
    expect(nextUtcCalendarDay('2026-07-28')).toBe('2026-07-29');
    expect(nextUtcCalendarDay('2026-07-31')).toBe('2026-08-01');
    expect(nextUtcCalendarDay('2026-12-31')).toBe('2027-01-01');
    expect(nextUtcCalendarDay('2024-02-28')).toBe('2024-02-29'); // leap year
    expect(nextUtcCalendarDay('2025-02-28')).toBe('2025-03-01');
    expect(nextUtcCalendarDay(' 2026-07-28 ')).toBe('2026-07-29'); // trimmed
  });

  it('returns null for anything that is not a valid bare calendar day', () => {
    // Instants keep instant semantics — never widened.
    expect(nextUtcCalendarDay('2026-07-28T12:00:00Z')).toBeNull();
    expect(nextUtcCalendarDay(new Date('2026-07-28T00:00:00Z'))).toBeNull();
    // Impossible days are rejected, not rolled into an invented bound.
    expect(nextUtcCalendarDay('2026-02-30')).toBeNull();
    expect(nextUtcCalendarDay('2026-13-01')).toBeNull();
    // Non-strings / junk.
    expect(nextUtcCalendarDay(1753660800000)).toBeNull();
    expect(nextUtcCalendarDay(null)).toBeNull();
    expect(nextUtcCalendarDay(undefined)).toBeNull();
    expect(nextUtcCalendarDay('7/28/2026')).toBeNull();
    expect(nextUtcCalendarDay('2026-7-28')).toBeNull(); // not zero-padded → not the canonical shape
  });
});
