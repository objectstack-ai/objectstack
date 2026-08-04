// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5240] `{ field: {} }` — a field constrained by ZERO operators — is REFUSED
 * by BOTH of this package's filter surfaces, with the same `INVALID_FILTER`
 * envelope `driver-sql` and `@objectstack/formula` now raise.
 *
 * # Why two surfaces
 *
 * This package evaluates filters twice, through code that never meets:
 *
 * - `InMemoryDriver.find` (the LIVE query path) normalises the condition and
 *   hands it to **mingo**. The issue's table attributed this driver's answer to
 *   `memory-matcher`, but the driver does not call it — it imports only
 *   `getValueByPath`. Measured here rather than assumed: mingo reads a bare
 *   `{ a: {} }` as "the field deep-equals the empty document", so the shape
 *   selected rows whose `a` is literally `{}` and looked like "matches nothing"
 *   on ordinary data. Right answer for the wrong reason, and a DIFFERENT filter
 *   from the FALSE everyone believed was being computed.
 * - `memory-matcher.match` (the reference matcher the cross-backend conformance
 *   suites hold against driver-sql and formula) fell through to
 *   `JSON.stringify(value) === JSON.stringify(condition)` — structural equality
 *   against `{}` — and answered `false` incidentally.
 *
 * Neither was a ruling, and driver-sql read the same shape as TRUE inside a
 * combinator. #5240 ruled REFUSE; a backend whose two halves disagree about
 * what a filter MEANS is exactly the divergence the ruling closes, so both
 * halves are pinned here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';
import type { FilterCondition } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const ROWS = [
  { id: '1', stage: 'won', owner: 'u1', amount: 10 },
  { id: '2', stage: 'lost', owner: 'u2', amount: 20 },
  { id: '3', stage: 'open', owner: 'u1', amount: 30 },
];

/** The positions every backend pins, in the wording of the issue's table. */
const POSITIONS: Array<[string, unknown, string]> = [
  ['top level', { stage: {} }, 'filter.stage'],
  ['inside $or', { $or: [{ stage: {} }, { owner: 'u2' }] }, 'filter.$or[0].stage'],
  ['inside $and', { $and: [{ stage: 'won' }, { owner: {} }] }, 'filter.$and[1].owner'],
  ['inside $not', { $not: { stage: {} } }, 'filter.$not.stage'],
  ['nested two combinators deep', { $and: [{ $or: [{ stage: {} }] }] }, 'filter.$and[0].$or[0].stage'],
];

describe('[#5240] InMemoryDriver (live mingo path) refuses a zero-operator field constraint', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.syncSchema('deal', {
      fields: {
        id: { type: 'text', name: 'id' },
        stage: { type: 'text', name: 'stage' },
        owner: { type: 'text', name: 'owner' },
        amount: { type: 'number', name: 'amount' },
      },
    });
    for (const row of ROWS) await driver.create('deal', { ...row });
  });

  const ids = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find('deal', { object: 'deal', fields: ['id'], where: where as FilterCondition });
    return rows.map((r: any) => String(r.id)).sort();
  };

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    try {
      await ids(where);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the driver to refuse this filter, but it resolved');
  };

  for (const [name, where, position] of POSITIONS) {
    it(`${name} → 400 INVALID_FILTER naming ${position}`, async () => {
      const err = await refusalOf(where);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(position);
      expect(err.message).toContain('zero operators');
      expect(err.message).not.toContain('[driver-memory]');
    });
  }

  it('the refusal replaces a filter that was silently something ELSE', async () => {
    // Pre-fix this resolved: mingo compared `stage` against the empty document,
    // returning no rows — indistinguishable from a deliberate FALSE, and not
    // what the author asked for either way.
    await expect(ids({ stage: {} })).rejects.toThrow(/zero operators/);
  });

  describe('everything else on this path is unchanged', () => {
    it('ordinary filters still select the same rows', async () => {
      expect(await ids({ stage: 'won' })).toEqual(['1']);
      expect(await ids({ amount: { $gt: 15 } })).toEqual(['2', '3']);
      expect(await ids({ $or: [{ stage: 'won' }, { owner: 'u2' }] })).toEqual(['1', '2']);
      expect(await ids({ $and: [{ owner: 'u1' }, { amount: { $gt: 15 } }] })).toEqual(['3']);
      expect(await ids({})).toEqual(['1', '2', '3']);
    });

    it('an EMPTY NODE is not a zero-operator constraint and is still accepted', async () => {
      expect(await ids({ $or: [{ stage: 'won' }, {}] })).toEqual(['1', '2', '3']);
    });

    it('a $-key whose value is an empty object is NOT treated as a field constraint', async () => {
      // `{ $not: {} }` is the #5134 identity (NOT TRUE ≡ FALSE), not this shape,
      // so the #5240 gate must not claim it. On this path it still fails — but
      // for a pre-existing and entirely separate reason: the live query path
      // hands `$not` straight to mingo, which has no document-level `$not` at
      // all (measured while verifying this issue's premise; filed as #5324).
      // Pinned as the CURRENT truth, so #5324's fix is the thing that changes
      // it and this suite is not silently asserting a behaviour nobody has.
      await expect(ids({ $not: {} })).rejects.toThrow(/unknown top level operator/);
      await expect(ids({ $not: {} })).rejects.not.toThrow(/zero operators/);
    });
  });
});

describe('[#5240] memory-matcher (reference matcher) refuses the same shape', () => {
  const matched = (filter: unknown): string[] =>
    ROWS.filter((r) => match(r, filter)).map((r) => r.id);

  const refusalOf = (filter: unknown): WireBearingError => {
    try {
      matched(filter);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the matcher to refuse this filter, but it answered');
  };

  for (const [name, filter, position] of POSITIONS) {
    it(`${name} → INVALID_FILTER naming ${position}`, () => {
      const err = refusalOf(filter);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(position);
      expect(err.message).toContain('zero operators');
    });
  }

  it('the refusal does not depend on the RECORD being tested', () => {
    // The evaluator short-circuits (`every`/`some`, and a node returns on its
    // first failing key), so a gate inside evaluation would fire for some rows
    // and not others. The walk runs before evaluation, so every row refuses.
    for (const row of ROWS) {
      expect(() => match(row, { stage: 'nothing-matches-this', owner: {} })).toThrow(/zero operators/);
      expect(() => match(row, { $or: [{ stage: 'won' }, { owner: {} }] })).toThrow(/zero operators/);
    }
  });

  describe('evaluation is otherwise byte-identical', () => {
    it('ordinary filters answer exactly as before', () => {
      expect(matched({ stage: 'won' })).toEqual(['1']);
      expect(matched({ amount: { $gt: 15 } })).toEqual(['2', '3']);
      expect(matched({ $or: [{ stage: 'won' }, { owner: 'u2' }] })).toEqual(['1', '2']);
      expect(matched({ $and: [{ owner: 'u1' }, { amount: { $gt: 15 } }] })).toEqual(['3']);
      expect(matched({ $not: { stage: 'won' } })).toEqual(['2', '3']);
      expect(matched({})).toEqual(['1', '2', '3']);
    });

    it('a nested object comparison (a NON-empty plain object) still compares structurally', () => {
      // The arm `{ field: {} }` used to fall into. It keeps its behaviour for
      // every shape that actually carries keys.
      expect(match({ meta: { a: 1 } }, { meta: { a: 1 } })).toBe(true);
      expect(match({ meta: { a: 2 } }, { meta: { a: 1 } })).toBe(false);
    });
  });
});
