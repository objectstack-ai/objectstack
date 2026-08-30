// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13166] A row with NO VALUE satisfies a negation-carrying operator — the
 * six cells, on this matcher, stated directly rather than through a `$not`.
 *
 * ## The ruling this file enforces
 *
 * `$ne` / `$nin` / `$notContains` MATCH a row whose field has no value. That is
 * the INCLUDE direction: #5146 made `$not` NULL-safe, #5298 option A extended it
 * to the non-negated negative operators, and the 2026-08-10 reversal that would
 * have taken SQL's three-valued answer as the common denominator was WITHDRAWN
 * the same day once its cross-backend cost had been measured. Ten other surfaces
 * already answer this way — `formula` (`matches-filter-not-null-safe.test.ts`),
 * the four SQL compilers via `nullSafeNegative` / `nullValueSatisfiesOperator`,
 * and `driver-mongodb`, which passes `$nin` through and compiles `$notContains`
 * to `{ $not: { $regex } }`, both of which match a missing or null field.
 *
 * ## Why the table has SIX cells and not three
 *
 * "No value" has two readings that this matcher reaches through DIFFERENT code,
 * so a three-cell table cannot see the difference between them:
 *
 *   - `name: null` — the shape a SQL NULL round-trips into a record.
 *   - the key absent — the shape a partial write leaves.
 *
 * Collapsing them is how the divergence stayed invisible: two INDEPENDENT causes
 * produced it, each reachable from only one of the two readings, so a fixture
 * carrying one reading measures at most one of them. Keep both columns.
 *
 * ⚠️ Do not collapse this into a single case, and do not add `$exists` to it.
 * `$exists` is the neighbouring cell (#13195): this package's live mingo path
 * and `driver-mongodb` still read it as key-presence rather than has-value, so
 * it is a different, still-open divergence with a different backend list.
 *
 * The complementary POSITIVE operators are asserted beside each negative one, so
 * a matcher that started answering "every row" to everything cannot pass this
 * file: the ruling is that a no-value row joins the negative answer, not that
 * predicates stop discriminating.
 */

import { describe, it, expect } from 'vitest';

import { match } from './memory-matcher.js';

/** `name` present but null — how a SQL NULL round-trips into a record. */
const NULLED: Array<Record<string, unknown>> = [
  { id: '1', name: 'alpha-one' },
  { id: '2', name: 'beta' },
  { id: '3', name: null },
];

/** The same rows with `name` ABSENT — the shape a partial write leaves. */
const MISSING: Array<Record<string, unknown>> = [
  { id: '1', name: 'alpha-one' },
  { id: '2', name: 'beta' },
  { id: '3' },
];

const ids = (rows: Array<Record<string, unknown>>, filter: unknown): string[] =>
  rows.filter((r) => match(r, filter)).map((r) => String(r.id));

/** The ruling's answer: row 2 has a different value, row 3 has none. */
const NO_VALUE_INCLUDED = ['2', '3'];

describe('[#13166] no-value rows and the negation-carrying operators', () => {
  describe('the six cells — three operators x two readings of "no value"', () => {
    const OPERATORS: Array<[name: string, filter: unknown]> = [
      ['$ne', { name: { $ne: 'alpha-one' } }],
      ['$nin', { name: { $nin: ['alpha-one'] } }],
      ['$notContains', { name: { $notContains: 'one' } }],
    ];

    for (const [op, filter] of OPERATORS) {
      it(`${op}: a null value satisfies it`, () => {
        expect(ids(NULLED, filter)).toEqual(NO_VALUE_INCLUDED);
      });

      it(`${op}: an absent key satisfies it`, () => {
        expect(ids(MISSING, filter)).toEqual(NO_VALUE_INCLUDED);
      });

      it(`${op}: both readings of "no value" answer alike`, () => {
        expect(ids(MISSING, filter)).toEqual(ids(NULLED, filter));
      });
    }
  });

  describe('the operators still discriminate — this is not "match everything"', () => {
    it('each negation excludes the row that DOES carry the comparand', () => {
      expect(ids(NULLED, { name: { $ne: 'alpha-one' } })).not.toContain('1');
      expect(ids(NULLED, { name: { $nin: ['alpha-one'] } })).not.toContain('1');
      expect(ids(NULLED, { name: { $notContains: 'one' } })).not.toContain('1');
    });

    it('the positive twins keep answering the complement over the VALUED rows', () => {
      // A no-value row is in NEITHER answer for the positive operators: the
      // ruling moved the negative cells only.
      expect(ids(NULLED, { name: { $eq: 'alpha-one' } })).toEqual(['1']);
      expect(ids(MISSING, { name: { $in: ['alpha-one'] } })).toEqual(['1']);
      expect(ids(NULLED, { name: { $contains: 'one' } })).toEqual(['1']);
      expect(ids(MISSING, { name: { $contains: 'one' } })).toEqual(['1']);
    });

    it('a present non-string value still fails $notContains on the type test', () => {
      // Out of scope for this card, and stated so a later reader does not read
      // the fix above as "any non-string satisfies the negation". Only the
      // no-value readings moved; a value that is there and is not a string
      // keeps the answer it had.
      expect(ids([{ id: '9', name: 42 }], { name: { $notContains: 'one' } })).toEqual([]);
    });
  });

  describe('cross-operator agreement, the invariant that outlives the fixture', () => {
    it('$nin answers exactly what $ne answers — it is the list form of it', () => {
      // `formula`'s suite states the same identity over its own fixture. `$ne`
      // is the operator ENROLLED in `FILTER_LOGIC_CASES`, so this is the link
      // between the enrolled cell and the two that are not enrolled yet.
      for (const rows of [NULLED, MISSING]) {
        expect(ids(rows, { name: { $nin: ['alpha-one'] } }))
          .toEqual(ids(rows, { name: { $ne: 'alpha-one' } }));
      }
    });

    it('$contains and $notContains partition the VALUED rows and both keep the no-value row out of the positive side', () => {
      for (const rows of [NULLED, MISSING]) {
        const inside = ids(rows, { name: { $contains: 'one' } });
        const outside = ids(rows, { name: { $notContains: 'one' } });
        expect(inside).toEqual(['1']);
        expect(outside).toEqual(NO_VALUE_INCLUDED);
        expect(inside.filter((id) => outside.includes(id))).toEqual([]);
        expect([...inside, ...outside].sort()).toEqual(['1', '2', '3']);
      }
    });
  });
});
