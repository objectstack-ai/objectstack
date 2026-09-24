// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886] An ARRAY where one comparable value is expected — under `$ne`, or in
 * the equality position (a bare-array field spec, or `$eq`) — is REFUSED by
 * `matchesFilterCondition` with the `INVALID_FILTER` / 400 envelope driver-sql
 * and driver-memory already raise for the same shape.
 *
 * # Why this face's old answer was a write-gate bypass
 *
 * This evaluator IS the enforcement of a row-level `check` (plugin-security
 * matches it against the post-image; there is no query to push down to). It
 * compares strictly, and no stored scalar is `===` an array:
 *
 * | `check` policy (the CEL it lowers from)                  | before                           | after            |
 * |---|---|---|
 * | `{ s: { $ne: ['a','b'] } }` (`record.s != ['a','b']`)     | `true` → every write **ALLOWED** | throws → 400     |
 * | `{ $not: { s: ['a','b'] } }` (`!(record.s == ['a','b'])`) | `true` → every write **ALLOWED** | throws → 400     |
 * | `{ s: ['a','b'] }` (`record.s == ['a','b']`)              | `false` → every write DENIED     | throws → 400     |
 *
 * The first two rows are the bypass. The third failed closed only by accident
 * of polarity, which is why the equality position is refused with it.
 */

import { describe, it, expect } from 'vitest';
import { matchesFilterCondition } from './matches-filter';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const RECORD = { id: '1', status: 'closed', owner: 'u1', tags: ['a', 'b'], other: 'x' };

const refusalOf = (filter: unknown, record: Record<string, unknown> = RECORD): WireBearingError => {
  try {
    matchesFilterCondition(record, filter as never);
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the evaluator to refuse this filter, but it answered');
};

const LIST = ['closed', 'archived'];

/** Each refused shape, spelled once per operator position. */
const SHAPES: Array<[string, (list: unknown[]) => Record<string, unknown>]> = [
  ['$ne with an array', (list) => ({ status: { $ne: list } })],
  ['a bare-array field spec (implicit equality)', (list) => ({ status: list })],
  ['$eq with an array', (list) => ({ status: { $eq: list } })],
];

/** Every depth the refusal must reach — and the ones where the old answer was absorbed or inverted. */
const POSITIONS: Array<[string, (leaf: Record<string, unknown>) => Record<string, unknown>]> = [
  ['top level', (leaf) => leaf],
  ['inside $and', (leaf) => ({ $and: [{ owner: 'u1' }, leaf] })],
  ['inside $or, beside a satisfied branch', (leaf) => ({ $or: [{ owner: 'u1' }, leaf] })],
  ['inside $not', (leaf) => ({ $not: leaf })],
  ['nested two combinators deep', (leaf) => ({ $and: [{ $or: [{ $not: leaf }] }] })],
  ['after a sibling that already fails for this record', (leaf) => ({ owner: 'nobody', ...leaf })],
];

describe('[#19886] matchesFilterCondition refuses an array comparand in a single-value position', () => {
  for (const [shapeName, shape] of SHAPES) {
    for (const [positionName, position] of POSITIONS) {
      it(`${shapeName} — ${positionName}: INVALID_FILTER / 400`, () => {
        const err = refusalOf(position(shape(LIST)));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
      });
    }

    it(`${shapeName} — an EMPTY array is refused too`, () => {
      const err = refusalOf(shape([]));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    });

    it(`${shapeName} — refused for EVERY record, before any row is judged`, () => {
      // An empty record, a record whose value is a member of the list, a record
      // whose value is the very same array reference, and a record that would
      // have failed an earlier sibling: the verdict may not depend on the row.
      const records: Array<Record<string, unknown>> = [
        {},
        { status: 'closed' },
        { status: LIST },
        { status: 'open', owner: 'nobody' },
      ];
      for (const record of records) {
        const err = refusalOf(shape(LIST), record);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
      }
    });
  }

  it('the remedy names the list operators by their FieldOperatorsSchema spelling', () => {
    const err = refusalOf({ status: { $ne: LIST } });
    expect(err.message).toContain('"$in"');
    expect(err.message).toContain('"$nin"');
  });

  it('the message withholds the field and the comparand — the filter may be a policy the caller did not write', () => {
    const secretField = 'secret_scope_column';
    const secretIds = ['usr_member_one', 'usr_member_two'];
    for (const filter of [
      { [secretField]: { $ne: secretIds } },
      { [secretField]: secretIds },
      { [secretField]: { $eq: secretIds } },
    ]) {
      const err = refusalOf(filter, { [secretField]: 'x' });
      expect(err.message).not.toContain(secretField);
      for (const id of secretIds) expect(err.message).not.toContain(id);
    }
  });
});

describe('[#19886] every neighbouring shape answers exactly as before', () => {
  const m = matchesFilterCondition;

  it('$in / $nin — the list operators — still evaluate their array', () => {
    expect(m({ status: 'closed' }, { status: { $in: LIST } })).toBe(true);
    expect(m({ status: 'open' }, { status: { $in: LIST } })).toBe(false);
    expect(m({ status: 'closed' }, { status: { $nin: LIST } })).toBe(false);
    expect(m({ status: 'open' }, { status: { $nin: LIST } })).toBe(true);
    expect(m({ status: 'open' }, { $not: { status: { $in: LIST } } })).toBe(true);
    expect(m({ status: 'closed' }, { $not: { status: { $in: LIST } } })).toBe(false);
  });

  it('scalar $ne / $eq / implicit equality are untouched', () => {
    expect(m({ status: 'closed' }, { status: { $ne: 'closed' } })).toBe(false);
    expect(m({ status: 'open' }, { status: { $ne: 'closed' } })).toBe(true);
    expect(m({ status: 'closed' }, { status: { $eq: 'closed' } })).toBe(true);
    expect(m({ status: 'closed' }, { status: 'closed' })).toBe(true);
    expect(m({ status: 'open' }, { $not: { status: 'closed' } })).toBe(true);
  });

  it('null comparands are untouched', () => {
    expect(m({ status: null }, { status: null })).toBe(true);
    expect(m({ status: 'x' }, { status: { $ne: null } })).toBe(true);
    expect(m({ status: null }, { status: { $eq: null } })).toBe(true);
  });

  it('a Date comparand is still a comparand, not an operator map', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(m({ at: new Date(d.getTime()) }, { at: d })).toBe(true);
    expect(m({ at: new Date(d.getTime()) }, { at: { $ne: d } })).toBe(false);
  });

  it('a { $field } reference is judged by what was AUTHORED, not by what it resolves to', () => {
    // `tags` holds an array on this record; the reference itself is not one.
    expect(m(RECORD, { tags: { $eq: { $field: 'tags' } } })).toBe(true);
    expect(m(RECORD, { other: { $ne: { $field: 'status' } } })).toBe(true);
    expect(m(RECORD, { status: { $ne: { $field: 'status' } } })).toBe(false);
  });

  it('a scalar comparand against a STORED array is untouched — the refusal is about the comparand', () => {
    expect(m(RECORD, { tags: { $ne: 'a' } })).toBe(true);
    expect(m(RECORD, { tags: 'a' })).toBe(false);
  });
});
