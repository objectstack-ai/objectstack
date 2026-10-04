// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { lowerFilterCondition, type FilterCondition } from '@objectstack/spec/data';

import { matchesFilterCondition as m } from './matches-filter';

const rec = {
  id: 'r1', owner_id: 'u1', org: 'org1', amount: 1000, stage: 'won',
  region: null as string | null, name: 'Acme Beta', created_by: 'u1',
};

describe('matchesFilterCondition — basics', () => {
  it('null/empty filter matches everything', () => {
    expect(m(rec, null)).toBe(true);
    expect(m(rec, {})).toBe(true);
  });
  it('implicit equality', () => {
    expect(m(rec, { owner_id: 'u1' })).toBe(true);
    expect(m(rec, { owner_id: 'u2' })).toBe(false);
  });
  it('{ field: null } → IS NULL', () => {
    expect(m(rec, { region: null })).toBe(true);
    expect(m(rec, { stage: null })).toBe(false);
  });
  it('multiple keys are AND-ed', () => {
    expect(m(rec, { owner_id: 'u1', stage: 'won' })).toBe(true);
    expect(m(rec, { owner_id: 'u1', stage: 'lost' })).toBe(false);
  });
});

describe('matchesFilterCondition — operators', () => {
  it('$eq / $ne', () => {
    expect(m(rec, { stage: { $eq: 'won' } })).toBe(true);
    expect(m(rec, { stage: { $ne: 'lost' } })).toBe(true);
    expect(m(rec, { stage: { $ne: 'won' } })).toBe(false);
  });
  it('$gt/$gte/$lt/$lte', () => {
    expect(m(rec, { amount: { $gte: 1000 } })).toBe(true);
    expect(m(rec, { amount: { $gt: 1000 } })).toBe(false);
    expect(m(rec, { amount: { $lt: 2000 } })).toBe(true);
    expect(m(rec, { amount: { $lte: 999 } })).toBe(false);
  });
  it('$in / $nin', () => {
    expect(m(rec, { stage: { $in: ['won', 'open'] } })).toBe(true);
    expect(m(rec, { stage: { $in: ['lost'] } })).toBe(false);
    expect(m(rec, { stage: { $nin: ['lost'] } })).toBe(true);
    expect(m(rec, { stage: { $nin: ['won'] } })).toBe(false);
  });
  it('$between', () => {
    expect(m(rec, { amount: { $between: [500, 1500] } })).toBe(true);
    expect(m(rec, { amount: { $between: [1100, 1500] } })).toBe(false);
  });
  it('string ops', () => {
    expect(m(rec, { name: { $contains: 'Beta' } })).toBe(true);
    expect(m(rec, { name: { $startsWith: 'Acme' } })).toBe(true);
    expect(m(rec, { name: { $endsWith: 'Beta' } })).toBe(true);
    expect(m(rec, { name: { $notContains: 'Zeta' } })).toBe(true);
    expect(m(rec, { name: { $startsWith: 'Zzz' } })).toBe(false);
  });
  /**
   * [#6518] The `$contains` family is case-SENSITIVE by contract (#4706 Q2 = A).
   *
   * This face already was — `String.prototype.includes` / `startsWith` /
   * `endsWith` compare exactly — so #6518 is what moved the SQL family onto this
   * answer, not what changed this one. It is pinned now precisely BECAUSE
   * nothing here changed: this evaluator is the JS baseline the drivers were
   * brought to, and the next mistake in this file takes the shape of a
   * "helpful" `toLowerCase()` added to make some backend agree. That would
   * silently widen every RLS rule this function evaluates, and no assertion in
   * the repo would have gone red for it.
   *
   * `$notContains` carries the mirror: a case-only difference does NOT contain,
   * so it must SATISFY the negation. A folding implementation excludes the row.
   */
  it('[#6518] the $contains family is case-SENSITIVE', () => {
    expect(m(rec, { name: { $contains: 'beta' } })).toBe(false);
    expect(m(rec, { name: { $contains: 'Beta' } })).toBe(true);
    expect(m(rec, { name: { $startsWith: 'acme' } })).toBe(false);
    expect(m(rec, { name: { $startsWith: 'Acme' } })).toBe(true);
    expect(m(rec, { name: { $endsWith: 'BETA' } })).toBe(false);
    expect(m(rec, { name: { $endsWith: 'Beta' } })).toBe(true);
    expect(m(rec, { name: { $notContains: 'beta' } })).toBe(true);
    expect(m(rec, { name: { $notContains: 'Beta' } })).toBe(false);
  });
  it('$null / $exists', () => {
    expect(m(rec, { region: { $null: true } })).toBe(true);
    expect(m(rec, { stage: { $null: false } })).toBe(true);
    expect(m(rec, { stage: { $exists: true } })).toBe(true);
    expect(m(rec, { missing: { $exists: false } })).toBe(true);
  });
  it('$field reference (field-to-field)', () => {
    expect(m(rec, { created_by: { $eq: { $field: 'owner_id' } } })).toBe(true);
    expect(m(rec, { created_by: { $eq: { $field: 'org' } } })).toBe(false);
  });
});

