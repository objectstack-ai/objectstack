// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20176] `temporalStorageForm` — the ONE storage rule a temporal comparand is
// put in before it is compared: by `driver-sql` and `driver-memory` on `where`
// (and on write), and by `@objectstack/objectql` on a per-aggregation `filter`
// and `having`. Each driver carried a word-for-word copy until it was lifted
// here; the drivers' own suites pin that their `where` coercion IS this
// function (`memory-temporal-storage-form.test.ts`,
// `sql-driver-temporal-storage-form.test.ts`). This file pins the rule itself.

import { describe, it, expect } from 'vitest';
import { SUPPORTED_TEMPORAL_YEARS, isOutsideTemporalYearRange, temporalStorageForm } from './temporal-storage-form.js';

describe('temporalStorageForm — datetime: canonical UTC ISO text', () => {
  const cases: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['a Date', new Date('2026-02-01T10:00:00.000Z'), '2026-02-01T10:00:00.000Z'],
    ['epoch milliseconds', 1769940000000, '2026-02-01T10:00:00.000Z'],
    ['an epoch-millisecond string, padded', ' 1769940000000 ', '2026-02-01T10:00:00.000Z'],
    ['a negative epoch string', '-86400000', '1969-12-31T00:00:00.000Z'],
    ['a bare day — midnight UTC, never the host zone', '2026-02-01', '2026-02-01T00:00:00.000Z'],
    ['a zone-naive wall clock — read AS UTC', '2026-02-01 09:00', '2026-02-01T09:00:00.000Z'],
    ['a zone-naive T spelling with a long fraction', '2026-02-01T09:00:00.123456', '2026-02-01T09:00:00.123Z'],
    ['an ISO instant without milliseconds', '2026-02-01T10:00:00Z', '2026-02-01T10:00:00.000Z'],
    ['an offset instant — re-spelled in Z', '2026-02-01T18:00:00+08:00', '2026-02-01T10:00:00.000Z'],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => expect(temporalStorageForm(input, 'datetime')).toBe(expected));
  }
});

describe('temporalStorageForm — date: the UTC calendar day', () => {
  const cases: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['an ISO instant — its leading day', '2026-02-01T00:00:00.000Z', '2026-02-01'],
    ['a Date carrying a time of day — its UTC day', new Date('2026-02-01T23:30:00.000Z'), '2026-02-01'],
    ['a bare day, padded', '  2026-02-01  ', '2026-02-01'],
    ['a zone-naive timestamp', '2026-02-01 23:59', '2026-02-01'],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => expect(temporalStorageForm(input, 'date')).toBe(expected));
  }

});

// [#20203] An epoch-millisecond NUMBER on a `date` column used to come back
// unchanged, so each face compared it by its own type rules: driver-memory
// matched no row, SQLite ordered it below every date text (6 of 6 for `$gt`)
// and PostgreSQL refused the bind (`22008`, a 500 at REST). It is now read as
// the `datetime` rule reads it — an instant — and takes that instant's UTC
// calendar day, the reading a `Date` of the same value already had.
describe('temporalStorageForm — date: an epoch-ms number is the UTC calendar day of its instant', () => {
  const cases: ReadonlyArray<readonly [string, number, string]> = [
    ['a time of day is dropped, never rounded', 1769940000000, '2026-02-01'], // 2026-02-01T10:00Z
    ['a UTC midnight', 1769904000000, '2026-02-01'],
    ['the last millisecond of a UTC day', 1769990399999, '2026-02-01'],
    ['the epoch', 0, '1970-01-01'],
    ['-0', -0, '1970-01-01'],
    ['a negative number — a day before the epoch', -86400000, '1969-12-31'],
    ['one millisecond before the epoch', -1, '1969-12-31'],
    ['a fraction is truncated toward zero, as the Date constructor does', 1769990399999.9, '2026-02-01'],
    ['a negative fraction truncates toward zero too', -0.5, '1970-01-01'],
    ['the Date range maximum', 8.64e15, '275760-09-13'],
    ['the Date range minimum', -8.64e15, '-271821-04-20'],
  ];
  for (const [name, input, expected] of cases) {
    it(`${name}: ${input} → ${expected}`, () => expect(temporalStorageForm(input, 'date')).toBe(expected));
  }

  it('a number and the Date of the same value always agree', () => {
    for (const [, input] of cases) {
      expect(temporalStorageForm(input, 'date'), String(input)).toBe(temporalStorageForm(new Date(input), 'date'));
    }
  });

  it('…and name the calendar day of the datetime rule\'s instant for the same number', () => {
    for (const input of [1769940000000, 1769904000000, 0, -1, -86400000, 253402300799999]) {
      expect(temporalStorageForm(input, 'date'), String(input))
        .toBe((temporalStorageForm(input, 'datetime') as string).slice(0, 10));
    }
  });

  const untouched: ReadonlyArray<readonly [string, unknown]> = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['past the Date range', 8.64e15 + 1],
    ['before the Date range', -8.64e15 - 1],
    ['a bigint — not a number', 1769940000000n],
    ['a boxed Number — not a number', Object(1769940000000)],
    ['an epoch-ms STRING — not a leading calendar day, unchanged as before', '1769940000000'],
  ];
  for (const [name, input] of untouched) {
    it(`${name} comes back unchanged`, () => expect(temporalStorageForm(input, 'date')).toBe(input));
  }
});

