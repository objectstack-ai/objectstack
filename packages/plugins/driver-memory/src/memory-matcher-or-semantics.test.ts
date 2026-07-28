// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `$or` semantics conformance for the in-memory matcher.
 *
 * Companion to `driver-sql`'s `sql-driver-or-filter.test.ts`: the same filter
 * shapes, the same 2x2 fixture, the same expected ids. driver-sql used to
 * compile a `$or` branch's own field keys with OR instead of AND, so
 * `{$or:[{a,b}]}` matched strictly more rows than the Filter Protocol allows.
 * This matcher was already correct — these cases exist so the two backends
 * cannot silently drift apart again, since a read scope evaluated by one and
 * pushed down by the other must agree.
 */

import { describe, it, expect } from 'vitest';
import { match } from './memory-matcher.js';

const ROWS = [
  { id: '1', a: 'x', b: 'y', c: 'z' },
  { id: '2', a: 'x', b: 'zz', c: 'z' },
  { id: '3', a: 'qq', b: 'y', c: 'z' },
  { id: '4', a: 'qq', b: 'zz', c: 'z' },
];

const ids = (filter: any): string[] => ROWS.filter((r) => match(r, filter)).map((r) => r.id);

describe('memory-matcher $or semantics', () => {
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
    expect(docs.filter((d) => match(d, scope)).map((d) => d.id)).toEqual(['own-active', 'shared']);
  });
});
