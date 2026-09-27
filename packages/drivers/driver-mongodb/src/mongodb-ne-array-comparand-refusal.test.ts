// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886] `$ne` with an ARRAY comparand is refused by `translateFilter`, with
 * the `INVALID_FILTER` / 400 envelope `driver-sql` and `driver-memory` give the
 * same shape.
 *
 * ## Why this driver needed its own gate
 *
 * The RLS `using` clause is AND-composed into the query AFTER the engine's
 * comparand-shape seam, so a policy lowered to `{ f: { $ne: [...] } }` reached
 * this translator with no shared face in front of it, and the translator
 * emitted it unchanged. MongoDB reads `$ne` against an array operand as "not
 * equal to that array and not holding it as an element", which every scalar
 * value satisfies: measured through the real `MongoDBDriver` on mingo 7.2.4,
 * the named proxy for MongoDB query semantics, an RLS read under
 * `record.status != current_user.<membership set>` returned EVERY row. A live
 * `mongod` is NOT MEASURED — this fleet cannot fetch the binary, and mingo is
 * not a dependency of this package, so the proxy reading was taken outside this
 * suite. This suite pins the translator and the driver door: the refusal, and
 * that the server is never asked.
 *
 * ## Scope
 *
 * `$ne` only. The equality position (`{ f: [...] }`, `$eq: [...]`) is ruled to
 * the shared comparand-shape face, which keeps this translator passing it
 * through; it is not pinned either way here.
 */

import { describe, it, expect } from 'vitest';
import { translateFilter } from './mongodb-filter.js';
import { MongoDBDriver } from './mongodb-driver.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const refusalOf = (where: unknown): WireBearingError => {
  try {
    translateFilter(where);
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the translator to refuse this filter, but it translated');
};

const LIST = ['closed', 'archived'];

describe('[#19886] translateFilter refuses $ne with an array comparand', () => {
  const POSITIONS: Array<[string, Record<string, unknown>]> = [
    ['top level', { status: { $ne: LIST } }],
    ['beside another operator on the field', { status: { $ne: LIST, $exists: true } }],
    ['inside $and', { $and: [{ owner: 'u1' }, { status: { $ne: LIST } }] }],
    // `{}` reduces the `$or` to TRUE on its first disjunct, so the emitter never
    // reaches the second: only a gate on the WALK refuses this one.
    ['inside $or, beside a TRUE identity', { $or: [{}, { status: { $ne: LIST } }] }],
    ['inside $not (lowered to $nor)', { $not: { status: { $ne: LIST } } }],
    ['nested two combinators deep', { $and: [{ $or: [{ $not: { status: { $ne: LIST } } }] }] }],
    ['an EMPTY array', { status: { $ne: [] } }],
  ];

  for (const [label, where] of POSITIONS) {
    it(`${label}: INVALID_FILTER / 400`, () => {
      const err = refusalOf(where);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    });
  }

  it('the message names "$nin" and withholds the field and the comparand', () => {
    const err = refusalOf({ secret_scope: { $ne: ['usr_member_one', 'usr_member_two'] } });
    expect(err.message).toContain('"$nin"');
    expect(err.message).not.toContain('secret_scope');
    expect(err.message).not.toContain('usr_member_one');
  });

  it('the driver door refuses before the server is asked', async () => {
    const calls: unknown[] = [];
    const collection = {
      find: (filter: unknown) => { calls.push(filter); return { toArray: async () => [] }; },
      findOne: async (filter: unknown) => { calls.push(filter); return null; },
      countDocuments: async (filter: unknown) => { calls.push(filter); return 0; },
    };
    const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/unused', database: 'unused' });
    (driver as unknown as { db: unknown }).db = { collection: () => collection };

    for (const run of [
      () => driver.find('deal', { where: { status: { $ne: LIST } } } as never),
      () => driver.findOne('deal', { where: { status: { $ne: LIST } } } as never),
      () => driver.count('deal', { where: { status: { $ne: LIST } } } as never),
    ]) {
      const err = await run().then(() => null, (e: WireBearingError) => e);
      expect(err?.code).toBe('INVALID_FILTER');
      expect(err?.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('[#19886] every neighbouring shape translates exactly as before', () => {
  it('$nin / $in with a list', () => {
    expect(translateFilter({ status: { $nin: LIST } })).toEqual({ status: { $nin: LIST } });
    expect(translateFilter({ status: { $in: LIST } })).toEqual({ status: { $in: LIST } });
  });

  it('scalar $ne, and $ne: null', () => {
    expect(translateFilter({ status: { $ne: 'closed' } })).toEqual({ status: { $ne: 'closed' } });
    expect(translateFilter({ status: { $ne: null } })).toEqual({ status: { $ne: null } });
  });

  it('a scalar equality on an array-valued field — MongoDB\'s element match — is untouched', () => {
    expect(translateFilter({ tags: 'a' })).toEqual({ tags: 'a' });
    expect(translateFilter({ tags: { $ne: 'a' } })).toEqual({ tags: { $ne: 'a' } });
  });

  it('$not around a scalar $ne still lowers to $nor', () => {
    expect(translateFilter({ $not: { status: { $ne: 'closed' } } })).toEqual({ $nor: [{ status: { $ne: 'closed' } }] });
  });
});