// [#20240] A `Date` or a number whose UTC year is 0..999 spelled that year
// unpadded — `999-06-15` — while the ISO-string and bare-day arms spelled the
// same day `0999-06-15`. As text `999-…` sorts above every padded day
// (`'9' > '0'`), so over REST the number for 0999-06-15 counted `$gt` 0 /
// `$lt` 7 on driver-memory and SQLite where its ISO string counted 6 / 0. The
// year is now four digits. [#20264] The padding covers 0001..0999: a year
// outside 0001..9999 — year 0 included, which this block padded to `0000-…`
// before that card's ruling — has no `YYYY-MM-DD` form: it keeps its unpadded
// spelling (no ordered form is invented), and the doors refuse it.
describe('temporalStorageForm — date: the year of a Date or number is four digits', () => {
  const at = (iso: string) => Date.parse(iso);
  const cases: ReadonlyArray<readonly [string, number]> = [
    ['0999-06-15', -30627504000000],
    ['0099-03-04', at('0099-03-04T12:00:00.000Z')],
    ['0009-03-04', at('0009-03-04T00:00:00.000Z')],
    ['0001-01-01', at('0001-01-01T00:00:00.000Z')],
    ['1000-01-01', at('1000-01-01T00:00:00.000Z')], //   already four digits — unchanged
    ['9999-12-31', at('9999-12-31T23:59:59.999Z')], //   the last millisecond of year 9999
  ];
  for (const [day, ms] of cases) {
    it(`${day}: the number, its Date and its ISO string spell one day`, () => {
      expect(temporalStorageForm(ms, 'date')).toBe(day);
      expect(temporalStorageForm(new Date(ms), 'date')).toBe(day);
      expect(temporalStorageForm(new Date(ms).toISOString(), 'date')).toBe(day);
    });
  }

  it('the spellings sort as the days they name', () => {
    const spelled = cases.map(([, ms]) => temporalStorageForm(ms, 'date') as string);
    const chronological = [...cases].sort((a, b) => a[1] - b[1]).map(([day]) => day);
    expect([...spelled].sort()).toEqual(chronological);
  });

  it('a year outside 0001..9999 keeps its spelling — no ordered form is invented', () => {
    expect(temporalStorageForm(253402300800000, 'date')).toBe('10000-01-01');
    expect(temporalStorageForm(new Date(253402300800000), 'date')).toBe('10000-01-01');
    expect(temporalStorageForm(-62198755200000, 'date')).toBe('-1-01-01');
    expect(temporalStorageForm(at('-000001-12-31T23:59:59.999Z'), 'date')).toBe('-1-12-31');
    // [#20264] Year 0 is outside too: unpadded, where #20240 padded it `0000-…`.
    expect(temporalStorageForm(at('0000-06-15T00:00:00.000Z'), 'date')).toBe('0-06-15');
    expect(temporalStorageForm(new Date(at('0000-01-01T00:00:00.000Z')), 'date')).toBe('0-01-01');
  });

  it('[#20264] the datetime rule stays total — it spells a year outside the range as toISOString does', () => {
    // The doors refuse these; the write and read paths behind them are unchanged.
    expect(temporalStorageForm(253402300800000, 'datetime')).toBe('+010000-01-01T00:00:00.000Z');
    expect(temporalStorageForm('+010000-01-01T00:00:00.000Z', 'datetime')).toBe('+010000-01-01T00:00:00.000Z');
    expect(temporalStorageForm(-62198755200000, 'datetime')).toBe('-000001-01-01T00:00:00.000Z');
    expect(temporalStorageForm('0000-06-15', 'datetime')).toBe('0000-06-15T00:00:00.000Z');
  });
});

