// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The #16318 pin: the physical-representation table and `NUMERIC_VALUE_TYPES`
 * are held EQUAL, in both directions.
 *
 * Why a pin and not a type: `NUMERIC_VALUE_TYPES` is a `ReadonlySet<string>`,
 * so no `satisfies` can express "exactly these keys". Without this test a
 * field type joining the numeric class would resolve to `undefined` here and
 * every producer would quietly keep its own old guess — which is the divergence
 * the card measured (driver `real`, sql format `numeric(18,2)`, typescript
 * format `numeric(8,2)`, on the same declaration).
 */

import { describe, it, expect } from 'vitest';
import { NUMERIC_VALUE_TYPES } from './field-value.zod';
import {
  NUMERIC_COLUMN_PRECISION,
  NUMERIC_COLUMN_SCALE,
  NUMERIC_COLUMN_REPRESENTATION,
  numericColumnFor,
} from './numeric-column-representation';

describe('#16318 — the numeric physical-representation table', () => {
  it('names every member of NUMERIC_VALUE_TYPES and nothing else', () => {
    expect(Object.keys(NUMERIC_COLUMN_REPRESENTATION).sort()).toEqual([...NUMERIC_VALUE_TYPES].sort());
  });

  it('answers for every member of the class', () => {
    for (const type of NUMERIC_VALUE_TYPES) {
      expect(numericColumnFor(type), type).toBeDefined();
    }
  });

  it('has NO opinion about a type outside the class', () => {
    // The driver's internal SQL aliases, a character type, and the two
    // spellings a malformed declaration can reach the resolver with.
    for (const type of ['float', 'integer', 'int', 'text', 'boolean', '', undefined]) {
      expect(numericColumnFor(type as string | undefined), String(type)).toBeUndefined();
    }
  });

  it('gives rating an INTEGER column and the other six an exact decimal', () => {
    expect(numericColumnFor('rating')).toEqual({ kind: 'integer' });
    for (const type of ['number', 'currency', 'percent', 'slider', 'progress', 'summary']) {
      expect(numericColumnFor(type), type).toEqual({
        kind: 'exact',
        precision: NUMERIC_COLUMN_PRECISION,
        scale: NUMERIC_COLUMN_SCALE,
      });
    }
  });

  /**
   * The scale is the whole point of the card, so it is pinned as a NUMBER and
   * with the property that number was chosen for: a `percent` stores 33.333%
   * as the fraction `0.33333` (`percentScaleOf`), which needs five decimal
   * places, and the two shapes the producers used to emit have two.
   */
  it('pins the portable dialect maxima, and a scale wide enough for the card\'s own value', () => {
    expect(NUMERIC_COLUMN_PRECISION).toBe(65);
    expect(NUMERIC_COLUMN_SCALE).toBe(30);
    expect(NUMERIC_COLUMN_SCALE).toBeGreaterThan(2);
    expect(NUMERIC_COLUMN_SCALE).toBeGreaterThanOrEqual('0.33333'.split('.')[1].length);
    // MySQL's own caps, which is where both numbers come from.
    expect(NUMERIC_COLUMN_SCALE).toBeLessThanOrEqual(30);
    expect(NUMERIC_COLUMN_PRECISION).toBeLessThanOrEqual(65);
    expect(NUMERIC_COLUMN_PRECISION).toBeGreaterThan(NUMERIC_COLUMN_SCALE);
  });
});
