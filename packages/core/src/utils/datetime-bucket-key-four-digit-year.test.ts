// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20760] A bucket key spells its year with four digits at every granularity,
// as the drivers' bucket expressions do (`strftime('%Y')` on SQLite), and
// `bucketKeyToCalendarRange` reads exactly what `bucketDateKey` writes.
//
// A `date` value keeps the years 0001..9999, so a key in 0001..0999 is
// reachable through a `date` field and through a stored `datetime` row. Before
// this card the writer spelled such a year unpadded (`50-06`, `49-W52`) while
// SQL answered `0050-06`, and the reader's week arm checked a padded key
// against the unpadded label, so `0050-W01` found no range.
//
// Pins: 0001, 0050 and 0999 at every granularity, the ISO week-year at a year
// boundary (early January 0050 is in `0049-W52`), a drill-down from
// `0050-W01`, and a 2026 control. Every expected key is spelled literally,
// never computed by the code under test.

import { describe, it, expect } from 'vitest';
import { bucketDateKey, bucketKeyToCalendarRange, type BucketGranularity } from './datetime.js';

const GRANULARITIES = ['year', 'quarter', 'month', 'day', 'week'] as const satisfies readonly BucketGranularity[];

/** instant → the key at year / quarter / month / day / week. */
const KEYS: ReadonlyArray<readonly [string, Record<BucketGranularity, string>]> = [
  ['0001-01-01T10:00:00.000Z', { year: '0001', quarter: '0001-Q1', month: '0001-01', day: '0001-01-01', week: '0001-W01' }],
  ['0050-06-15T10:00:00.000Z', { year: '0050', quarter: '0050-Q2', month: '0050-06', day: '0050-06-15', week: '0050-W24' }],
  // The ISO week-numbering year is the previous calendar year here.
  ['0050-01-01T10:00:00.000Z', { year: '0050', quarter: '0050-Q1', month: '0050-01', day: '0050-01-01', week: '0049-W52' }],
  ['0999-06-15T10:00:00.000Z', { year: '0999', quarter: '0999-Q2', month: '0999-06', day: '0999-06-15', week: '0999-W24' }],
  // The control: a four-digit year is spelled as it always was.
  ['2026-06-15T10:00:00.000Z', { year: '2026', quarter: '2026-Q2', month: '2026-06', day: '2026-06-15', week: '2026-W25' }],
];

describe('[#20760] bucketDateKey spells the year with four digits', () => {
  describe.each(KEYS)('%s', (instant, expected) => {
    it.each(GRANULARITIES)('at %s', (g) => {
      expect(bucketDateKey(instant, g)).toBe(expected[g]);
      // A `Date` and epoch milliseconds name the same instant and get the same key.
      expect(bucketDateKey(new Date(instant), g)).toBe(expected[g]);
      expect(bucketDateKey(Date.parse(instant), g)).toBe(expected[g]);
    });
  });

  it('a `date` value, the bare `YYYY-MM-DD` form, keys like its midnight', () => {
    expect(bucketDateKey('0050-06-15', 'day')).toBe('0050-06-15');
    expect(bucketDateKey('0050-06-15', 'month')).toBe('0050-06');
    expect(bucketDateKey('0999-12-31', 'year')).toBe('0999');
  });

  it('the week year of a reference zone is four digits too', () => {
    // Sunday 0050-01-02 in UTC is Monday 0050-01-03 in Shanghai: week 1 of 0050.
    const instant = '0050-01-02T20:00:00.000Z';
    expect(bucketDateKey(instant, 'week')).toBe('0049-W52');
    expect(bucketDateKey(instant, 'week', 'Asia/Shanghai')).toBe('0050-W01');
    expect(bucketDateKey(instant, 'day', 'Asia/Shanghai')).toBe('0050-01-03');
  });
});

describe('[#20760] bucketKeyToCalendarRange reads exactly what bucketDateKey writes', () => {
  describe.each(KEYS)('the keys of %s', (instant, expected) => {
    it.each(GRANULARITIES)('at %s span a range whose first day keys back to it', (g) => {
      const range = bucketKeyToCalendarRange(expected[g], g);
      expect(range).not.toBeNull();
      expect(bucketDateKey(range!.start, g)).toBe(expected[g]);
      expect(range!.start <= instant.slice(0, 10) && instant.slice(0, 10) < range!.end).toBe(true);
    });
  });

  it.each([
    // A drill-down from the padded week key a SQL driver answers.
    ['0050-W01', '0050-01-03', '0050-01-10'],
    // The ISO week-year boundary: the week runs into January 0050.
    ['0049-W52', '0049-12-27', '0050-01-03'],
    ['0999-W24', '0999-06-10', '0999-06-17'],
    // The control.
    ['2026-W01', '2025-12-29', '2026-01-05'],
  ])('week %s is %s up to %s', (key, start, end) => {
    expect(bucketKeyToCalendarRange(key, 'week')).toEqual({ start, end });
  });

  it.each([
    ['50', 'year'],
    ['50-Q2', 'quarter'],
    ['50-06', 'month'],
    ['50-06-15', 'day'],
    ['49-W52', 'week'],
    ['999-W24', 'week'],
  ] as const)('does not read the unpadded spelling %s (%s): nothing writes it', (key, g) => {
    expect(bucketKeyToCalendarRange(key, g)).toBeNull();
  });
});

describe('[#20760] a year outside 0000..9999 has no four-digit form, and is not padded into one', () => {
  // Not reached: at both engine doors a `date` value names a year from 0001 to
  // 9999 and a `datetime` one a year from 1000 to 9999. Stated so a negative
  // year is never spelled as a padded fragment (`00-1`) that reads as a key.
  const inYear = (year: number) => {
    const d = new Date(0);
    d.setUTCFullYear(year, 5, 15);
    return d;
  };

  it.each([
    [-1, '-1', '-1-06-15'],
    [10000, '10000', '10000-06-15'],
  ])('year %i keys as %s and %s, and no range reads it', (year, yearKey, dayKey) => {
    expect(bucketDateKey(inYear(year), 'year')).toBe(yearKey);
    expect(bucketDateKey(inYear(year), 'day')).toBe(dayKey);
    expect(bucketKeyToCalendarRange(yearKey, 'year')).toBeNull();
    expect(bucketKeyToCalendarRange(dayKey, 'day')).toBeNull();
  });
});