describe('temporalStorageForm — time: the UTC wall clock, .fff only when non-zero', () => {
  const cases: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['a short wall clock', '09:00', '09:00:00'],
    ['a zero-millisecond suffix is trimmed', '09:00:00.000', '09:00:00'],
    ['a fraction is kept to milliseconds', '09:00:00.5', '09:00:00.500'],
    ['a Date — its UTC time of day', new Date('2026-02-01T11:00:00.000Z'), '11:00:00'],
    ['an ISO instant — its UTC time of day', '2026-02-01T11:00:00.250Z', '11:00:00.250'],
    ['a bare day — its midnight', '2026-02-01', '00:00:00'],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => expect(temporalStorageForm(input, 'time')).toBe(expected));
  }
});

describe('temporalStorageForm — total: what the rule cannot read comes back unchanged', () => {
  const invalid = new Date('nope');
  const untouched: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['the empty string', ''],
    ['whitespace', '   '],
    ['junk', 'not-a-date'],
    ['a preset name', 'last_30_days'],
    ['a placeholder', '{today}'],
    ['a boolean', true],
    ['an Invalid Date', invalid],
    ['NaN', Number.NaN],
  ];
  for (const kind of ['datetime', 'date', 'time'] as const) {
    for (const [name, input] of untouched) {
      it(`${kind}: ${name}`, () => expect(temporalStorageForm(input, kind)).toBe(input));
    }
  }

  it('time: an out-of-range wall clock is not wrapped', () => {
    expect(temporalStorageForm('25:00', 'time')).toBe('25:00');
  });

  it('a list is NOT mapped — a caller comparing a list maps its members', () => {
    const list = ['2026-02-01', '2026-02-02'];
    expect(temporalStorageForm(list, 'datetime')).toBe(list);
  });
});

// [#20264] The supported years — a `date` 0001..9999, [#20280] a `datetime`
// 1000..9999 — the one range the temporal-comparand door (a comparand) and the
// record validator (a written value) both ask, so they cannot disagree about a
// year. The year is the one the kind's rule reads — a `date` string's leading
// day, otherwise the UTC year of the instant.
describe('[#20264] isOutsideTemporalYearRange — the years a date or datetime value may name', () => {
  const at = (iso: string) => Date.parse(iso);
  const OUTSIDE: ReadonlyArray<readonly [string, unknown, 'date' | 'datetime' | 'both']> = [
    ['year 10000, a number', at('+010000-01-01T00:00:00.000Z'), 'both'],
    ['year 10000, a Date', new Date(at('+010000-01-01T00:00:00.000Z')), 'both'],
    ['year 10000, the extended ISO string', '+010000-01-01T00:00:00.000Z', 'both'],
    ['year -1, the extended ISO string', '-000001-01-01T00:00:00.000Z', 'both'],
    ['year 0, a number', at('0000-06-15T00:00:00.000Z'), 'both'],
    ['year 0, a bare day', '0000-06-15', 'both'],
    ['year 0, an ISO instant', '0000-06-15T10:00:00.000Z', 'both'],
    ['a number past the Date range', 8.64e15 + 1, 'both'],
    ['year 10000 in UTC, 9999 in its zone', '9999-12-31T23:59:59-01:00', 'datetime'],
    ['year 0 in UTC, 1 in its zone', '0001-01-01T00:00:00+08:00', 'datetime'],
    ['epoch milliseconds for year 10000, as a string', '253402300800000', 'datetime'],
    // [#20280] A `datetime` before year 1000, MySQL's documented `DATETIME`
    // floor — in every spelling — where #20264 read these as inside.
    ['[#20280] the first instant of year 1, a number', at('0001-01-01T00:00:00.000Z'), 'datetime'],
    ['[#20280] the first instant of year 1, a Date', new Date(at('0001-01-01T00:00:00.000Z')), 'datetime'],
    ['[#20280] year 1, a bare day (midnight UTC)', '0001-01-01', 'datetime'],
    ['[#20280] year 0099, an ISO instant', '0099-03-04T10:00:00.000Z', 'datetime'],
    ['[#20280] the last instant of year 999, an ISO instant', '0999-12-31T23:59:59.999Z', 'datetime'],
    ['[#20280] the last instant of year 999, a number', at('0999-12-31T23:59:59.999Z'), 'datetime'],
    ['[#20280] year 999 in UTC, 1000 in its zone', '1000-01-01T00:00:00+08:00', 'datetime'],
  ];
  const INSIDE: ReadonlyArray<readonly [string, unknown, 'date' | 'datetime' | 'both']> = [
    ['the last instant of year 9999', new Date(at('9999-12-31T23:59:59.999Z')), 'both'],
    ['year 9999, a bare day', '9999-12-31', 'both'],
    ['a 2026 instant (the control)', '2026-02-01T10:00:00.000Z', 'both'],
    ['a 2026 number (the control)', 1769940000000, 'both'],
    // [#20280] The `datetime` floor's edge, in every spelling, on both kinds.
    ['the first instant of year 1000, a number', at('1000-01-01T00:00:00.000Z'), 'both'],
    ['the first instant of year 1000, a Date', new Date(at('1000-01-01T00:00:00.000Z')), 'both'],
    ['the first instant of year 1000, an ISO instant', '1000-01-01T00:00:00.000Z', 'both'],
    ['year 1000, a bare day', '1000-01-01', 'both'],
    ['year 1000 in UTC, 999 in its zone', '0999-12-31T23:00:00-02:00', 'both'],
    // A `date` keeps 0001..9999: the years before 1000 are the control the
    // `datetime` floor must not reach.
    ['the first instant of year 1', at('0001-01-01T00:00:00.000Z'), 'date'],
    ['year 1, a bare day', '0001-01-01', 'date'],
    ['year 0099', '0099-03-04T10:00:00.000Z', 'date'],
    ['year 0999, a bare day', '0999-12-31', 'date'],
    // A `date` takes a string's leading day, whatever instant the rest names.
    ['year 9999 in its leading day, 10000 as an instant', '9999-12-31T23:59:59-01:00', 'date'],
    ['year 1 in its leading day, 0 as an instant', '0001-01-01T00:00:00+08:00', 'date'],
    ['year 1000 in its leading day, 999 as an instant', '1000-01-01T00:00:00+08:00', 'date'],
  ];
  const kindsOf = (k: 'date' | 'datetime' | 'both') => (k === 'both' ? (['date', 'datetime'] as const) : [k]);

  it('is true for a year outside the kind\'s years, in every spelling the kind reads', () => {
    for (const [name, value, kinds] of OUTSIDE) {
      for (const kind of kindsOf(kinds)) expect(isOutsideTemporalYearRange(value, kind), `${kind}, ${name}`).toBe(true);
    }
  });

  it('is false for a year inside it, the edges and a 2026 control included', () => {
    for (const [name, value, kinds] of INSIDE) {
      for (const kind of kindsOf(kinds)) expect(isOutsideTemporalYearRange(value, kind), `${kind}, ${name}`).toBe(false);
    }
  });

  it('names no year for a time, or for a value that names no instant', () => {
    for (const value of [at('+010000-01-01T00:00:00.000Z'), '0000-06-15T10:00:00.000Z']) {
      expect(isOutsideTemporalYearRange(value, 'time')).toBe(false);
    }
    for (const kind of ['date', 'datetime'] as const) {
      for (const value of [null, undefined, '', '   ', 'not-a-date', '{today}', Number.NaN, Number.POSITIVE_INFINITY, new Date(Number.NaN), true, {}]) {
        expect(isOutsideTemporalYearRange(value, kind), `${kind} ${String(value)}`).toBe(false);
      }
    }
  });

  it('agrees with the date rule: a number or Date is outside exactly when the rule cannot spell it YYYY-MM-DD', () => {
    for (const [, value] of [...OUTSIDE, ...INSIDE]) {
      if (typeof value !== 'number' && !(value instanceof Date)) continue;
      const spelled = temporalStorageForm(value, 'date');
      const isDay = typeof spelled === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(spelled);
      expect(isOutsideTemporalYearRange(value, 'date'), String(value)).toBe(!isDay);
    }
  });
});

