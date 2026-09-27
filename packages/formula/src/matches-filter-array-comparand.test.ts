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
 *
 * [#19886 stage 2d] The same fault one position over, each measured admitting
 * and storing the writes a `check` was written to refuse:
 *
 * | shape                                               | before                                  | after       |
 * |---|---|---|
 * | `{ s: { $gt: ['m'] } }` (and `$gte` / `$lt` / `$lte`) | the array compared as the string `'m'`  | throws → 400 |
 * | `{ $not: { s: { $in: [['a','b']] } } }`, `$nin`       | `true` → every write **ALLOWED**         | throws → 400 |
 * | `{ s: { $ne: { $field: 'tags' } } }`, `tags` a list   | `true` → every write **ALLOWED**         | throws → 400 |
 *
 * The first two are authored shapes, refused before any record is judged like
 * the rows above. The third is a `{ $field }` comparison whose column holds a
 * list: the shape is legal, so it is judged on the record — refused when either
 * compared column holds a list (or an object) on the record being judged.
 *
 * [#19886 stage 2e] The mirror of the first 2d row, with the list on the
 * RECORD's side and a literal bound — also judged on the record:
 *
 * | shape                                                  | before                                        | after        |
 * |---|---|---|
 * | `{ tags: { $gt: 'a' } }`, `tags` holding `['m']`       | `'m' > 'a'` → `true`, the write **ALLOWED**   | throws → 400 |
 * | `{ meta: { $lt: 'a' } }`, `meta` holding `{ a: 1 }`    | `'[object Object]' < 'a'` → `true`, **ALLOWED** | throws → 400 |
 * | `{ tags: { $between: ['a', 'z'] } }`, `['m']`          | `true`                                        | throws → 400 |
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
  // [#19886 stage 2d] the ordering operators, and a list member that is a list
  ['$gt with an array', (list) => ({ status: { $gt: list } })],
  ['$gte with an array', (list) => ({ status: { $gte: list } })],
  ['$lt with an array', (list) => ({ status: { $lt: list } })],
  ['$lte with an array', (list) => ({ status: { $lte: list } })],
  ['$in with an array member', (list) => ({ status: { $in: ['open', list] } })],
  ['$nin with an array member', (list) => ({ status: { $nin: [list] } })],
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

  it('a { $field } reference between two scalar columns compares them', () => {
    expect(m(RECORD, { other: { $ne: { $field: 'status' } } })).toBe(true);
    expect(m(RECORD, { status: { $ne: { $field: 'status' } } })).toBe(false);
    expect(m(RECORD, { status: { $eq: { $field: 'status' } } })).toBe(true);
  });

  it('[#19886 stage 2d] a { $field } reference to a list-holding column is refused, even against itself', () => {
    // Pinned `true` before stage 2d: a column holding a list compared with
    // itself matched by reference identity. It is a list compared with a list,
    // and it is refused like every other list in a one-value comparison.
    const err = refusalOf({ tags: { $eq: { $field: 'tags' } } });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
  });

  it('a scalar comparand against a STORED array is untouched — the refusal is about the comparand', () => {
    expect(m(RECORD, { tags: { $ne: 'a' } })).toBe(true);
    expect(m(RECORD, { tags: 'a' })).toBe(false);
  });

  it('[#19886 stage 2d] ordering against one bound, and flat lists under $in / $nin', () => {
    expect(m({ status: 'open' }, { status: { $gt: 'm' } })).toBe(true);
    expect(m({ status: 'archived' }, { status: { $gt: 'm' } })).toBe(false);
    expect(m({ n: 5 }, { n: { $lte: 5 } })).toBe(true);
    expect(m({ status: 'open' }, { status: { $in: [] } })).toBe(false);
    expect(m({ status: 'open' }, { status: { $nin: [] } })).toBe(true);
  });
});

describe('[#19886 stage 2d] a { $field } comparison whose column holds a list is refused on that record', () => {
  const m = matchesFilterCondition;
  const POST_IMAGE = { status: 'closed', reviewer: 'closed', tags: ['closed', 'archived'], meta: { k: 'v' } };

  const REFUSED: Array<[string, Record<string, unknown>]> = [
    ['$ne against a list-holding column (`record.status != record.tags`)', { status: { $ne: { $field: 'tags' } } }],
    ['a negated $eq (`!(record.status == record.tags)`)', { $not: { status: { $eq: { $field: 'tags' } } } }],
    ['the mirror — the list on the constrained side (`record.tags != record.status`)', { tags: { $ne: { $field: 'status' } } }],
    ['an ordering operator against a list-holding column', { status: { $gt: { $field: 'tags' } } }],
    ['a column holding an object', { status: { $ne: { $field: 'meta' } } }],
    ['the offset form, judged on its base column', { $not: { status: { $eq: { $field: 'tags', addDays: 1 } } } }],
    ['under $or beside an unsatisfied branch', { $or: [{ reviewer: 'nobody' }, { status: { $ne: { $field: 'tags' } } }] }],
  ];

  for (const [name, filter] of REFUSED) {
    it(`${name}: INVALID_FILTER / 400`, () => {
      const err = refusalOf(filter, POST_IMAGE);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    });
  }

  it('the same filter over a record whose columns hold one value each is compared, not refused', () => {
    expect(m({ status: 'closed', tags: 'closed' }, { status: { $ne: { $field: 'tags' } } })).toBe(false);
    expect(m({ status: 'open', tags: 'closed' }, { status: { $ne: { $field: 'tags' } } })).toBe(true);
    expect(m({ status: 'open', tags: 'closed' }, { $not: { status: { $eq: { $field: 'tags' } } } })).toBe(true);
  });

  it('the message withholds the columns and their values', () => {
    const err = refusalOf({ secret_scope_column: { $ne: { $field: 'secret_list' } } }, {
      secret_scope_column: 'x',
      secret_list: ['usr_member_one', 'usr_member_two'],
    });
    for (const secret of ['secret_scope_column', 'secret_list', 'usr_member_one', 'usr_member_two']) {
      expect(err.message).not.toContain(secret);
    }
  });
});

