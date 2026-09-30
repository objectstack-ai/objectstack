// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20599] This package's own date-bucket sites read a year from 0001 to 0099
 * as itself.
 *
 * - The preview evaluator's `week` key (`bucketDate`) built the day with
 *   `Date.UTC(year, …)`, which reads a year from 0 to 99 as 1900 + year, so a
 *   row on 0050-06-15 was keyed to a Monday in 1950.
 * - The dataset executor's `compareTo` alignment counts bucket ordinals from a
 *   bound's day (core's `zonedDateStartToUtcMs`, the same remap) and mints a
 *   week key back from an ordinal (then a private week rule, whose January 4
 *   was built by `Date.UTC` too; since #20760 core's `bucketDateKey`).
 *
 * Both build through core's `wallClockToUtcMs` now. Pins: 0001, 0050 and 0099,
 * with 0100 (the first year `Date.UTC` reads as written) and a 2026 control,
 * in UTC and in Asia/Shanghai where the site takes a zone.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { bucketDate } from '../preview-evaluator.js';
import { bucketKeyAtOrdinal, bucketOrdinalOfDay } from '../dataset-executor.js';

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

  describe('[#20599] preview bucketDate(week) names the Monday of a day in 0001..0099', () => {
    it.each([
      ['0001-01-03T10:00:00.000Z', '0001-01-01'],
      ['0050-01-01T10:00:00.000Z', '0049-12-27'],
      ['0050-06-15T10:00:00.000Z', '0050-06-13'],
      ['0099-12-31T10:00:00.000Z', '0099-12-28'],
      ['0100-01-06T10:00:00.000Z', '0100-01-04'],
      ['2026-06-17T10:00:00.000Z', '2026-06-15'],
    ])('%s in UTC is the week of %s', (instant, monday) => {
      expect(bucketDate(instant, 'week')).toBe(monday);
      expect(bucketDate(instant, 'week', 'UTC')).toBe(monday);
    });

    it.each([
      // Sunday 0050-01-02 in UTC is Monday 0050-01-03 in Shanghai.
      ['0050-01-02T20:00:00.000Z', '0049-12-27', '0050-01-03'],
      ['0001-01-07T20:00:00.000Z', '0001-01-01', '0001-01-08'],
      ['0099-12-31T20:00:00.000Z', '0099-12-28', '0099-12-28'],
      ['2026-06-14T20:00:00.000Z', '2026-06-08', '2026-06-15'],
    ])('%s is the week of %s in UTC and of %s in Asia/Shanghai', (instant, utc, shanghai) => {
      expect(bucketDate(instant, 'week')).toBe(utc);
      expect(bucketDate(instant, 'week', 'Asia/Shanghai')).toBe(shanghai);
    });
  });

  describe('[#20599] compareTo bucket ordinals count a day in 0001..0099 in its own year', () => {
    // [#20760] A minted key's year is four digits (`0050-06`), so the key is
    // read as numbers only when its year is; an unpadded key reads `NaN` and
    // fails the assertion. The spelling itself is pinned in
    // `bucket-key-four-digit-year.test.ts`.
    const numbers = (key: string) =>
      /^\d{4}(-|$)/.test(key) ? key.split(/-[WQ]?/).map(Number) : [Number.NaN];

    it.each([
      ['0001-06-15', 1],
      ['0050-06-15', 50],
      ['0099-06-15', 99],
      ['0100-06-15', 100],
      ['2026-06-15', 2026],
    ])('%s is in year %i, month 6, quarter 2, and on its own day', (day, year) => {
      expect(bucketOrdinalOfDay(day, 'year')).toBe(year);
      expect(numbers(bucketKeyAtOrdinal(bucketOrdinalOfDay(day, 'year'), 'year'))).toEqual([year]);
      expect(numbers(bucketKeyAtOrdinal(bucketOrdinalOfDay(day, 'quarter'), 'quarter'))).toEqual([year, 2]);
      expect(numbers(bucketKeyAtOrdinal(bucketOrdinalOfDay(day, 'month'), 'month'))).toEqual([year, 6]);
      expect(numbers(bucketKeyAtOrdinal(bucketOrdinalOfDay(day, 'day'), 'day'))).toEqual([year, 6, 15]);
    });

    it.each([
      ['0001-01-01', [1, 1]],
      ['0050-01-01', [49, 52]],
      ['0050-06-15', [50, 24]],
      ['0099-12-31', [99, 53]],
      ['0100-01-04', [100, 1]],
      ['2026-06-15', [2026, 25]],
    ])('the week ordinal of %s mints its ISO week back', (day, week) => {
      expect(numbers(bucketKeyAtOrdinal(bucketOrdinalOfDay(day, 'week'), 'week'))).toEqual(week);
    });
  });
});