describe('matchesFilterCondition — combinators', () => {
  it('$and', () => {
    expect(m(rec, { $and: [{ stage: 'won' }, { amount: { $gte: 500 } }] })).toBe(true);
    expect(m(rec, { $and: [{ stage: 'won' }, { amount: { $gte: 5000 } }] })).toBe(false);
  });
  it('$or', () => {
    expect(m(rec, { $or: [{ stage: 'lost' }, { amount: { $gte: 500 } }] })).toBe(true);
    expect(m(rec, { $or: [{ stage: 'lost' }, { amount: { $gte: 5000 } }] })).toBe(false);
    expect(m(rec, { $or: [] })).toBe(false); // empty OR matches nothing
  });
  it('$not', () => {
    expect(m(rec, { $not: { stage: 'lost' } })).toBe(true);
    expect(m(rec, { $not: { stage: 'won' } })).toBe(false);
  });
  it('nested compound (the compiled compound-condition shape)', () => {
    const f = { $and: [{ org: 'org1' }, { $or: [{ stage: 'won' }, { amount: { $gt: 9999 } }] }] };
    expect(m(rec, f)).toBe(true);
    expect(m({ ...rec, org: 'org2' }, f)).toBe(false);
  });
});

describe('matchesFilterCondition — FAIL CLOSED', () => {
  it('unknown operator → false', () => {
    expect(m(rec, { amount: { $regex: '.*' } as never })).toBe(false);
  });
  it('unknown top-level operator → false', () => {
    expect(m(rec, { $weird: [] } as never)).toBe(false);
  });
  it('nested relation object (non-$ key) → false', () => {
    expect(m(rec, { account: { region: 'EMEA' } } as never)).toBe(false);
  });
  it('bare array value → REFUSED, not answered (#19886; the full pins are matches-filter-array-comparand.test.ts)', () => {
    let err: { code?: string; status?: number } | undefined;
    try { m(rec, { stage: ['won'] } as never); } catch (e) { err = e as { code?: string; status?: number }; }
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.status).toBe(400);
  });
  it('malformed (array/scalar) filter → false', () => {
    expect(m(rec, [] as never)).toBe(false);
    expect(m(rec, 'nope' as never)).toBe(false);
  });
});

