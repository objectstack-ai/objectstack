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

  // [#20480] A wall clock has no year, but a `time` column reads a number or a
  // `Date` as an INSTANT and keeps its UTC time of day — and the rule keeps one
  // only when the instant's UTC year has a four-digit spelling. Year 0 does
  // (`0000-…`), so its time of day is read; year 10000, year -1 and the Date
  // range's extremes do not, and the rule handed them back unchanged — a
  // number compared with `HH:MM:SS` text. Those are refused now; this pin
  // asserted all of them read before.
  it('[#20480] a time column reads the time of day of every instant with a four-digit UTC year, and refuses the rest', () => {
    const YEAR_0 = new Set(['[#20264] the first millisecond of year 0', '[#20264] the last millisecond of year 0']);
    for (const [name, ms] of [...OUT_OF_RANGE, ...PAST_THE_DATE_RANGE, ...IN_RANGE]) {
      const spelled = temporalStorageForm(ms, 'time');
      const keeps = typeof spelled === 'string' && /^\d{2}:\d{2}:\d{2}(\.\d{3})?$/.test(spelled);
      const expected = !(IN_RANGE.some(([n]) => n === name) || YEAR_0.has(name));
      expect(keeps, `the rule keeps a time of day for ${name}`).toBe(!expected);
      expect(isUninterpretableTemporalComparand('time', ms), `number, ${name}`).toBe(expected);
      if (Number.isFinite(new Date(ms).getTime())) {
        expect(isUninterpretableTemporalComparand('time', new Date(ms)), `Date, ${name}`).toBe(expected);
      }
    }
  });

  it('does not judge NaN, ±Infinity or an Invalid Date — they name no instant and no year', () => {
    for (const kind of ['date', 'datetime', 'time'] as const) {
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
    // [#20549] The 2026 epoch-millisecond control is a NUMBER now: as a
    // string it is refused with every other bare integer string (below).
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
    expect(isUninterpretableTemporalComparand('datetime', 1769940000000), 'epoch milliseconds for 2026, a number').toBe(false);
  });
  it('a time column judges no year — its rule keeps a time of day', () => {
    expect(isUninterpretableTemporalComparand('time', '0000-06-15T10:00:00.000Z')).toBe(false);
    expect(isUninterpretableTemporalComparand('time', '10:00')).toBe(false);
  });
});

