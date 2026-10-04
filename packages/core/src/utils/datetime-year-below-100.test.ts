// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20599] Wherever core builds a UTC instant from year / month / day / time
// parts, a year from 0001 to 0099 is read as itself. `Date.UTC(year, …)` and
// `new Date(year, …)` read a year from 0 to 99 as 1900 + year (ECMA-262
// `MakeFullYear`); `wallClockToUtcMs` does not, and every site in this file
// builds through it.
//
// Pins: 0001, 0050 and 0099 (the remapped years), 0100 (the first year
// `Date.UTC` reads as written) and a 2026 control, in UTC and in Asia/Shanghai
// wherever the site takes a zone. Every expected instant is spelled as an ISO
// string, never computed by the code under test. Before 1901 the tz database
// gives Asia/Shanghai its local mean time, +08:05:43, and America/New_York
// −04:56:02: that is the offset a wall clock in those years is read at.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  wallClockToUtcMs,
  zonedWallClockToUtcMs,
  zonedDateStartToUtcMs,
  bucketDateKey,
  bucketKeyToCalendarRange,
} from './datetime.js';

const isoOf = (ms: number) => new Date(ms).toISOString();

const YEARS = ['0001', '0050', '0099', '0100', '2026'] as const;

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

  describe('[#20599] wallClockToUtcMs builds a UTC instant with the year as written', () => {
    it.each(YEARS)('%s-01-01 is midnight UTC of that year', (y) => {
      expect(isoOf(wallClockToUtcMs({ year: Number(y), month: 1, day: 1 }))).toBe(`${y}-01-01T00:00:00.000Z`);
    });

    it.each(YEARS)('%s-06-15 10:20:30.456 keeps every time component', (y) => {
      const ms = wallClockToUtcMs({ year: Number(y), month: 6, day: 15, hour: 10, minute: 20, second: 30, millisecond: 456 });
      expect(isoOf(ms)).toBe(`${y}-06-15T10:20:30.456Z`);
    });

    it('answers exactly what Date.UTC answers from year 100 on', () => {
      for (const [year, month, day, hour, minute, second, ms] of [
        [100, 1, 1, 0, 0, 0, 0],
        [999, 12, 31, 23, 59, 59, 999],
        [2026, 7, 15, 10, 0, 0, 0],
        [9999, 12, 31, 23, 59, 59, 999],
      ]) {
        expect(wallClockToUtcMs({ year, month, day, hour, minute, second, millisecond: ms })).toBe(
          Date.UTC(year, month - 1, day, hour, minute, second, ms),
        );
      }
    });

    // H5: the rollover is load-bearing — `bucketKeyToCalendarRange` ends Q4 and
    // December at month 13, and `filter-tokens` counts a month's days as day 0 of
    // the next. The helper rolls every component over as `Date.UTC` does.
    describe('rolls every component over past its end, as Date.UTC does', () => {
      it.each([
        ['month 13 is January of the next year', { year: 50, month: 13, day: 1 }, '0051-01-01T00:00:00.000Z'],
        ['month 0 is December of the previous year', { year: 50, month: 0, day: 1 }, '0049-12-01T00:00:00.000Z'],
        ['day 0 is the last day of the previous month', { year: 50, month: 3, day: 0 }, '0050-02-28T00:00:00.000Z'],
        ['day 0 of March is February 29 in a leap year', { year: 48, month: 3, day: 0 }, '0048-02-29T00:00:00.000Z'],
        ['day 32 of December runs into the next year', { year: 50, month: 12, day: 32 }, '0051-01-01T00:00:00.000Z'],
        ['February 29 of a common year is March 1', { year: 50, month: 2, day: 29 }, '0050-03-01T00:00:00.000Z'],
        ['hour 24 is the next midnight', { year: 99, month: 12, day: 31, hour: 24 }, '0100-01-01T00:00:00.000Z'],
        ['hour −1 is the previous evening', { year: 50, month: 1, day: 1, hour: -1 }, '0049-12-31T23:00:00.000Z'],
        ['day 0 of January of year 1 is the last day of year 0', { year: 1, month: 1, day: 0 }, '0000-12-31T00:00:00.000Z'],
      ])('%s', (_label, parts, expected) => {
        expect(isoOf(wallClockToUtcMs(parts))).toBe(expected);
      });

      it('rolls the 2026 control exactly as Date.UTC does', () => {
        expect(wallClockToUtcMs({ year: 2026, month: 13, day: 1 })).toBe(Date.UTC(2026, 12, 1));
        expect(wallClockToUtcMs({ year: 2026, month: 3, day: 0 })).toBe(Date.UTC(2026, 2, 0));
        expect(wallClockToUtcMs({ year: 2026, month: 12, day: 32 })).toBe(Date.UTC(2026, 11, 32));
        expect(wallClockToUtcMs({ year: 2026, month: 1, day: 1, hour: 24 })).toBe(Date.UTC(2026, 0, 1, 24));
      });
    });

    it('answers NaN for a NaN or non-finite component, as Date.UTC does', () => {
      expect(wallClockToUtcMs({ year: Number.NaN, month: 1, day: 1 })).toBeNaN();
      expect(wallClockToUtcMs({ year: 2026, month: Number.NaN, day: 1 })).toBeNaN();
      expect(wallClockToUtcMs({ year: 2026, month: 1, day: Number.NaN })).toBeNaN();
      expect(wallClockToUtcMs({ year: 2026, month: 1, day: 1, hour: Number.NaN })).toBeNaN();
      expect(wallClockToUtcMs({ year: Number.POSITIVE_INFINITY, month: 1, day: 1 })).toBeNaN();
    });
  });

  describe('[#20599] zonedWallClockToUtcMs reads a year below 100 as written', () => {
    it.each(YEARS)('%s-01-01 10:00 with no zone, UTC or an unknown zone is 10:00 UTC that day', (y) => {
      for (const tz of [undefined, 'UTC', 'Not/AZone']) {
        expect(isoOf(zonedWallClockToUtcMs({ year: Number(y), month: 1, day: 1, hour: 10 }, tz))).toBe(
          `${y}-01-01T10:00:00.000Z`,
        );
      }
    });

    it.each([
      ['0001', '0001-01-01T01:54:17.000Z'],
      ['0050', '0050-01-01T01:54:17.000Z'],
      ['0099', '0099-01-01T01:54:17.000Z'],
      ['0100', '0100-01-01T01:54:17.000Z'],
      ['2026', '2026-01-01T02:00:00.000Z'],
    ])('%s-01-01 10:00 in Asia/Shanghai is read at that year\'s offset', (y, expected) => {
      expect(isoOf(zonedWallClockToUtcMs({ year: Number(y), month: 1, day: 1, hour: 10 }, 'Asia/Shanghai'))).toBe(expected);
    });

    it('keeps the last second of 0099 in 0099 in Asia/Shanghai', () => {
      const ms = zonedWallClockToUtcMs({ year: 99, month: 12, day: 31, hour: 23, minute: 59, second: 59 }, 'Asia/Shanghai');
      expect(isoOf(ms)).toBe('0099-12-31T15:54:16.000Z');
    });

    // The offset read probes the zone at the wall clock taken as UTC. Early on
    // 0001-01-01 in a zone west of UTC that probe is still in year 0, whose
    // `Intl` year part is the era year `1` (1 BC): read without its era, the
    // probe would be a year off and so would the answer.
    it('reads 0001-01-01 in America/New_York, where the offset probe lands in year 0', () => {
      expect(isoOf(zonedWallClockToUtcMs({ year: 1, month: 1, day: 1 }, 'America/New_York'))).toBe(
        '0001-01-01T04:56:02.000Z',
      );
      expect(isoOf(zonedWallClockToUtcMs({ year: 1, month: 1, day: 1, hour: 3 }, 'America/New_York'))).toBe(
        '0001-01-01T07:56:02.000Z',
      );
      expect(isoOf(zonedWallClockToUtcMs({ year: 2026, month: 1, day: 1 }, 'America/New_York'))).toBe(
        '2026-01-01T05:00:00.000Z',
      );
    });
  });

  describe('[#20599] zonedDateStartToUtcMs', () => {
    it.each(YEARS)('%s-01-01 begins at midnight UTC with no zone and in UTC', (y) => {
      expect(isoOf(zonedDateStartToUtcMs(`${y}-01-01`))).toBe(`${y}-01-01T00:00:00.000Z`);
      expect(isoOf(zonedDateStartToUtcMs(`${y}-01-01`, 'UTC'))).toBe(`${y}-01-01T00:00:00.000Z`);
    });

    it.each([
      ['0001', '0000-12-31T15:54:17.000Z'],
      ['0050', '0049-12-31T15:54:17.000Z'],
      ['0099', '0098-12-31T15:54:17.000Z'],
      ['0100', '0099-12-31T15:54:17.000Z'],
      ['2026', '2025-12-31T16:00:00.000Z'],
    ])('%s-01-01 begins at Asia/Shanghai midnight', (y, expected) => {
      expect(isoOf(zonedDateStartToUtcMs(`${y}-01-01`, 'Asia/Shanghai'))).toBe(expected);
    });
  });

  describe('[#20599] bucketDateKey(week) puts a day in 0001..0099 in its own ISO week', () => {
    // [#20760] The key's year is four digits (`0049-W52`), so the key is read
    // as a four-digit year and a week, and asserted as the ISO week of the
    // day; an unpadded key does not parse and fails the assertion. The
    // spelling itself is pinned in `datetime-bucket-key-four-digit-year.test.ts`.
    const weekOf = (key: string | null) => {
      const m = /^(\d{4})-W(\d{2})$/.exec(String(key));
      return m ? { year: Number(m[1]), week: Number(m[2]) } : key;
    };

    it.each([
      ['0001-01-01T10:00:00.000Z', { year: 1, week: 1 }],
      ['0050-01-01T10:00:00.000Z', { year: 49, week: 52 }],
      ['0050-06-15T10:00:00.000Z', { year: 50, week: 24 }],
      ['0099-12-31T10:00:00.000Z', { year: 99, week: 53 }],
      ['0100-01-04T10:00:00.000Z', { year: 100, week: 1 }],
      ['2026-06-15T10:00:00.000Z', { year: 2026, week: 25 }],
    ])('%s in UTC', (instant, expected) => {
      expect(weekOf(bucketDateKey(instant, 'week'))).toEqual(expected);
      expect(weekOf(bucketDateKey(instant, 'week', 'UTC'))).toEqual(expected);
    });

    it.each([
      // Sunday 0050-01-02 in UTC is Monday 0050-01-03 in Shanghai: week 1 of 0050.
      ['0050-01-02T20:00:00.000Z', { year: 49, week: 52 }, { year: 50, week: 1 }],
      ['0001-01-07T20:00:00.000Z', { year: 1, week: 1 }, { year: 1, week: 2 }],
      ['0099-12-31T20:00:00.000Z', { year: 99, week: 53 }, { year: 99, week: 53 }],
      ['2026-06-14T20:00:00.000Z', { year: 2026, week: 24 }, { year: 2026, week: 25 }],
    ])('%s in UTC and in Asia/Shanghai', (instant, utc, shanghai) => {
      expect(weekOf(bucketDateKey(instant, 'week'))).toEqual(utc);
      expect(weekOf(bucketDateKey(instant, 'week', 'Asia/Shanghai'))).toEqual(shanghai);
    });
  });

  describe('[#20599] bucketKeyToCalendarRange spans a key in 0001..0099 in its own year', () => {
    it.each([
      ['0001', '0001-01-01', '0002-01-01'],
      ['0050', '0050-01-01', '0051-01-01'],
      ['0099', '0099-01-01', '0100-01-01'],
      ['0100', '0100-01-01', '0101-01-01'],
      ['2026', '2026-01-01', '2027-01-01'],
    ])('year %s', (key, start, end) => {
      expect(bucketKeyToCalendarRange(key, 'year')).toEqual({ start, end });
    });

    it.each([
      ['0001-Q2', '0001-04-01', '0001-07-01'],
      ['0050-Q1', '0050-01-01', '0050-04-01'],
      ['0050-Q4', '0050-10-01', '0051-01-01'],
      ['0099-Q4', '0099-10-01', '0100-01-01'],
      ['0100-Q4', '0100-10-01', '0101-01-01'],
      ['2026-Q4', '2026-10-01', '2027-01-01'],
    ])('quarter %s', (key, start, end) => {
      expect(bucketKeyToCalendarRange(key, 'quarter')).toEqual({ start, end });
    });

    it.each([
      ['0001-02', '0001-02-01', '0001-03-01'],
      ['0050-01', '0050-01-01', '0050-02-01'],
      ['0050-12', '0050-12-01', '0051-01-01'],
      ['0099-12', '0099-12-01', '0100-01-01'],
      ['0100-12', '0100-12-01', '0101-01-01'],
      ['2026-12', '2026-12-01', '2027-01-01'],
    ])('month %s', (key, start, end) => {
      expect(bucketKeyToCalendarRange(key, 'month')).toEqual({ start, end });
    });

    it.each([
      ['0001-01-01', '0001-01-02'],
      ['0048-02-29', '0048-03-01'],
      ['0050-01-01', '0050-01-02'],
      ['0050-12-31', '0051-01-01'],
      ['0099-12-31', '0100-01-01'],
      ['0100-01-01', '0100-01-02'],
      ['2026-02-28', '2026-03-01'],
    ])('day %s', (key, end) => {
      expect(bucketKeyToCalendarRange(key, 'day')).toEqual({ start: key, end });
    });

    it('still refuses an impossible day in 0001..0099 rather than rolling it over', () => {
      expect(bucketKeyToCalendarRange('0050-02-29', 'day')).toBeNull(); // 0050 is not a leap year
      expect(bucketKeyToCalendarRange('0099-04-31', 'day')).toBeNull();
      expect(bucketKeyToCalendarRange('0100-02-29', 'day')).toBeNull(); // 0100 is not a leap year
      expect(bucketKeyToCalendarRange('2026-02-29', 'day')).toBeNull();
    });

    // [#20760] The week arm's keys in 0001..0999 (`0050-W01`, `0049-W52`) are
    // pinned in `datetime-bucket-key-four-digit-year.test.ts`.
    it('week 2026-W01 (the control)', () => {
      expect(bucketKeyToCalendarRange('2026-W01', 'week')).toEqual({ start: '2025-12-29', end: '2026-01-05' });
    });
  });
});
