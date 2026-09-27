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
import { temporalStorageForm } from './temporal-storage-form.js';

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

  it('epoch milliseconds are not a calendar day — returned as they came', () => {
    expect(temporalStorageForm(1769940000000, 'date')).toBe(1769940000000);
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
