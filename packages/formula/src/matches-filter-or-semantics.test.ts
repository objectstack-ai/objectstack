// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `$or` semantics conformance for the record-at-a-time filter evaluator.
 *
 * Companion to `driver-sql`'s `sql-driver-or-filter.test.ts` and
 * `driver-memory`'s `memory-matcher-or-semantics.test.ts`: same shapes, same
 * 2x2 fixture, same expected ids. driver-sql used to OR the field keys within a
 * `$or` branch, widening the match set; this evaluator was already correct.
 *
 * Agreement here is load-bearing rather than cosmetic: this evaluator decides
 * the RLS `check` clause on writes while the SQL compiler decides the `where`
 * on reads. If they disagree on `$or`, a record can be writable but unreadable
 * (or worse, readable when the scope says otherwise).
 */

import { describe, expect, it } from 'vitest';

import { matchesFilterCondition as m } from './matches-filter';

const ROWS = [
  { id: '1', a: 'x', b: 'y', c: 'z' },
  { id: '2', a: 'x', b: 'zz', c: 'z' },
  { id: '3', a: 'qq', b: 'y', c: 'z' },
  { id: '4', a: 'qq', b: 'zz', c: 'z' },
];

const ids = (filter: any): string[] => ROWS.filter((r) => m(r, filter)).map((r) => r.id);

describe('matchesFilterCondition — $or semantics', () => {
  it('ANDs the keys of a single multi-key branch', () => {
    expect(ids({ $or: [{ a: 'x', b: 'y' }] })).toEqual(['1']);
  });

  it('ANDs the keys of each branch independently', () => {
    expect(ids({ $or: [{ a: 'x', b: 'y' }, { a: 'qq', b: 'zz' }] })).toEqual(['1', '4']);
  });

  it('ANDs operator-object keys within a branch', () => {
    expect(ids({ $or: [{ a: { $eq: 'x' }, b: { $ne: 'zz' } }] })).toEqual(['1']);
  });

  it('ANDs keys inside a $or nested in a $or branch', () => {
    expect(ids({ $or: [{ $or: [{ a: 'x', b: 'zz' }] }] })).toEqual(['2']);
  });

  it('ANDs multiple operators on ONE field within a branch', () => {
    expect(ids({ $or: [{ a: { $ne: 'qq', $eq: 'x' }, b: 'y' }] })).toEqual(['1']);
  });

  it('OR-s a $and branch against a sibling multi-key branch', () => {
    expect(ids({ $or: [{ $and: [{ a: 'x' }, { b: 'y' }] }, { a: 'qq', b: 'zz' }] })).toEqual(['1', '4']);
  });

  it('ANDs a $and with a sibling key in the same branch, either order', () => {
    expect(ids({ $or: [{ c: 'nope' }, { $and: [{ a: 'qq' }], b: 'y' }] })).toEqual(['3']);
    expect(ids({ $or: [{ c: 'nope' }, { b: 'y', $and: [{ a: 'qq' }] }] })).toEqual(['3']);
  });

  it('keeps single-key $or branches as a plain OR', () => {
    expect(ids({ $or: [{ a: 'x' }, { b: 'y' }] })).toEqual(['1', '2', '3']);
  });

  it('ANDs a $or with a sibling top-level field key', () => {
    expect(ids({ $or: [{ a: 'x' }, { b: 'y' }], b: 'zz' })).toEqual(['2']);
  });

  it('does not widen an "own AND active, OR shared" read scope', () => {
    const docs = [
      { id: 'own-active', owner: 'u1', status: 'active', shared_with: null },
      { id: 'own-archived', owner: 'u1', status: 'archived', shared_with: null },
      { id: 'other-active', owner: 'u2', status: 'active', shared_with: null },
      { id: 'shared', owner: 'u2', status: 'active', shared_with: 'u1' },
    ];
    const scope = { $or: [{ owner: 'u1', status: 'active' }, { shared_with: 'u1' }] };
    expect(docs.filter((d) => m(d, scope)).map((d) => d.id)).toEqual(['own-active', 'shared']);
  });
});