// [#20549] The write door (the record validator) refuses a string whose
// leading `YYYY-MM-DD` names a day that does not exist, and a `datetime`
// string outside the ISO 8601 spellings the platform writes. The comparand
// door was wider: measured under TZ=America/New_York on driver-memory, SQLite
// and PostgreSQL 16, `datetime $eq "2026-02-30T10:00:00Z"` matched the row
// stored at 2026-03-02T10:00Z (rolled over), `"07/15/2026 10:00"` matched
// 2026-07-15T14:00Z (the process zone), and `date $eq "2026-02-30"` answered
// 200 [] on memory and SQLite and 500 on PostgreSQL. The two predicates moved
// here from the validator, which now asks this function, so one rule answers
// both doors.
describe('[#20549] isUninterpretableTemporalComparand — a real calendar day, and an ISO spelling for a datetime', () => {
  const IMPOSSIBLE_DAYS = ['2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-06-00', '2100-02-29'];

  it('refuses a leading day that does not exist — on a date, and as the day part of a datetime', () => {
    for (const day of IMPOSSIBLE_DAYS) {
      expect(isUninterpretableTemporalComparand('date', day), `date ${day}`).toBe(true);
      expect(isUninterpretableTemporalComparand('date', `${day}T10:00:00Z`), `date ${day}T10:00:00Z`).toBe(true);
      expect(isUninterpretableTemporalComparand('datetime', day), `datetime ${day}`).toBe(true);
      expect(isUninterpretableTemporalComparand('datetime', `${day}T10:00:00Z`), `datetime ${day}T10:00:00Z`).toBe(true);
      expect(isUninterpretableTemporalComparand('datetime', `${day} 10:00`), `datetime ${day} 10:00`).toBe(true);
    }
  });

  it('reads every real day beside them — the leap days and the month ends, the discriminating half', () => {
    for (const day of ['2028-02-29', '2000-02-29', '2026-02-28', '2026-04-30', '2026-12-31', '0004-02-29', '2026-01-01']) {
      expect(isUninterpretableTemporalComparand('date', day), `date ${day}`).toBe(false);
      expect(isUninterpretableTemporalComparand('datetime', day), `datetime ${day}`).toBe(false);
      expect(isUninterpretableTemporalComparand('datetime', `${day}T10:00:00Z`), `datetime ${day}T10:00:00Z`).toBe(false);
    }
  });

  it('refuses a datetime string outside the ISO spellings — each one Date.parse reads', () => {
    const NOT_ISO = [
      '07/15/2026 10:00', '2026/07/15 10:00', '15 July 2026 10:00', '07/08/2026',
      'Wed, 15 Jul 2026 10:00:00 GMT', '2026-07-15 10:00 PM', '2026-07-15t10:00:00z',
      '2026-07-15 10:00:00+08:00', '2026-07-15 10:00Z', '+002026-07-15T10:00:00Z', '2026-07', '2026-7-15',
      // A bare integer string: epoch milliseconds to the rule, a year to its author.
      '2026', '1769940000000', '-1',
    ];
    for (const value of NOT_ISO) {
      expect(Number.isFinite(Date.parse(value)) || /^-?\d+$/.test(value), `the control: ${value} is read by someone`).toBe(true);
      expect(isUninterpretableTemporalComparand('datetime', value), value).toBe(true);
    }
  });

  it('reads each ISO spelling the write door writes, the same instant in every host zone — the discriminating half', () => {
    const ISO = [
      '2026-07-15', '2026-07-15T10:00', '2026-07-15T10:00:00', '2026-07-15T10:00:00.123',
      '2026-07-15T10:00:00Z', '2026-07-15T10:00:00.000Z', '2026-07-15T10:00:00.123456Z',
      '2026-07-15T18:00:00+08:00', '2026-07-15T18:00:00+0800', '2026-07-15T05:00:00-05:00',
      '2026-07-15 10:00', '2026-07-15 10:00:00', '2026-07-15 10:00:00.5', '  2026-07-15T10:00:00Z  ',
    ];
    for (const value of ISO) {
      expect(isUninterpretableTemporalComparand('datetime', value), value).toBe(false);
    }
  });

  it('still refuses what the grammar admits but no clock reads', () => {
    for (const value of ['2026-07-15T25:00:00Z', '2026-07-15T10:60:00Z', '2026-07-15T10:00:00+99:99']) {
      expect(isUninterpretableTemporalComparand('datetime', value), value).toBe(true);
    }
  });

  it('leaves a date column\'s own reading alone: a real leading day, whatever follows it', () => {
    // The `date` rule collapses a leading day, so an instant on a real day is
    // that day (#20481); only the day's existence is new.
    for (const value of ['2026-07-15T10:00:00Z', '2026-07-15 10:00', '2026-07-15T10:00:00+08:00']) {
      expect(isUninterpretableTemporalComparand('date', value), value).toBe(false);
    }
    expect(isUninterpretableTemporalComparand('date', '2026/07/15'), 'the #20481 shape, as before').toBe(true);
  });

  it('an instant on a time column is read by the datetime rule, so the same two classes are refused there', () => {
    for (const value of ['07/15/2026 10:00', '2026/07/15 10:00', '2026-02-30T10:00:00Z', '1784109600000', 'Wed, 15 Jul 2026 10:00:00 GMT']) {
      expect(isUninterpretableTemporalComparand('time', value), value).toBe(true);
    }
    // The wall clocks and the ISO instants beside them — the discriminating half.
    for (const value of ['10:00', '10:00:00', '10:00:00.5', '2026-07-15T10:00:00Z', '2026-07-15T18:00:00+08:00', '2026-07-15 10:00']) {
      expect(isUninterpretableTemporalComparand('time', value), value).toBe(false);
    }
    expect(isUninterpretableTemporalComparand('time', Date.UTC(2026, 6, 15, 10)), 'epoch milliseconds as a number').toBe(false);
  });

  it('keeps the comparand-only exemptions and the non-string readings', () => {
    for (const kind of ['date', 'datetime'] as const) {
      expect(isUninterpretableTemporalComparand(kind, ''), `${kind} empty`).toBe(false);
      expect(isUninterpretableTemporalComparand(kind, '   '), `${kind} blank`).toBe(false);
      expect(isUninterpretableTemporalComparand(kind, '{today}'), `${kind} placeholder`).toBe(false);
      expect(isUninterpretableTemporalComparand(kind, 1769940000000), `${kind} epoch-ms number`).toBe(false);
      expect(isUninterpretableTemporalComparand(kind, new Date(Date.UTC(2026, 1, 28))), `${kind} Date`).toBe(false);
    }
  });
});

