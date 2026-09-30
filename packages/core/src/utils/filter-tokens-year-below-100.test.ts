// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20599] A date macro that steps into 0001..0099 resolves to a day in that
// year, spelled `YYYY-MM-DD`. The resolver's proxy dates were built by
// `Date.UTC(year, …)`, which reads a year from 0 to 99 as 1900 + year, so
// `{1976_years_ago}` resolved to a day in 1950. They are built by core's
// `wallClockToUtcMs` now, and the day is spelled by the storage rule's `date`
// form, whose year is padded to four digits.
//
// Pins: 0001, 0050 and 0099, with 0100 (the first year `Date.UTC` reads as
// written) and a 2026 control, in UTC and in Asia/Shanghai.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resolveFilterToken } from './filter-tokens.js';

// Wed 2026-09-30 12:00 UTC: the same calendar day in UTC and in Asia/Shanghai.
const NOW = new Date('2026-09-30T12:00:00.000Z');
// Wed 2026-09-30 20:00 UTC: Thu 2026-10-01 04:00 in Asia/Shanghai.
const LATE = new Date('2026-09-30T20:00:00.000Z');

const at = (token: string, now: Date, timezone?: string) => resolveFilterToken(token, { now, timezone });

// Every pin runs on a UTC host and on an Asia/Shanghai host: the sites read
// UTC components only, and the answer must not move with the process zone.
const HOSTS = ['UTC', 'Asia/Shanghai'] as const;
const originalTz = process.env.TZ;
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each(HOSTS)('on a %s host', (host) => {
  beforeEach(() => {
    process.env.TZ = host;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(host);
  });

  describe('[#20599] a year step into 0001..0099 keeps its year', () => {
    it.each([
      ['2025_years_ago', '0001-09-30'],
      ['1976_years_ago', '0050-09-30'],
      ['1927_years_ago', '0099-09-30'],
      ['1926_years_ago', '0100-09-30'],
      ['1_year_ago', '2025-09-30'],
      ['24000_months_ago', '0026-09-30'],
    ])('{%s} in UTC is %s', (token, expected) => {
      expect(at(token, NOW)).toBe(expected);
      expect(at(token, NOW, 'UTC')).toBe(expected);
      expect(at(token, NOW, 'Asia/Shanghai')).toBe(expected);
    });

    it.each([
      ['2025_years_ago', '0001-09-30', '0001-10-01'],
      ['1976_years_ago', '0050-09-30', '0050-10-01'],
      ['1927_years_ago', '0099-09-30', '0099-10-01'],
      ['1926_years_ago', '0100-09-30', '0100-10-01'],
      ['1_year_ago', '2025-09-30', '2025-10-01'],
    ])('{%s} steps from the reference zone\'s day: %s in UTC, %s in Asia/Shanghai', (token, utc, shanghai) => {
      expect(at(token, LATE)).toBe(utc);
      expect(at(token, LATE, 'Asia/Shanghai')).toBe(shanghai);
    });

    it('clamps February 29 to the length of February in the year it lands in', () => {
      const leapDay = new Date('2028-02-29T12:00:00.000Z');
      expect(at('1978_years_ago', leapDay)).toBe('0050-02-28'); // 0050 is a common year
      expect(at('1980_years_ago', leapDay)).toBe('0048-02-29'); // 0048 is a leap year
      expect(at('1928_years_ago', leapDay)).toBe('0100-02-28'); // 0100 is a common year
      expect(at('4_years_ago', leapDay)).toBe('2024-02-29');
    });

    // A day step never went through `Date.UTC`; its year below 1000 was spelled
    // unpadded (`55-06-15`), which names no `YYYY-MM-DD` day.
    it('spells a day step into 0001..0999 with a four-digit year', () => {
      expect(at('720000_days_ago', NOW)).toBe('0055-06-15');
      expect(at('739000_days_ago', NOW)).toBe('0003-06-08');
      expect(at('1_day_ago', NOW)).toBe('2026-09-29');
    });
  });
});
