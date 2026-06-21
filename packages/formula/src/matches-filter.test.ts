// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

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
  it('bare array value → false', () => {
    expect(m(rec, { stage: ['won'] } as never)).toBe(false);
  });
  it('malformed (array/scalar) filter → false', () => {
    expect(m(rec, [] as never)).toBe(false);
    expect(m(rec, 'nope' as never)).toBe(false);
  });
});