describe('matchesFilterCondition — calendar-day upper bounds (ADR-0053 D-D1, #3777, #21242)', () => {
  // [#21242] This face keeps no whole-day copy of the bare-day upper bound any
  // more (ADR-0053 D-D1 items 5 and 9; ruling A on #21109). The whole day is
  // applied ONCE, at the seams that feed it: the RLS compile seam lowers its
  // policy filters with the shared `lowerFilterCondition` on the declared
  // `datetime` columns, the engine's aggregate seam does the same for
  // `having` and `aggregations[i].filter`, and the RLS write check puts a
  // declared `date` column into its stored calendar-day form. So each
  // whole-day assertion below is made on what a seam hands this face, and a
  // bound that reaches it unlowered is compared as written.
  const at = (created_at: string) => ({ created_at });
  /** What a typed seam hands this face: `created_at` is the declared `datetime` column. */
  const seam = (filter: Record<string, unknown>) =>
    lowerFilterCondition(filter as FilterCondition, { isDatetimeColumn: (column) => column === 'created_at' });

  it('a bare-day $lte is compared as written — an instant on that day sorts above the bare day', () => {
    // These three were admitted by the deleted copy; the seam now carries them (next case).
    expect(m(at('2026-07-28T00:00:00.000Z'), { created_at: { $lte: '2026-07-28' } })).toBe(false);
    expect(m(at('2026-07-28T09:15:00.000Z'), { created_at: { $lte: '2026-07-28' } })).toBe(false);
    expect(m(at('2026-07-28T23:59:59.999Z'), { created_at: { $lte: '2026-07-28' } })).toBe(false);
    expect(m(at('2026-07-27T23:59:59.999Z'), { created_at: { $lte: '2026-07-28' } })).toBe(true);
  });

  it('…the seam\'s lowering admits the whole day', () => {
    expect(seam({ created_at: { $lte: '2026-07-28' } })).toEqual({ created_at: { $lt: '2026-07-29' } });
    expect(m(at('2026-07-28T00:00:00.000Z'), seam({ created_at: { $lte: '2026-07-28' } }))).toBe(true);
    expect(m(at('2026-07-28T09:15:00.000Z'), seam({ created_at: { $lte: '2026-07-28' } }))).toBe(true);
    expect(m(at('2026-07-28T23:59:59.999Z'), seam({ created_at: { $lte: '2026-07-28' } }))).toBe(true);
  });

  it('…and stops at the next day', () => {
    expect(m(at('2026-07-29T00:00:00.000Z'), seam({ created_at: { $lte: '2026-07-28' } }))).toBe(false);
    expect(m(at('2026-07-29T00:00:00.000Z'), { created_at: { $lte: '2026-07-28' } })).toBe(false);
  });

  it('a stored calendar day is unchanged (the `date` storage form orders as the day)', () => {
    // A `date` column is not lowered: its stored text orders exactly as the day.
    expect(seam({ signed_on: { $lte: '2026-07-28' } })).toEqual({ signed_on: { $lte: '2026-07-28' } });
    expect(m({ signed_on: '2026-07-28' }, { signed_on: { $lte: '2026-07-28' } })).toBe(true);
    expect(m({ signed_on: '2026-07-29' }, { signed_on: { $lte: '2026-07-28' } })).toBe(false);
  });

  it('a full-ISO bound keeps exact-instant semantics — never widened, by the face or the seam', () => {
    expect(m(at('2026-07-28T09:15:00.000Z'), { created_at: { $lte: '2026-07-28T12:00:00.000Z' } })).toBe(true);
    expect(m(at('2026-07-28T21:40:00.000Z'), { created_at: { $lte: '2026-07-28T12:00:00.000Z' } })).toBe(false);
    expect(m(at('2026-07-28T21:40:00.000Z'), seam({ created_at: { $lte: '2026-07-28T12:00:00.000Z' } }))).toBe(false);
  });

  it('$gte / $gt / $lt keep their midnight anchoring', () => {
    expect(m(at('2026-07-28T09:15:00.000Z'), { created_at: { $gte: '2026-07-28' } })).toBe(true);
    expect(m(at('2026-07-27T23:59:59.999Z'), { created_at: { $gte: '2026-07-28' } })).toBe(false);
    expect(m(at('2026-07-28T09:15:00.000Z'), { created_at: { $lt: '2026-07-28' } })).toBe(false);
  });

  it('$between is inclusive as written at both ends; the seam splits it and gives its max the whole day', () => {
    expect(m(at('2026-07-28T21:40:00.000Z'), { created_at: { $between: ['2026-04-29', '2026-07-28'] } })).toBe(false);
    expect(m(at('2026-07-28T21:40:00.000Z'), seam({ created_at: { $between: ['2026-04-29', '2026-07-28'] } }))).toBe(true);
    expect(m(at('2026-07-29T00:00:00.000Z'), seam({ created_at: { $between: ['2026-04-29', '2026-07-28'] } }))).toBe(false);
    // The min still bounds, on either reading.
    expect(m(at('2026-04-28T23:00:00.000Z'), { created_at: { $between: ['2026-04-29', '2026-07-28'] } })).toBe(false);
    expect(m(at('2026-04-28T23:00:00.000Z'), seam({ created_at: { $between: ['2026-04-29', '2026-07-28'] } }))).toBe(false);
  });

  it('an impossible day is not rolled over — the bound stays as written', () => {
    // `2026-02-30` is not a calendar day, so the seam leaves it as written
    // rather than silently querying March 2nd, and this face compares it as text.
    expect(seam({ created_at: { $lte: '2026-02-30' } })).toEqual({ created_at: { $lte: '2026-02-30' } });
    expect(m({ signed_on: '2026-02-30' }, { signed_on: { $lte: '2026-02-30' } })).toBe(true);
    expect(m({ signed_on: '2026-03-01' }, { signed_on: { $lte: '2026-02-30' } })).toBe(false);
  });

  it('stays fail-closed on a null bound', () => {
    expect(m(at('2026-07-28T09:15:00.000Z'), { created_at: { $lte: null } as never })).toBe(false);
    expect(m(at('2026-07-28T09:15:00.000Z'), { created_at: { $between: ['2026-04-29', null] } as never })).toBe(false);
    expect(m(at('2026-07-28T09:15:00.000Z'), seam({ created_at: { $between: ['2026-04-29', null] } }))).toBe(false);
  });

  // [#20600] 9999-12-31, the last supported day, has no next day: every instant
  // is inside its whole-day bound, so the seam drops the bound (a lone `$lte`
  // keeps only `$null: false`, a `$between` its minimum). Unlowered, the bound
  // is compared as written, as on every other day.
  it('on the last supported day, the seam admits every instant — string or Date', () => {
    expect(seam({ created_at: { $lte: '9999-12-31' } })).toEqual({ created_at: { $null: false } });
    expect(m(at('2026-07-15T14:00:00.000Z'), seam({ created_at: { $lte: '9999-12-31' } }))).toBe(true);
    expect(m(at('9999-12-31T23:59:59.999Z'), seam({ created_at: { $lte: '9999-12-31' } }))).toBe(true);
    expect(m({ created_at: new Date('9999-12-31T10:00:00.000Z') }, seam({ created_at: { $lte: '9999-12-31' } }))).toBe(true);
    expect(m({ signed_on: '9999-12-31' }, { signed_on: { $lte: '9999-12-31' } })).toBe(true);
    expect(m(at('2026-07-15T14:00:00.000Z'), seam({ created_at: { $between: ['2026-01-01', '9999-12-31'] } }))).toBe(true);
    expect(m(at('9999-12-31T10:00:00.000Z'), seam({ created_at: { $between: ['9999-12-31', '9999-12-31'] } }))).toBe(true);
    // The min still bounds.
    expect(m(at('2025-12-31T23:59:59.999Z'), seam({ created_at: { $between: ['2026-01-01', '9999-12-31'] } }))).toBe(false);
  });

  it('…unlowered, the last day is compared as written: text above the day, and a Date after its midnight, fall outside', () => {
    expect(m(at('2026-07-15T14:00:00.000Z'), { created_at: { $lte: '9999-12-31' } })).toBe(true);
    expect(m(at('9999-12-31T23:59:59.999Z'), { created_at: { $lte: '9999-12-31' } })).toBe(false);
    expect(m({ created_at: new Date('9999-12-31T10:00:00.000Z') }, { created_at: { $lte: '9999-12-31' } })).toBe(false);
    expect(m(at('9999-12-31T10:00:00.000Z'), { created_at: { $between: ['9999-12-31', '9999-12-31'] } })).toBe(false);
  });

  it('…9999-12-30 is still a bound (the control)', () => {
    expect(m(at('9999-12-30T10:00:00.000Z'), seam({ created_at: { $lte: '9999-12-30' } }))).toBe(true);
    expect(m(at('9999-12-31T10:00:00.000Z'), seam({ created_at: { $lte: '9999-12-30' } }))).toBe(false);
    expect(m(at('9999-12-30T10:00:00.000Z'), { created_at: { $lte: '9999-12-30' } })).toBe(false);
  });

  it('…a value that denotes no instant keeps the comparison as written — no schema here says it is temporal', () => {
    expect(m({ code: 'zzz' }, { code: { $lte: '9999-12-31' } })).toBe(false);
    expect(m({ code: '5000' }, { code: { $lte: '9999-12-31' } })).toBe(true);
    expect(m({ code: true }, { code: { $lte: '9999-12-31' } })).toBe(false);
    expect(m({ code: null }, { code: { $lte: '9999-12-31' } })).toBe(false);
    expect(m({}, { code: { $lte: '9999-12-31' } })).toBe(false);
  });

  it('…and so does a number: a day string is not a number, so the comparison is false', () => {
    // The deleted copy admitted any value that denotes an instant on the last
    // day, and read an epoch number as one; compared as written, a number
    // against a day string is false.
    expect(m({ amount: 5 }, { amount: { $lte: '9999-12-31' } })).toBe(false);
    expect(m({ amount: 5 }, { amount: { $lte: '2026-07-28' } })).toBe(false);
  });
});