// [#20480] The `time` half of the one temporal rule. A `time` comparand that
// is not a bare wall clock is read as an INSTANT by the `datetime` rule and
// keeps its UTC time of day — only when that instant's UTC year has a
// four-digit spelling. `+010000-01-01T10:00:00Z` passed this door (`Date.parse`
// reads it) and came back from the rule unchanged, so the driver compared it
// as text: `$gt` answered 3 of 3 rows on memory and SQLite, and PostgreSQL
// answered 500. The same instant spelled with four digits in its own zone
// (`9999-12-31T23:00:00-02:00`), as a number or as a `Date` answered 0 or 3
// by driver. Every spelling is refused now; no time of day is read from an
// extended year.
describe('[#20480] isUninterpretableTemporalComparand — a time column\'s instant outside the four-digit years', () => {
  const Y10000_10 = Date.parse('+010000-01-01T10:00:00Z');
  const YNEG1_10 = Date.parse('-000001-01-01T10:00:00Z');

  it('refuses the card\'s spelling and every other spelling of an instant the rule keeps no time of day for', () => {
    for (const value of [
      '+010000-01-01T10:00:00Z',          // the card's comparand
      '-000001-01-01T10:00:00Z',
      '9999-12-31T23:00:00-02:00',        // year 10000 in UTC
    ]) {
      expect(isUninterpretableTemporalComparand('time', value), value).toBe(true);
    }
    for (const value of [Y10000_10, YNEG1_10, new Date(Y10000_10), new Date(YNEG1_10), 8.64e15, -8.64e15, 8.64e15 + 1]) {
      expect(isUninterpretableTemporalComparand('time', value), String(value)).toBe(true);
    }
  });

  it('reads the time of day of the same wall clock in a four-digit year — the 2026 control and the year edges', () => {
    for (const value of [
      '2026-01-01T10:00:00Z', '2026-01-01T10:00:00.000Z', '2026-01-01T18:00:00+08:00',
      '9999-12-31T10:00:00Z', '0001-01-01T10:00:00Z', '0000-06-15T10:00:00.000Z',
      Date.parse('2026-01-01T10:00:00Z'), new Date(Date.parse('2026-01-01T10:00:00Z')),
      Date.parse('0000-06-15T10:00:00Z'), new Date(Date.parse('9999-12-31T23:59:59.999Z')),
    ]) {
      expect(isUninterpretableTemporalComparand('time', value), String(value)).toBe(false);
      expect(temporalStorageForm(value, 'time'), `the rule keeps a time of day for ${String(value)}`).toMatch(/^\d{2}:\d{2}:\d{2}(\.\d{3})?$/);
    }
    for (const value of ['10:00', '10:00:00', '23:59:59.999']) {
      expect(isUninterpretableTemporalComparand('time', value), value).toBe(false);
    }
  });

  it('agrees with the rule: an instant is refused on a time column exactly when the rule hands it back unchanged', () => {
    for (const value of [
      '+010000-01-01T10:00:00Z', '9999-12-31T23:00:00-02:00', '2026-01-01T10:00:00Z', '0000-06-15T10:00:00.000Z',
      Y10000_10, YNEG1_10, Date.parse('2026-01-01T10:00:00Z'), 8.64e15, 8.64e15 + 1, -8.64e15,
    ]) {
      expect(isUninterpretableTemporalComparand('time', value), String(value)).toBe(temporalStorageForm(value, 'time') === value);
    }
  });
});
