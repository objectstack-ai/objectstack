// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20240] `isUninterpretableTemporalComparand` on a `date` column judges one
// non-string class: a finite number or a `Date` whose UTC calendar day falls in
// a year below 0 or above 9999. Such a day has no `YYYY-MM-DD` spelling, so the
// storage rule's text for it (`10000-01-01`, `-1-01-01`) orders as no day does.
// Measured over REST before this, the number for 10000-01-01 counted `$gt` 6 /
// `$lt` 1 on driver-memory and SQLite (the day's answer is 0 / 7) and the
// number for -1-01-01 answered 500 on PostgreSQL, while the ISO string of either
// instant was already refused `INVALID_FILTER` / 400. The door that calls this
// predicate (`@objectstack/objectql`, `temporal-comparand-door.ts`) now refuses
// the number and the `Date` too; its own suite pins the envelope.
//
// [#20264] The range is 0001..9999 (triage's ruling on that card), on `date`
// AND `datetime`: year 0 joins the refused years — PostgreSQL's `DATE` and
// `timestamptz` have no year 0 — and a `datetime` number, `Date` or string
// outside the range is refused as the `date` one is. `time` has no year.

import { describe, it, expect } from 'vitest';
import { isUninterpretableTemporalComparand } from './temporal-comparand.js';
import { temporalStorageForm } from './temporal-storage-form.js';

const at = (iso: string) => Date.parse(iso);

/** Finite numbers whose UTC calendar day falls outside the four-digit years. */
const OUT_OF_RANGE: ReadonlyArray<readonly [string, number]> = [
  ['the first day of year 10000', 253402300800000],
  ['year -1 (the card\'s number)', -62198755200000],
  ['the last millisecond of year -1', at('-000001-12-31T23:59:59.999Z')],
  ['[#20264] the first millisecond of year 0', at('0000-01-01T00:00:00.000Z')],
  ['[#20264] the last millisecond of year 0', at('0000-12-31T23:59:59.999Z')],
  ['the Date range maximum', 8.64e15],
  ['the Date range minimum', -8.64e15],
];

/** Numbers past the `Date` range — an instant with a year past ±271821. */
const PAST_THE_DATE_RANGE: ReadonlyArray<readonly [string, number]> = [
  ['one past the maximum', 8.64e15 + 1],
  ['one before the minimum', -8.64e15 - 1],
  ['9e15', 9e15],
  ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
];

/** Finite numbers whose UTC calendar day has a four-digit year — read as before. */
const IN_RANGE: ReadonlyArray<readonly [string, number]> = [
  ['[#20264] the first millisecond of year 1', at('0001-01-01T00:00:00.000Z')],
  ['0999-06-15', -30627504000000],
  ['1000-01-01', at('1000-01-01T00:00:00.000Z')],
  ['2026-02-01T10:00Z', 1769940000000],
  ['the epoch', 0],
  ['the last millisecond of year 9999', at('9999-12-31T23:59:59.999Z')],
];

describe('[#20240] isUninterpretableTemporalComparand — a date column\'s number or Date outside the four-digit years', () => {
  it('refuses a number and the Date of the same value, for a year below 0001 or above 9999', () => {
    for (const [name, ms] of OUT_OF_RANGE) {
      expect(isUninterpretableTemporalComparand('date', ms), `number, ${name}`).toBe(true);
      expect(isUninterpretableTemporalComparand('date', new Date(ms)), `Date, ${name}`).toBe(true);
    }
  });

  it('refuses a finite number past the Date range — its year is past ±271821', () => {
    for (const [name, ms] of PAST_THE_DATE_RANGE) {
      expect(isUninterpretableTemporalComparand('date', ms), name).toBe(true);
    }
  });

  it('reads every number and Date whose year has four digits, as before — the discriminating half', () => {
    for (const [name, ms] of IN_RANGE) {
      expect(isUninterpretableTemporalComparand('date', ms), `number, ${name}`).toBe(false);
      expect(isUninterpretableTemporalComparand('date', new Date(ms)), `Date, ${name}`).toBe(false);
    }
  });

  it('agrees with the rule: a finite number is refused exactly when the rule cannot spell it YYYY-MM-DD', () => {
    for (const [name, ms] of [...OUT_OF_RANGE, ...PAST_THE_DATE_RANGE, ...IN_RANGE]) {
      const spelled = temporalStorageForm(ms, 'date');
      const isDay = typeof spelled === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(spelled);
      expect(isUninterpretableTemporalComparand('date', ms), name).toBe(!isDay);
    }
  });

  it('joins the verdict the ISO string of the same instant already had', () => {
    // The string arm refused these before this card; the number and the Date
    // were the two spellings of the same instant it let through.
    expect(isUninterpretableTemporalComparand('date', '+010000-01-01T00:00:00.000Z')).toBe(true);
    expect(isUninterpretableTemporalComparand('date', '-000001-01-01T00:00:00.000Z')).toBe(true);
    expect(isUninterpretableTemporalComparand('date', '0999-06-15T00:00:00.000Z')).toBe(false);
    expect(isUninterpretableTemporalComparand('date', '0999-06-15')).toBe(false);
    // [#20264] Year 0 in its string spellings, beside the first supported day.
    expect(isUninterpretableTemporalComparand('date', '0000-06-15')).toBe(true);
    expect(isUninterpretableTemporalComparand('date', '0000-06-15T00:00:00.000Z')).toBe(true);
    expect(isUninterpretableTemporalComparand('date', '0001-01-01')).toBe(false);
  });

  it('[#20264] judges a datetime number or Date by the same years — the rule reads it, but its year is outside', () => {
    for (const [name, ms] of [...OUT_OF_RANGE, ...PAST_THE_DATE_RANGE]) {
      expect(isUninterpretableTemporalComparand('datetime', ms), `number, ${name}`).toBe(true);
      if (Number.isFinite(new Date(ms).getTime())) {
        expect(isUninterpretableTemporalComparand('datetime', new Date(ms)), `Date, ${name}`).toBe(true);
      }
    }
    for (const [name, ms] of IN_RANGE) {
      expect(isUninterpretableTemporalComparand('datetime', ms), `number, ${name}`).toBe(false);
      expect(isUninterpretableTemporalComparand('datetime', new Date(ms)), `Date, ${name}`).toBe(false);
    }
  });

  it('leaves the time rule alone — a wall clock has no year', () => {
    for (const [name, ms] of [...OUT_OF_RANGE, ...PAST_THE_DATE_RANGE, ...IN_RANGE]) {
      expect(isUninterpretableTemporalComparand('time', ms), `number, ${name}`).toBe(false);
      expect(isUninterpretableTemporalComparand('time', new Date(ms)), `Date, ${name}`).toBe(false);
    }
  });

  it('does not judge NaN, ±Infinity or an Invalid Date — they name no instant and no year', () => {
    for (const kind of ['date', 'datetime'] as const) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, new Date(Number.NaN)]) {
        expect(isUninterpretableTemporalComparand(kind, value), `${kind} ${String(value)}`).toBe(false);
      }
    }
  });

  it('judges nothing else that is not a string, as before', () => {
    for (const value of [null, undefined, true, 1769940000000n, Object(1769940000000), {}, ['2026-02-01']]) {
      expect(isUninterpretableTemporalComparand('date', value), String(value)).toBe(false);
    }
  });
});

