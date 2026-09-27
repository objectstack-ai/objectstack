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

import { describe, it, expect } from 'vitest';
import { isUninterpretableTemporalComparand } from './temporal-comparand.js';
import { temporalStorageForm } from './temporal-storage-form.js';

const at = (iso: string) => Date.parse(iso);

/** Finite numbers whose UTC calendar day falls outside the four-digit years. */
const OUT_OF_RANGE: ReadonlyArray<readonly [string, number]> = [
  ['the first day of year 10000', 253402300800000],
  ['year -1 (the card\'s number)', -62198755200000],
  ['the last millisecond of year -1', at('-000001-12-31T23:59:59.999Z')],
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
  ['the first millisecond of year 0', at('0000-01-01T00:00:00.000Z')],
  ['0999-06-15', -30627504000000],
  ['1000-01-01', at('1000-01-01T00:00:00.000Z')],
  ['2026-02-01T10:00Z', 1769940000000],
  ['the epoch', 0],
  ['the last millisecond of year 9999', at('9999-12-31T23:59:59.999Z')],
];

describe('[#20240] isUninterpretableTemporalComparand — a date column\'s number or Date outside the four-digit years', () => {
  it('refuses a number and the Date of the same value, for a year below 0 or above 9999', () => {
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
  });

  it('leaves the datetime and time rules alone — they read an instant', () => {
    for (const kind of ['datetime', 'time'] as const) {
      for (const [name, ms] of [...OUT_OF_RANGE, ...PAST_THE_DATE_RANGE, ...IN_RANGE]) {
        expect(isUninterpretableTemporalComparand(kind, ms), `${kind}, number, ${name}`).toBe(false);
        expect(isUninterpretableTemporalComparand(kind, new Date(ms)), `${kind}, Date, ${name}`).toBe(false);
      }
    }
  });

  it('does not judge NaN, ±Infinity or an Invalid Date — they name no instant and no year', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, new Date(Number.NaN)]) {
      expect(isUninterpretableTemporalComparand('date', value), String(value)).toBe(false);
    }
  });

  it('judges nothing else that is not a string, as before', () => {
    for (const value of [null, undefined, true, 1769940000000n, Object(1769940000000), {}, ['2026-02-01']]) {
      expect(isUninterpretableTemporalComparand('date', value), String(value)).toBe(false);
    }
  });
});
