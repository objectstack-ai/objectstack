// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `Field.time` gets a storage form on MongoDB — the D-C1 canon transplanted
 * (ADR-0053; the SQL original is #3994, the cross-driver twin for `datetime`
 * is #4047).
 *
 * The module's own canon table has declared `time` as `HH:MM:SS[.fff]` text
 * since #3994, but nothing implemented it: `TemporalFieldKind` was
 * `'datetime' | 'date'`, so `indexTemporalFields` never classified a time
 * column and `coerceTemporalValue` never touched one. A `time` field therefore
 * kept whatever each writer produced, and BSON compares across types by
 * bracket — so a text bound matched no `Date`-written row, in either
 * direction, for every operator. The shared conformance table measures the
 * result: 8 of its 9 cases returned only the text-written half of the fixture.
 *
 * `mongodb-temporal-conformance.test.ts` runs those cases against a real
 * server; this file pins the pure conversion, which needs no server and so
 * runs everywhere the suite does — including the environments where
 * `mongodb-memory-server` cannot fetch a binary and the conformance sweep
 * skips.
 */

import { describe, it, expect } from 'vitest';
import {
  coerceTemporalValue,
  indexTemporalFields,
  storageTimeValue,
} from './mongodb-temporal.js';

describe('storageTimeValue — the canonical wall clock (D-C1)', () => {
  it('keeps a canonical value byte-identical', () => {
    expect(storageTimeValue('09:00:00')).toBe('09:00:00');
    expect(storageTimeValue('14:30:00.500')).toBe('14:30:00.500');
    expect(storageTimeValue('23:59:59.999')).toBe('23:59:59.999');
  });

  it('completes a minutes-only wall clock so one time has one spelling', () => {
    // Determinism is what equality and distinct() rest on.
    expect(storageTimeValue('14:30')).toBe('14:30:00');
  });

  it('drops a zero-millisecond suffix to the native TIME spelling', () => {
    expect(storageTimeValue('14:30:00.000')).toBe('14:30:00');
  });

  it('truncates sub-millisecond precision rather than rounding it', () => {
    // Matches `Date` resolution, and rounding would move the stored wall clock
    // — the defect MySQL's bare TIME had (#3994).
    expect(storageTimeValue('14:30:00.5009')).toBe('14:30:00.500');
  });

  it('folds a Date to its UTC time-of-day, not the host zone', () => {
    // The pg failure this mirrors: a bound Date serialised in the process's
    // local zone, so the stored wall clock depended on the host's TZ.
    expect(storageTimeValue(new Date('1970-01-01T14:30:00.500Z'))).toBe('14:30:00.500');
    expect(storageTimeValue(new Date('2026-07-28T09:00:00.000Z'))).toBe('09:00:00');
    expect(storageTimeValue(new Date('1970-01-01T00:00:00.000Z'))).toBe('00:00:00');
  });

  it('folds epoch ms and a full ISO string the same way', () => {
    expect(storageTimeValue(Date.parse('1970-01-01T18:00:00.000Z'))).toBe('18:00:00');
    expect(storageTimeValue('2026-07-28T23:59:59.999Z')).toBe('23:59:59.999');
  });

  it('is total: uninterpretable input passes through untouched', () => {
    // Never silently rewritten — junk keeps failing the comparison instead of
    // becoming a plausible wrong wall clock.
    expect(storageTimeValue('25:00')).toBe('25:00');
    expect(storageTimeValue('12:60:00')).toBe('12:60:00');
    expect(storageTimeValue('not a time')).toBe('not a time');
    expect(storageTimeValue('')).toBe('');
    expect(storageTimeValue(null)).toBeNull();
    expect(storageTimeValue(undefined)).toBeUndefined();
  });

  it('orders chronologically under plain string comparison across both widths', () => {
    // The property the whole variable-width canon rests on: `.` sorts below
    // every digit, which is what makes a range filter correct on a text column.
    const sorted = ['14:30:01', '14:30:00.100', '14:30:00', '09:00:00']
      .map((v) => storageTimeValue(v) as string)
      .sort();
    expect(sorted).toEqual(['09:00:00', '14:30:00', '14:30:00.100', '14:30:01']);
  });
});

describe('the time kind reaches the coercion seam', () => {
  it('classifies a declared time field', () => {
    const kinds = indexTemporalFields({
      at: { type: 'time' },
      when: { type: 'datetime' },
      on: { type: 'date' },
      name: { type: 'string' },
    });
    expect(kinds.get('at')).toBe('time');
    expect(kinds.get('when')).toBe('datetime');
    expect(kinds.get('on')).toBe('date');
    expect(kinds.has('name')).toBe(false);
  });

  it('coerces a time comparand — including every element of an $in set', () => {
    expect(coerceTemporalValue(new Date('1970-01-01T09:00:00Z'), 'time')).toBe('09:00:00');
    expect(coerceTemporalValue(['14:30', new Date('1970-01-01T18:00:00Z')], 'time')).toEqual([
      '14:30:00',
      '18:00:00',
    ]);
  });

  it('leaves an undeclared field alone — the driver never guesses from a value', () => {
    const value = new Date('1970-01-01T09:00:00Z');
    expect(coerceTemporalValue(value, undefined)).toBe(value);
  });
});