// [#20264] The `datetime` rule reads an extended-year ISO string, a negative
// year and year 0 because `Date.parse` does, and spells them `+010000-…`,
// `-000001-…` and `0000-…`. The first two sort below every four-digit year as
// text, so a `where` on a `datetime` field counted `$gt` / `$lt` / `$eq`
// 7 / 0 / 0 on driver-memory and SQLite for a bound in year 10000 (the right
// answer is 0 / 7 / 0), and PostgreSQL answered 500 (`22009`, `22007`) for
// them and for year 0 (`22008`). Each is now uninterpretable, beside the same
// instant a millisecond inside the range.
describe('[#20264] isUninterpretableTemporalComparand — a datetime string outside the years 0001 to 9999', () => {
  const REFUSED: ReadonlyArray<readonly [string, string]> = [
    ['the extended ISO spelling of year 10000', '+010000-01-01T00:00:00.000Z'],
    ['a bare extended day', '10000-01-01'],
    ['the extended ISO spelling of year -1', '-000001-01-01T00:00:00.000Z'],
    ['year 0, ISO', '0000-06-15T00:00:00.000Z'],
    ['year 0, a bare day (read as midnight UTC)', '0000-06-15'],
    ['year 0, zone-naive (read as UTC)', '0000-06-15 10:00'],
    ['year 9999 in its zone, year 10000 in UTC', '9999-12-31T23:59:59-01:00'],
    ['year 1 in its zone, year 0 in UTC', '0001-01-01T00:00:00+08:00'],
    ['epoch milliseconds for year 10000, as a string', '253402300800000'],
  ];
  const READ: ReadonlyArray<readonly [string, string]> = [
    ['the first instant of year 1', '0001-01-01T00:00:00.000Z'],
    ['the last instant of year 9999', '9999-12-31T23:59:59.999Z'],
    ['year 1, a bare day', '0001-01-01'],
    ['year 0099 — inside the range', '0099-03-04T10:00:00.000Z'],
    ['a 2026 instant (the control)', '2026-02-01T10:00:00.000Z'],
    ['a 2026 zone-naive timestamp (the control)', '2026-02-01 10:00'],
    ['epoch milliseconds for 2026, as a string (the control)', '1769940000000'],
  ];
  it('refuses each, on datetime and on date', () => {
    for (const [name, value] of REFUSED) {
      expect(isUninterpretableTemporalComparand('datetime', value), name).toBe(true);
    }
    for (const value of ['+010000-01-01T00:00:00.000Z', '-000001-01-01T00:00:00.000Z', '0000-06-15']) {
      expect(isUninterpretableTemporalComparand('date', value), value).toBe(true);
    }
  });
  it('reads every instant inside the range, as before — the discriminating half', () => {
    for (const [name, value] of READ) {
      expect(isUninterpretableTemporalComparand('datetime', value), name).toBe(false);
    }
  });
  it('a time column judges no year — its rule keeps a time of day', () => {
    expect(isUninterpretableTemporalComparand('time', '0000-06-15T10:00:00.000Z')).toBe(false);
    expect(isUninterpretableTemporalComparand('time', '10:00')).toBe(false);
  });
});
