/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The native date/time control adapters in their `core` home (objectui#10625).
 *
 * They moved here from `@object-ui/fields` so `@object-ui/components`' data
 * table can share them; `fields` re-exports them and keeps its own suite
 * (`packages/fields/src/widgets/nativeDateValue.test.ts`, the objectui#3127
 * round trip) green through that re-export. This file pins what the table
 * relies on, through the package's PUBLIC entry: the four names are exported,
 * and a stored day that does not exist is never rolled on either side.
 *
 * Timezone-free by construction: a real datetime is judged by the instant it
 * reads back as, never by a hard-coded wall clock.
 */

import { describe, it, expect } from 'vitest';
import {
  toDateInputValue,
  toDateTimeInputValue,
  fromDateTimeInputValue,
  isImpossibleStoredDay,
} from '../../index';

const localInstantOf = (bare: string) => new Date(bare).getTime();

describe('isImpossibleStoredDay (objectui#10625, moved from fields)', () => {
  it('answers true for a nonexistent day in every spelling', () => {
    expect(isImpossibleStoredDay('2026-02-30')).toBe(true);
    expect(isImpossibleStoredDay('2026-02-30T10:00:00Z')).toBe(true);
    expect(isImpossibleStoredDay('2026-02-30T10:00:00.000Z')).toBe(true);
    expect(isImpossibleStoredDay('2026-02-30T10:00+08:00')).toBe(true);
    expect(isImpossibleStoredDay('2026-02-30T10:00')).toBe(true);
    expect(isImpossibleStoredDay('2026-04-31')).toBe(true);
  });

  it('answers false for a real day, a leap day, and anything without a leading day', () => {
    expect(isImpossibleStoredDay('2026-02-28')).toBe(false);
    expect(isImpossibleStoredDay('2024-02-29')).toBe(false);
    expect(isImpossibleStoredDay('2026-02-28T23:30:00-05:00')).toBe(false);
    expect(isImpossibleStoredDay(new Date(2026, 1, 14))).toBe(false);
    expect(isImpossibleStoredDay(1771063200000)).toBe(false);
    expect(isImpossibleStoredDay('not a date')).toBe(false);
    expect(isImpossibleStoredDay(null)).toBe(false);
    expect(isImpossibleStoredDay('')).toBe(false);
  });
});

describe('toDateTimeInputValue / fromDateTimeInputValue never roll a nonexistent day', () => {
  it('hands the control an empty value instead of the rolled day', () => {
    expect(toDateTimeInputValue('2026-02-30T10:00:00Z')).toBe('');
    expect(toDateTimeInputValue('2026-02-30T10:00')).toBe('');
  });

  it('returns a nonexistent day untouched on the way out', () => {
    expect(fromDateTimeInputValue('2026-02-30T10:05')).toBe('2026-02-30T10:05');
  });

  it('round-trips a real instant unchanged', () => {
    const iso = '2026-02-14T10:00:00.000Z';
    const shown = toDateTimeInputValue(iso);
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(localInstantOf(shown)).toBe(new Date(iso).getTime());
    expect(fromDateTimeInputValue(shown)).toBe(iso);
  });
});

describe('toDateInputValue', () => {
  it('keeps a leading YYYY-MM-DD verbatim, in any timezone', () => {
    expect(toDateInputValue('2026-02-14')).toBe('2026-02-14');
    expect(toDateInputValue('2026-02-14T23:30:00.000Z')).toBe('2026-02-14');
  });

  it('keeps a nonexistent day as written (the widget, not the adapter, marks it)', () => {
    // `DateField` and the data table hand the control `""` for it through
    // `isImpossibleStoredDay`; the adapter itself never rolls it.
    expect(toDateInputValue('2026-02-30')).toBe('2026-02-30');
  });

  it('maps empty and unparseable input to an empty control', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue('')).toBe('');
    expect(toDateInputValue('not a date')).toBe('');
  });
});
