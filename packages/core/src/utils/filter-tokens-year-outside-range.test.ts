// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20844] A date macro that lands outside the years 0001..9999 resolves to a
// day spelled in the expanded-year form (`+010026-09-30`, `-000001-09-30`),
// so core's one range reads the year it resolved to, on every host. Before,
// it took the storage rule's unpadded spelling (`10026-09-30`, `-1-09-30`),
// which `Date.parse` reads through the host's legacy parser, in the host's
// zone: `-1-09-30` read as a day in 2001, so `isOutsideTemporalYearRange`
// judged `{2027_years_ago}` inside the range, for both kinds.
//
// Pins: both sides of 0001..9999, year 0, the edges inside, a 2026 control and
// a sub-day instant (spelled by `toISOString` already), in UTC and in
// Asia/Shanghai. The engine refuses each one outside its field's years;
// objectql's `engine-resolved-token-year-range.test.ts` pins that half.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resolveFilterToken, resolveFilterTokens } from './filter-tokens.js';
import { isOutsideTemporalYearRange } from './temporal-storage-form.js';

// Wed 2026-09-30 12:00 UTC: the same calendar day in UTC and in Asia/Shanghai.
const NOW = new Date('2026-09-30T12:00:00.000Z');

const at = (token: string, timezone?: string) => resolveFilterToken(token, { now: NOW, timezone });

/** The UTC year `Date.parse` reads a resolved value as. */
const parsedYear = (value: unknown) => new Date(Date.parse(String(value))).getUTCFullYear();

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

  describe('[#20844] a day outside 0001..9999 is spelled so the range reads the year it resolved to', () => {
    it.each([
      ['8000_years_from_now', '+010026-09-30', 10026],
      ['7974_years_from_now', '+010000-09-30', 10000],
      ['2027_years_ago', '-000001-09-30', -1],
      ['2026_years_ago', '0000-09-30', 0],
      ['100000_months_from_now', '+010360-01-30', 10360],
    ])('{%s} is %s, year %i, outside both kinds\' years', (token, expected, year) => {
      for (const tz of [undefined, 'UTC', 'Asia/Shanghai']) {
        const day = at(token, tz);
        expect(day, `${token} in ${tz ?? 'the default zone'}`).toBe(expected);
        expect(parsedYear(day)).toBe(year);
        expect(isOutsideTemporalYearRange(day, 'date')).toBe(true);
        expect(isOutsideTemporalYearRange(day, 'datetime')).toBe(true);
      }
    });

    it.each([
      ['7973_years_from_now', '9999-09-30', false],
      ['2025_years_ago', '0001-09-30', true],
      ['1026_years_ago', '1000-09-30', false],
      ['1027_years_ago', '0999-09-30', true],
      ['1_year_ago', '2025-09-30', false],
    ])('{%s} is %s: inside a date\'s years, and outside a datetime\'s: %s', (token, expected, outsideDatetime) => {
      const day = at(token);
      expect(day).toBe(expected);
      expect(isOutsideTemporalYearRange(day, 'date')).toBe(false);
      expect(isOutsideTemporalYearRange(day, 'datetime')).toBe(outsideDatetime);
    });

    it('a sub-day placeholder past 9999 keeps the instant toISOString spells', () => {
      const instant = at('80000000_hours_from_now');
      expect(instant).toBe(new Date(NOW.getTime() + 80_000_000 * 3_600_000).toISOString());
      expect(String(instant).startsWith('+011153-')).toBe(true);
      expect(isOutsideTemporalYearRange(instant, 'datetime')).toBe(true);
    });

    it('resolveFilterTokens carries the same spelling into a filter tree', () => {
      expect(resolveFilterTokens({ opened_at: { $lt: '{2027_years_ago}' } }, { now: NOW })).toEqual({
        opened_at: { $lt: '-000001-09-30' },
      });
    });
  });
});
