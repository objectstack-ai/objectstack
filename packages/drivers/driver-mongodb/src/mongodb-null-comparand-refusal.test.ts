// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5347] `$null` takes a boolean — the FOURTH backend.
 *
 * This driver's `$null` arm was written `if (value === true) … else …`, i.e.
 * identically to `driver-memory`'s, so every non-boolean comparand fell to the
 * `else` and translated to `$ne: null` — IS NOT NULL. `driver-sql` hung its
 * default on the opposite side (`opValue === false` → IS NULL). #5347 predicted
 * this from a code read and asked for a measurement; measured on
 * `translateFilter` directly:
 *
 * ```
 * { stage: { $null: 'yes'  } }  =>  {"stage":{"$ne":null}}
 * { stage: { $null: 1      } }  =>  {"stage":{"$ne":null}}
 * { stage: { $null: 0      } }  =>  {"stage":{"$ne":null}}
 * { stage: { $null: 'false'} }  =>  {"stage":{"$ne":null}}    // truthy string!
 * ```
 *
 * — the prediction confirmed, so this driver is refused in step with the other
 * three rather than left as the last backend still guessing.
 *
 * # Why the translator, not a live mongod
 *
 * `translateFilter` is the whole of the divergence: it is a pure function, it is
 * this package's only reader of `$null`, and its output IS the query MongoDB
 * receives. This package's live suites need `mongodb-memory-server`, which
 * downloads a ~123 MB binary and is skipped whenever that download is blocked
 * (see `test-mongod.ts`) — a test of the ruling that can be skipped is not a
 * test of the ruling. Asserting on the translated document runs everywhere, and
 * is the level `mongodb-filter.test.ts` already pins `$null: true` / `$null:
 * false` at.
 */

import { describe, it, expect } from 'vitest';
import { translateFilter } from './mongodb-filter.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * The exact leading sentence `driver-sql` produces for this condition. A
 * literal, not an import: this package does not depend on driver-sql (and must
 * not), so the one-condition-one-wording invariant (#5240) is held by pinning
 * the other side's text here — the same discipline
 * `memory-filter-vocabulary-refusal.test.ts` uses.
 */
const DRIVER_SQL_LEADING_SENTENCE = (field: string) =>
  `Operator "$null" on field "${field}" requires a boolean comparand (true or false).`;

const refusalOf = (where: unknown): WireBearingError => {
  try {
    translateFilter(where);
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the translator to refuse this filter, but it translated');
};

describe('[#5347] driver-mongodb refuses a non-boolean $null comparand', () => {
  const NON_BOOLEAN: Array<[label: string, value: unknown]> = [
    ["the string 'yes'", 'yes'],
    ['the number 1', 1],
    ['the number 0', 0],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ["the STRING 'false'", 'false'],
  ];

  for (const [label, value] of NON_BOOLEAN) {
    it(`refuses ${label} with INVALID_FILTER / 400`, () => {
      const err = refusalOf({ stage: { $null: value } });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(DRIVER_SQL_LEADING_SENTENCE('stage'));
      expect(err.message).toContain('filter.stage.$null');
      // #3867 — the `[mongodb]` prefix must not appear on a client-visible
      // refusal. When this pin was written it read "the prefix this package's
      // OTHER refusal still carries (#5346)"; #5702 routed that arm through the
      // shared constructor and #5346 is closed, so no refusal in this package
      // carries one any more.
      expect(err.message).not.toContain('[mongodb]');
    });
  }

  it('names the position inside a combinator', () => {
    expect(refusalOf({ $and: [{ stage: { $null: 'x' } }] }).message).toContain('filter.$and[0].stage.$null');
    expect(refusalOf({ $or: [{ score: 1 }, { stage: { $null: 'x' } }] }).message).toContain(
      'filter.$or[1].stage.$null',
    );
    expect(refusalOf({ $not: { stage: { $null: 'x' } } }).message).toContain('filter.$not.stage.$null');
  });

  /**
   * [#5239 x #5347] A boolean identity settling the enclosing node must not
   * skip this gate.
   *
   * #5368 landed this driver's gate in the emitter's `$null` arm — sound while
   * every node reached an emitter. #5239's structural reduction ended that: a
   * TRUE disjunct (`{}`) or a FALSE key (`$or: []`) settles the node before
   * any emitter runs, so an emitter-only gate would refuse or ignore the same
   * comparand depending on its SIBLINGS — the evaluation-order dependence
   * #5368 placed driver-sql's and driver-memory's gates on their validating
   * walks to rule out. The gate here moved to `reduceFilterKey` with the
   * merge of the two changes; these pins hold it there. Each fixture would
   * short-circuit to a verdict (match-all / match-nothing) if the walk did
   * not refuse first.
   */
  it('is not skipped when a TRUE disjunct settles the $or (#5239 reduction)', () => {
    const err = refusalOf({ $or: [{}, { stage: { $null: 'yes' } }] });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('filter.$or[1].stage.$null');
  });

  it('is not skipped when a FALSE sibling key settles the node (#5239 reduction)', () => {
    const err = refusalOf({ $or: [], stage: { $null: 1 } });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('filter.stage.$null');
  });

  it('is not skipped inside a $not whose operand an identity settles (#5239 reduction)', () => {
    const err = refusalOf({ $not: { $or: [{}, { stage: { $null: 'x' } }] } });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('filter.$not.$or[1].stage.$null');
  });

  it('true and false translate exactly as before', () => {
    expect(translateFilter({ stage: { $null: true } })).toEqual({ stage: { $eq: null } });
    expect(translateFilter({ stage: { $null: false } })).toEqual({ stage: { $ne: null } });
  });

  it('the surrounding vocabulary is untouched', () => {
    expect(translateFilter({ stage: 'won' })).toEqual({ stage: 'won' });
    expect(translateFilter({ stage: { $in: ['won'] } })).toEqual({ stage: { $in: ['won'] } });
    expect(translateFilter({ score: { $between: [1, 2] } })).toEqual({ score: { $gte: 1, $lte: 2 } });
    expect(translateFilter({ stage: { $exists: true } })).toEqual({ stage: { $exists: true } });
    expect(translateFilter({})).toEqual({});
  });

  it('the FilterArray refusal keeps its envelope through the extracted helper', () => {
    // `filterArrayReachedDriverError` was rewritten to build its error through
    // the shared `unsupportedFilterError` rather than inline. Same wire
    // identity, same text.
    const err = refusalOf([['stage', '=', 'won']]);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('A filter ARRAY reached the driver');
  });
});
