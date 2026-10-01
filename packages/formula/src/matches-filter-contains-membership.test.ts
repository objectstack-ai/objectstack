// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `$contains` / `$notContains` on `matchesFilterCondition` ask the question
 * `FILTER_OPERATORS`' `$contains` docblock (`@objectstack/spec`) gives the
 * column: MEMBERSHIP on a JSON-stored column, SUBSTRING on a scalar one.
 *
 * Which question is asked:
 *
 * | the caller supplied `options.fields`, and it names the column | asked |
 * |---|---|
 * | yes, declared JSON-stored (`STRUCTURED_JSON_TYPES`, or multi-valued) | membership |
 * | yes, any other declared type | substring |
 * | no (no map, or a column the map does not name) | by the stored value: an array asks membership, anything else substring |
 *
 * The declaration wins where it exists (contract first); where it does not, the
 * stored value decides, the reading this face already gives `$empty` because it
 * judges a record rather than a declaration.
 *
 * Before, the arm answered the substring test alone, so a stored array never
 * matched `$contains` and always matched `$notContains`. The cell first pinned
 * is the one the contract names: `'u1'` against a stored `['u10']` (not a
 * member), beside a scalar text control (a substring).
 */

import { describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from './matches-filter';

const DECLARED = {
  fields: {
    owners: { type: 'lookup', multiple: true },
    tags: { type: 'tags' },
    meta: { type: 'json' },
    title: { type: 'text' },
  },
};

const holds = (record: Record<string, unknown>, filter: Record<string, unknown>, options?: typeof DECLARED) =>
  matchesFilterCondition(record, filter as FilterCondition, options);

describe('$contains asks membership of a stored array — with no declaration, by the stored value', () => {
  it("'u1' is not a member of a stored ['u10']; it is a member of ['u1', 'u2']", () => {
    expect(holds({ owners: ['u10'] }, { owners: { $contains: 'u1' } })).toBe(false);
    expect(holds({ owners: ['u1', 'u2'] }, { owners: { $contains: 'u1' } })).toBe(true);
  });

  it("the scalar control: a stored string keeps the substring test, so 'u1' is in 'u10'", () => {
    expect(holds({ title: 'u10' }, { title: { $contains: 'u1' } })).toBe(true);
    expect(holds({ title: 'x' }, { title: { $contains: 'u1' } })).toBe(false);
  });

  it('$notContains is the exact complement on both readings, and a value-less column satisfies it', () => {
    expect(holds({ owners: ['u10'] }, { owners: { $notContains: 'u1' } })).toBe(true);
    expect(holds({ owners: ['u1'] }, { owners: { $notContains: 'u1' } })).toBe(false);
    expect(holds({ title: 'u10' }, { title: { $notContains: 'u1' } })).toBe(false);
    expect(holds({ owners: null }, { owners: { $notContains: 'u1' } })).toBe(true);
    expect(holds({}, { owners: { $notContains: 'u1' } })).toBe(true);
    expect(holds({ owners: [] }, { owners: { $notContains: 'u1' } })).toBe(true);
  });

  it('the member is matched exactly and case-sensitively, never as a substring of an element', () => {
    expect(holds({ tags: ['redwood'] }, { tags: { $contains: 'red' } })).toBe(false);
    expect(holds({ tags: ['RED'] }, { tags: { $contains: 'red' } })).toBe(false);
    expect(holds({ tags: ['red'] }, { tags: { $contains: 'red' } })).toBe(true);
  });

  it('a member stored as a number, boolean or null is named by its text — the SQL candidate set', () => {
    expect(holds({ meta: [1, 2] }, { meta: { $contains: '1' } })).toBe(true);
    expect(holds({ meta: [10, 21] }, { meta: { $contains: '1' } })).toBe(false);
    expect(holds({ meta: [1.5] }, { meta: { $contains: '1.50' } })).toBe(true);
    expect(holds({ meta: ['1.5'] }, { meta: { $contains: '1.50' } })).toBe(false);
    expect(holds({ meta: [true] }, { meta: { $contains: 'true' } })).toBe(true);
    expect(holds({ meta: [null] }, { meta: { $contains: 'null' } })).toBe(true);
    // Not a JSON number, so not the number 16: the text '0x10' names only itself.
    expect(holds({ meta: [16] }, { meta: { $contains: '0x10' } })).toBe(false);
  });

  it('a nested array or an object element is not a member', () => {
    expect(holds({ owners: [['u1']] }, { owners: { $contains: 'u1' } })).toBe(false);
    expect(holds({ owners: [{ id: 'u1' }] }, { owners: { $contains: 'u1' } })).toBe(false);
  });

  it('a comparand that is not a string matches nothing, and its negation everything, as before', () => {
    expect(holds({ meta: [1] }, { meta: { $contains: 1 } })).toBe(false);
    expect(holds({ meta: [1] }, { meta: { $notContains: 1 } })).toBe(true);
  });
});

describe('$contains with the declared columns supplied — the declaration decides', () => {
  it('a declared multi-valued column asks membership; a scalar stored there has no member', () => {
    expect(holds({ owners: ['u10'] }, { owners: { $contains: 'u1' } }, DECLARED)).toBe(false);
    expect(holds({ owners: ['u1'] }, { owners: { $contains: 'u1' } }, DECLARED)).toBe(true);
    expect(holds({ owners: 'u1' }, { owners: { $contains: 'u1' } }, DECLARED)).toBe(false);
    expect(holds({ owners: 'u1' }, { owners: { $notContains: 'u1' } }, DECLARED)).toBe(true);
  });

  it('a declared JSON type and a multi-option type ask membership too', () => {
    expect(holds({ meta: [1, 2] }, { meta: { $contains: '1' } }, DECLARED)).toBe(true);
    expect(holds({ tags: ['redwood'] }, { tags: { $contains: 'red' } }, DECLARED)).toBe(false);
  });

  it('a declared scalar column asks substring, so an array stored there matches nothing', () => {
    expect(holds({ title: 'u10' }, { title: { $contains: 'u1' } }, DECLARED)).toBe(true);
    expect(holds({ title: ['u1'] }, { title: { $contains: 'u1' } }, DECLARED)).toBe(false);
    expect(holds({ title: ['u1'] }, { title: { $notContains: 'u1' } }, DECLARED)).toBe(true);
  });

  it('a column the map does not name is judged by its stored value', () => {
    expect(holds({ extra: ['u1'] }, { extra: { $contains: 'u1' } }, DECLARED)).toBe(true);
    expect(holds({ extra: 'u10' }, { extra: { $contains: 'u1' } }, DECLARED)).toBe(true);
  });

  it('the declaration reaches a column under $or, $and and $not', () => {
    const record = { owners: ['u10'], title: 'x' };
    expect(holds(record, { $or: [{ owners: { $contains: 'u1' } }, { title: { $contains: 'y' } }] }, DECLARED)).toBe(false);
    expect(holds(record, { $and: [{ owners: { $contains: 'u10' } }, { title: { $contains: 'x' } }] }, DECLARED)).toBe(true);
    expect(holds(record, { $not: { owners: { $contains: 'u1' } } }, DECLARED)).toBe(true);
  });
});
