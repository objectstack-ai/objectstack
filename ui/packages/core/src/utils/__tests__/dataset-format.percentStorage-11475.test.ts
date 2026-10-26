/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11475 — `percentDisplayValue` scales at the storage the caller
 * STATES, and never at a storage guessed from the value.
 *
 * Its body used to be `value > -1 && value < 1 ? value * 100 : value`. That
 * read neither the field nor its `max`, so it could not tell a fraction-stored
 * `1` (100%) from one percentage point, and it multiplied a whole-stored `0.5`
 * by 100. The storage is now a required argument, the spec's `PercentScale`,
 * and a value outside that union throws.
 *
 * `formatMeasure` keeps the server's `percentScale` annotation. A column the
 * server does not annotate is "not a percentage" in the contract's words, so
 * its `%` pattern states the storage the way numeral reads it: a fraction.
 */

import { describe, it, expect } from 'vitest';
import { percentDisplayValue, formatMeasure } from '../dataset-format';

describe('percentDisplayValue — the storage is stated (objectui#11475)', () => {
  it('a fraction is multiplied by 100 at every magnitude', () => {
    expect(percentDisplayValue(0.25, 'fraction')).toBe(25);
    expect(percentDisplayValue(1, 'fraction')).toBe(100);
    expect(percentDisplayValue(1.5, 'fraction')).toBe(150);
    expect(percentDisplayValue(-1, 'fraction')).toBe(-100);
  });

  it('whole percentage points pass through at every magnitude', () => {
    expect(percentDisplayValue(0.5, 'whole')).toBe(0.5);
    expect(percentDisplayValue(1, 'whole')).toBe(1);
    expect(percentDisplayValue(50, 'whole')).toBe(50);
  });

  it('a storage outside the spec union is refused, not resolved to a branch', () => {
    expect(() => percentDisplayValue(1, 'points' as never)).toThrow(TypeError);
    expect(() => percentDisplayValue(1, undefined as never)).toThrow(
      /percentScale must be 'fraction' or 'whole'/,
    );
  });
});

describe('formatMeasure — a `%` column the server does not annotate reads as a fraction (objectui#11475)', () => {
  it('an unannotated `%` pattern states a fraction, numeral\'s reading', () => {
    expect(formatMeasure(1, '0%')).toBe('100%');
    expect(formatMeasure(0.25, '0%')).toBe('25%');
    expect(formatMeasure(0.5, '0.0%')).toBe('50.0%');
  });

  it('the server annotation still wins, both ways', () => {
    expect(formatMeasure(1, '0.0%', undefined, 'fraction')).toBe('100.0%');
    expect(formatMeasure(1, '0.0%', undefined, 'whole')).toBe('1.0%');
    expect(formatMeasure(50, '0%', undefined, 'whole')).toBe('50%');
  });
});
