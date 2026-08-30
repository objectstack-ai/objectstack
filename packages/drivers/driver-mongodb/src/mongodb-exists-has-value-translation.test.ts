// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13195] What `translateFilter` emits for `$exists`, and what MongoDB makes
 * of it on a row with NO VALUE — measured, not read.
 *
 * ## The ruling, and why this driver is the hard half
 *
 * The platform ruling is that `$exists` means "has a value" (`!= null`), never
 * key-presence (#5298 leg 3 / #5369, landed in PR #5962). MongoDB's `$exists`
 * is key-presence at the wire level, so this driver cannot satisfy the ruling
 * by passing the operator through under its own name: it would have to emit
 * something other than `{$exists: <bool>}`. That is a direction nobody has
 * ruled on, so this file DECIDES NOTHING. It pins the present.
 *
 * ⚠️ WHEN THE DIRECTION IS DECIDED, INVERT THESE IN PLACE — do not delete them,
 * and do not re-baseline them to whatever the new emitter happens to produce.
 * Every divergent expectation names the ruling's answer beside the measured
 * one, so the flip is a reviewable one-line edit.
 *
 * ## What was measured, and against what
 *
 * The row-level halves below run against {@link matchMongoDoc}, a deliberately
 * strict stand-in that models only the operators these cases emit and THROWS on
 * everything else — the same discipline, and the same reason, as
 * `mongodb-filter-logic-translation.test.ts`: a stand-in more permissive than
 * the real engine turns a suite into a green light for broken code. Its own
 * discrimination is proved below rather than assumed.
 *
 * The stand-in is not the authority for the two rules that decide these cells,
 * so neither is taken on trust:
 *
 *   1. `$exists` tests FIELD PRESENCE, and a stored `null` is present.
 *   2. Equality treats a MISSING field and a stored `null` IDENTICALLY, which is
 *      why `$ne: null` and `$eq: null` answer has-value. This repo already
 *      states that rule in `mongodb-driver.ts`, beside the `$null` lowering:
 *      "`$null: true` lowers to `$eq: null` and `$null: false` to `$ne: null`,
 *      and MongoDB matches a missing field and a stored `null` identically
 *      under both."
 *
 * Both were additionally executed once against a REAL mongod 8.2.6 while this
 * card was measured, and the real engine returned exactly the ids asserted
 * here. That half is not repeated in CI: `test-mongod.ts` gates the binary
 * behind {@link https://github.com/objectstack-ai/objectstack/issues/5517} and
 * a 123 MB download, and the always-run half is the one that catches a
 * defect on a restricted network.
 *
 * ## Why the fixture carries TWO readings of "no value"
 *
 * `name: null` (how a SQL NULL round-trips) and the key ABSENT (what a partial
 * write leaves) reach different rules above. Measured: every divergent cell is
 * on the `name: null` reading, and the key-absent reading already answers the
 * ruling. A fixture that spells "no value" as an absent key therefore measures
 * NONE of this. Keep both columns.
 */

import { describe, it, expect } from 'vitest';

import { translateFilter } from './mongodb-filter.js';

/** `name` present but NULL — how a SQL NULL round-trips into a record. */
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

/** Thrown for any shape this stand-in does not model — never swallowed. */
class UnsupportedShape extends Error {}

/** MongoDB's documented semantics for exactly the operators these cases emit. */
function matchMongoDoc(row: Record<string, unknown>, doc: Record<string, unknown>): boolean {
  for (const [field, cond] of Object.entries(doc)) {
    if (field === '$nor') {
      if ((cond as Array<Record<string, unknown>>).some((b) => matchMongoDoc(row, b))) return false;
      continue;
    }
    if (field.startsWith('$')) throw new UnsupportedShape(`unsupported top-level operator '${field}'`);
    const present = Object.prototype.hasOwnProperty.call(row, field);
    // Rule 2: equality treats a MISSING field as `null`. `$exists` (rule 1) does not.
    const equalityValue = present ? row[field] : null;
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) {
      if (equalityValue !== cond) return false;
      continue;
    }
    for (const [op, arg] of Object.entries(cond as Record<string, unknown>)) {
      switch (op) {
        case '$exists':
          if (present !== Boolean(arg)) return false;
          break;
        case '$eq':
          if (equalityValue !== arg) return false;
          break;
        case '$ne':
          if (equalityValue === arg) return false;
          break;
        default:
          throw new UnsupportedShape(`unsupported field operator '${op}'`);
      }
    }
  }
  return true;
}

const ids = (rows: Array<Record<string, unknown>>, authorable: unknown): string[] => {
  const doc = translateFilter(authorable as never) as unknown as Record<string, unknown>;
  return rows
    .filter((r) => matchMongoDoc(r, doc))
    .map((r) => String(r.id))
    .sort();
};

describe('[#13195] `$exists` translation and its answer on a no-value row', () => {
  describe('the emitted document — the machine-checkable half, no semantics needed', () => {
    it('passes `$exists` through under its own name, both ways', () => {
      expect(translateFilter({ name: { $exists: true } })).toEqual({ name: { $exists: true } });
      expect(translateFilter({ name: { $exists: false } })).toEqual({ name: { $exists: false } });
    });

    it('a document-level `$not` leaves as `$nor`, still wrapping a bare `$exists`', () => {
      // MongoDB has no document-level `$not`, so the negation has to change shape;
      // the operator inside it does not.
      expect(translateFilter({ $not: { name: { $exists: true } } } as never)).toEqual({
        $nor: [{ name: { $exists: true } }],
      });
    });
  });

  describe('the key-absent reading: the emitted document already answers the ruling', () => {
    it('`$exists: true` excludes the no-key row, `$exists: false` returns it', () => {
      expect(ids(MISSING, { name: { $exists: true } })).toEqual(['1', '2']);
      expect(ids(MISSING, { name: { $exists: false } })).toEqual(['3']);
      expect(ids(MISSING, { $not: { name: { $exists: true } } })).toEqual(['3']);
    });
  });

  describe('the `name: null` reading: DIVERGENT on every cell', () => {
    it('`$exists: true` keeps the null row — key-presence, where the ruling says has-value', () => {
      // Ruling: ['1','2']. Measured: ['1','2','3'].
      expect(ids(NULLED, { name: { $exists: true } })).toEqual(['1', '2', '3']);
    });

    it('`$exists: false` returns NOTHING — the worse direction, and unrecorded until now', () => {
      // Ruling: ['3']. Measured: []. Silent absence, not visible surplus: the
      // row with no value is dropped from the query asking for rows with no
      // value, so the caller has nothing to narrow.
      expect(ids(NULLED, { name: { $exists: false } })).toEqual([]);
      expect(ids(NULLED, { $not: { name: { $exists: true } } })).toEqual([]);
    });
  });

  describe('the has-value spelling this translator ALREADY emits — measured, not proposed', () => {
    /**
     * Stated because the cost of the open direction is otherwise guessed. It is
     * NOT a recommendation and NOT a decision: what a has-value `$exists` should
     * compile to, and whether it should become an exact synonym for the negation
     * of `$null`, is the fork this card hands to the decision box.
     */
    it('`$null` lowers to `$ne: null` / `$eq: null`, which answer has-value on BOTH readings', () => {
      expect(translateFilter({ name: { $null: false } })).toEqual({ name: { $ne: null } });
      expect(translateFilter({ name: { $null: true } })).toEqual({ name: { $eq: null } });

      // The ruling's answers for `$exists: true` / `$exists: false`, reached by
      // a document this same file already emits.
      expect(ids(NULLED, { name: { $null: false } })).toEqual(['1', '2']);
      expect(ids(MISSING, { name: { $null: false } })).toEqual(['1', '2']);
      expect(ids(NULLED, { name: { $null: true } })).toEqual(['3']);
      expect(ids(MISSING, { name: { $null: true } })).toEqual(['3']);
    });
  });

  describe('controls — the stand-in discriminates, so "all green" is not vacuous', () => {
    it('an empty document matches every row and a value predicate narrows to one', () => {
      expect(NULLED.filter((r) => matchMongoDoc(r, {})).map((r) => String(r.id))).toEqual(['1', '2', '3']);
      expect(ids(NULLED, { name: { $eq: 'beta' } })).toEqual(['2']);
    });

    it('an unmodelled operator THROWS rather than answering true', () => {
      expect(() => matchMongoDoc(NULLED[0]!, { name: { $gt: 1 } })).toThrow(UnsupportedShape);
      expect(() => matchMongoDoc(NULLED[0]!, { $expr: {} })).toThrow(UnsupportedShape);
    });
  });
});