describe('[#19886 stage 2e] an ordering comparison whose STORED operand holds a list or an object is refused on that record', () => {
  const m = matchesFilterCondition;

  /** What a `json` column or a `multiple` lookup holds on a post-image. */
  const STORED: Array<[string, unknown]> = [
    ['a one-element list', ['m']],
    ['a multi-element list', ['a', 'z']],
    ['an empty list', []],
    ['a list of lists', [['m']]],
    ['a plain object', { a: 1 }],
    ['an empty object', {}],
  ];

  /** Every ordering operator, each with a bound the coerced string form used to satisfy or not. */
  const ORDERINGS: Array<[string, Record<string, unknown>]> = [
    ['$gt', { $gt: 'a' }],
    ['$gte', { $gte: 'a' }],
    ['$lt', { $lt: 'z' }],
    ['$lte', { $lte: 'z' }],
    ['$between', { $between: ['a', 'z'] }],
  ];

  for (const [storedName, stored] of STORED) {
    for (const [opName, spec] of ORDERINGS) {
      it(`${opName} on a field holding ${storedName}: INVALID_FILTER / 400`, () => {
        const err = refusalOf({ tags: spec }, { tags: stored });
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
      });
    }
  }

  it('the refusal reaches every depth the evaluation reaches, and a negation cannot turn it into an answer', () => {
    const record = { owner: 'u1', tags: ['m'] };
    const leaf = { tags: { $gt: 'a' } };
    for (const filter of [
      { $and: [{ owner: 'u1' }, leaf] },
      { $or: [{ owner: 'nobody' }, leaf] },
      { $not: leaf },
      { $and: [{ $or: [{ $not: leaf }] }] },
    ]) {
      const err = refusalOf(filter, record);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    }
  });

  it('a verdict already decided without the field does not reach it — judged per record, like the stage 2d refusal', () => {
    // Unlike the shape refusals, which judge the authored filter before any
    // record, this one judges a VALUE, so it fires where evaluation reads it.
    // Where it is not read, the answer does not depend on it either way.
    const record = { owner: 'u1', tags: ['m'] };
    expect(m(record, { $or: [{ owner: 'u1' }, { tags: { $gt: 'a' } }] })).toBe(true);
    expect(m(record, { owner: 'nobody', tags: { $gt: 'a' } })).toBe(false);
  });

  it('whatever the comparand: a number, a Date, null or a { $field } reference', () => {
    const record = { tags: ['m'], status: 'a' };
    for (const spec of [
      { $gt: 5 },
      { $lt: new Date('2026-01-01T00:00:00.000Z') },
      { $gte: null },
      { $lte: { $field: 'status' } },
    ]) {
      const err = refusalOf({ tags: spec }, record);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    }
  });

  it('a list written into a scalar field is judged the same way (a text or number field under an ordering check)', () => {
    for (const [record, filter] of [
      [{ status: ['m'] }, { status: { $gt: 'a' } }],
      [{ amount: [500] }, { amount: { $gt: 10 } }],
    ] as const) {
      const err = refusalOf(filter, record);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    }
  });

  it('the SAME filter over a record holding one scalar is compared, not refused — the refusal is per record', () => {
    expect(m({ tags: 'm' }, { tags: { $gt: 'a' } })).toBe(true);
    expect(m({ tags: 'a' }, { tags: { $gt: 'a' } })).toBe(false);
    expect(m({ tags: 'm' }, { tags: { $between: ['a', 'z'] } })).toBe(true);
    expect(m({ tags: 5 }, { tags: { $lte: 10 } })).toBe(true);
  });

  it('null, a missing field and a Date are untouched: no value is false, and a Date is a value', () => {
    for (const record of [{ tags: null }, {}]) {
      expect(m(record, { tags: { $gt: 'a' } })).toBe(false);
      expect(m(record, { tags: { $lt: 'z' } })).toBe(false);
      expect(m(record, { tags: { $between: ['a', 'z'] } })).toBe(false);
    }
    const at = new Date('2026-06-01T00:00:00.000Z');
    expect(m({ at }, { at: { $gt: '2026-01-01T00:00:00.000Z' } })).toBe(true);
    expect(m({ at }, { at: { $lt: '2026-01-01T00:00:00.000Z' } })).toBe(false);
    expect(m({ at }, { at: { $between: ['2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z'] } })).toBe(true);
  });

  it('equality against a stored list keeps the answer stage 2a pinned — only ordering moved', () => {
    const record = { tags: ['m'] };
    expect(m(record, { tags: 'm' })).toBe(false);
    expect(m(record, { tags: { $eq: 'm' } })).toBe(false);
    expect(m(record, { tags: { $ne: 'm' } })).toBe(true);
    expect(m(record, { tags: { $in: ['m'] } })).toBe(false);
    expect(m(record, { tags: { $nin: ['m'] } })).toBe(true);
    expect(m(record, { tags: { $exists: true } })).toBe(true);
    expect(m(record, { tags: { $null: false } })).toBe(true);
  });

  it('the message withholds the field and the stored value', () => {
    const err = refusalOf({ secret_scope_column: { $gt: 'a' } }, {
      secret_scope_column: ['usr_member_one', 'usr_member_two'],
    });
    for (const secret of ['secret_scope_column', 'usr_member_one', 'usr_member_two']) {
      expect(err.message).not.toContain(secret);
    }
  });
});
