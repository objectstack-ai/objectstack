// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20897] `$exists` takes a boolean — this driver refuses a non-boolean the
 * way it refuses `$null`'s (#5347-A, applied to `$exists` by #5369).
 *
 * Measured on `translateFilter` at `origin/main` `f6ccca4a`, before the refusal:
 *
 * ```
 * { stage: { $exists: 'yes'   } }  =>  {"stage":{"$eq":null}}
 * { stage: { $exists: 1       } }  =>  {"stage":{"$eq":null}}
 * { stage: { $exists: 'false' } }  =>  {"stage":{"$eq":null}}
 * { stage: { $exists: 0       } }  =>  {"stage":{"$eq":null}}
 * { stage: { $exists: null    } }  =>  {"stage":{"$eq":null}}
 * ```
 *
 * The emitter asked `value === true` and sent every other value to the
 * NO-value side, so `'yes'` asked MongoDB for the rows without one — the
 * author's intent inverted — while `driver-sql`, `driver-sqlite-wasm` and both
 * Turso transports refused the same filter.
 *
 * Asserted on the translator for the reason the `$null` twin
 * (`mongodb-null-comparand-refusal.test.ts`) gives: it is a pure function, it is
 * this package's only reader of `$exists`, and its output IS the query MongoDB
 * receives — a suite that needs a downloaded `mongod` can be skipped, and a test
 * of the ruling that can be skipped is not a test of the ruling.
 */

import { describe, it, expect } from 'vitest';
import { translateFilter } from './mongodb-filter.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * The exact leading sentence `driver-sql` produces for this condition
 * (`nonBooleanExistsComparandError`). A literal, not an import: this package
 * does not depend on driver-sql (and must not), so one condition, one wording
 * (#5240) is held by pinning the other side's text here.
 */
const DRIVER_SQL_LEADING_SENTENCE = (field: string) =>
  `Operator "$exists" on field "${field}" requires a boolean comparand (true or false).`;

const refusalOf = (where: unknown): WireBearingError => {
  try {
    translateFilter(where);
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the translator to refuse this filter, but it translated');
};

describe('[#20897] driver-mongodb refuses a non-boolean $exists comparand', () => {
  const NON_BOOLEAN: Array<[label: string, value: unknown]> = [
    ["the string 'yes'", 'yes'],
    ['the number 1', 1],
    ["the STRING 'false'", 'false'],
    ['the number 0', 0],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ];

  for (const [label, value] of NON_BOOLEAN) {
    it(`refuses ${label} with INVALID_FILTER / 400`, () => {
      const err = refusalOf({ stage: { $exists: value } });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(DRIVER_SQL_LEADING_SENTENCE('stage'));
      expect(err.message).toContain('filter.stage.$exists');
    });
  }

  it('names the position inside a combinator', () => {
    expect(refusalOf({ $and: [{ stage: { $exists: 'x' } }] }).message).toContain('filter.$and[0].stage.$exists');
    expect(refusalOf({ $or: [{ score: 1 }, { stage: { $exists: 1 } }] }).message).toContain(
      'filter.$or[1].stage.$exists',
    );
    expect(refusalOf({ $not: { stage: { $exists: 'yes' } } }).message).toContain('filter.$not.stage.$exists');
  });

  /**
   * The gate is on the WALK (`reduceFilterKey`), not only in the emitter: a
   * boolean identity settles these nodes before any emitter arm runs, so an
   * emitter-only gate would refuse or ignore the same comparand depending on
   * its SIBLINGS. Each fixture would short-circuit to match-all / match-nothing
   * if the walk did not refuse first.
   */
  it('is not skipped when a boolean identity settles the enclosing node', () => {
    for (const [where, at] of [
      [{ $or: [{}, { stage: { $exists: 'yes' } }] }, 'filter.$or[1].stage.$exists'],
      [{ $or: [], stage: { $exists: 1 } }, 'filter.stage.$exists'],
      [{ $not: { $or: [{}, { stage: { $exists: 'false' } }] } }, 'filter.$not.$or[1].stage.$exists'],
    ] as Array<[unknown, string]>) {
      const err = refusalOf(where);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(at);
    }
  });

  it('true and false translate exactly as before — the has-value lowering', () => {
    expect(translateFilter({ stage: { $exists: true } })).toEqual({ stage: { $ne: null } });
    expect(translateFilter({ stage: { $exists: false } })).toEqual({ stage: { $eq: null } });
    // The complement `$null` answers the mirror image (#5298's reading).
    expect(translateFilter({ stage: { $exists: true } })).toEqual(translateFilter({ stage: { $null: false } }));
    expect(translateFilter({ stage: { $exists: false } })).toEqual(translateFilter({ stage: { $null: true } }));
  });
});