// [#20846] The exported range is the one the predicate judges by, so a refusal
// that names it (the record validator's and the import's sentence for a
// readable value in a year outside it) names the years the doors enforce: the
// first and last year of each kind are inside, the year before and the year
// after are outside, whatever the numbers are.
describe('[#20846] SUPPORTED_TEMPORAL_YEARS — the range isOutsideTemporalYearRange judges by', () => {
  const day = (year: number) => new Date(Date.UTC(2000, 5, 15)).setUTCFullYear(year);

  it.each(['date', 'datetime'] as const)('%s: its first and last years are inside, the years beside them outside', (kind) => {
    const { first, last } = SUPPORTED_TEMPORAL_YEARS[kind];
    expect(first).toBeLessThan(last);
    expect(isOutsideTemporalYearRange(day(first), kind), `${kind} ${first}`).toBe(false);
    expect(isOutsideTemporalYearRange(day(last), kind), `${kind} ${last}`).toBe(false);
    expect(isOutsideTemporalYearRange(day(first - 1), kind), `${kind} ${first - 1}`).toBe(true);
    expect(isOutsideTemporalYearRange(day(last + 1), kind), `${kind} ${last + 1}`).toBe(true);
  });

  it('is frozen: a caller cannot move the range the doors enforce', () => {
    expect(Object.isFrozen(SUPPORTED_TEMPORAL_YEARS)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_TEMPORAL_YEARS.date)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_TEMPORAL_YEARS.datetime)).toBe(true);
  });
});
