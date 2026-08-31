// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13195] What `translateFilter` emits for `$exists`, and what MongoDB makes
 * of it on a row with NO VALUE — measured, not read.
 *
 * ## The ruling, and why this driver was thought to be the hard half
 *
 * The platform ruling is that `$exists` means "has a value" (`!= null`), never
 * key-presence (#5298 leg 3 / #5369, landed in PR #5962). MongoDB's `$exists`
 * is key-presence at the wire level, so this driver cannot satisfy the ruling
 * by passing the operator through under its own name: it has to emit something
 * other than `{$exists: <bool>}`.
 *
 * ⚖️ RULED 2026-08-30, option A. The something-other is not an invention and
 * cost nothing to find: this same translator ALREADY emits `{$ne: null}` /
 * `{$eq: null}` for `$null`, and the block at the bottom of this file measured
 * that spelling answering the ruling on both readings — which is what turned
 * the open question from "can MongoDB express has-value" (a capability
 * question, answered YES) into "should `$exists` and `$null` stay two
 * spellings of one predicate" (a vocabulary question, and NOT decided here —
 * it is the consumer census, #13492).
 *
 * So this file has been INVERTED IN PLACE per its own former instruction.
 * Nothing was deleted, and nothing was re-baselined onto whatever the new
 * emitter happened to produce: every divergent expectation already named the
 * ruling's answer beside the measured one, and the flip is that named answer.
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
 * write leaves) reach different rules above. Measured: every divergent cell was
 * on the `name: null` reading, and the key-absent reading already answered the
 * ruling. A fixture that spells "no value" as an absent key therefore measured
 * NONE of this — and now measures none of the repair, which is exactly why that
 * column is kept: it is the CONTROL that the emitter moved only what it was
 * meant to. Rule 2 above is what makes `{$ne: null}` answer has-value on the
 * absent reading too, so those rows must read the same before and after.
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
    // [#13195] Modelled because the emitter now produces it: a lowered
    // `$exists` whose key is already taken by a sibling operator is promoted to
    // its own branch rather than merged over the sibling.
    if (field === '$and') {
      if (!(cond as Array<Record<string, unknown>>).every((b) => matchMongoDoc(row, b))) return false;
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
    it('lowers `$exists` to the nullness test, both ways', () => {
      // Was `{name: {$exists: <bool>}}` — the operator passed through under its
      // own name, which is key-presence at the wire level.
      expect(translateFilter({ name: { $exists: true } })).toEqual({ name: { $ne: null } });
      expect(translateFilter({ name: { $exists: false } })).toEqual({ name: { $eq: null } });
    });

    it('the emitted document is EXACTLY what `$null` emits — the same spelling, not a lookalike', () => {
      // The point the ruling turned on: no invention. Asserted as an equality
      // between the two translations rather than by restating the literal, so a
      // change to one that is not made to the other fails here.
      expect(translateFilter({ name: { $exists: true } })).toEqual(
        translateFilter({ name: { $null: false } }),
      );
      expect(translateFilter({ name: { $exists: false } })).toEqual(
        translateFilter({ name: { $null: true } }),
      );
    });

    it('a document-level `$not` leaves as `$nor`, now wrapping the nullness test', () => {
      // MongoDB has no document-level `$not`, so the negation has to change shape;
      // the operator inside it is the lowered one.
      expect(translateFilter({ $not: { name: { $exists: true } } } as never)).toEqual({
        $nor: [{ name: { $ne: null } }],
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

  describe('the `name: null` reading: the cells that diverged, now answering the ruling', () => {
    it('`$exists: true` drops the null row — has-value, the ruling', () => {
      // Was ['1','2','3'] — `{$exists: true}` is key-presence and a stored
      // `null` is present. The ruling's answer, named in this line's own
      // comment before the flip existed.
      expect(ids(NULLED, { name: { $exists: true } })).toEqual(['1', '2']);
    });

    it('THE HARDEST LIVE HARM, CLOSED — `$exists: false` returns the no-value row', () => {
      // Was [] on both spellings. Silent absence, not visible surplus: the row
      // with no value was dropped from the query asking for rows with no
      // value, so the caller had nothing to narrow.
      expect(ids(NULLED, { name: { $exists: false } })).toEqual(['3']);
      expect(ids(NULLED, { $not: { name: { $exists: true } } })).toEqual(['3']);
    });

    it('`$exists: false` and `$not {$exists: true}` AGREE — asserted as an equality', () => {
      // The record requires the two spellings to agree with EACH OTHER as well
      // as with the ruling, so a future change that moves only one of them
      // cannot pass by moving both expectations independently.
      expect(ids(NULLED, { name: { $exists: false } })).toEqual(
        ids(NULLED, { $not: { name: { $exists: true } } }),
      );
      expect(ids(MISSING, { name: { $exists: false } })).toEqual(
        ids(MISSING, { $not: { name: { $exists: true } } }),
      );
    });
  });

  /**
   * [#13195] `$exists` SHARING a field constraint with another operator.
   *
   * Not a cell the card or the ruling names — it is a consequence of the
   * prescribed lowering, found by measuring it. `{$ne: null}` / `{$eq: null}`
   * reuse MongoDB keys an AUTHOR can write on the same field, so a naive merge
   * assigns `$ne` twice into one document and one of the two constraints
   * silently disappears, with WHICH one decided by the author's key order.
   *
   * Measured with the lowering in place and the promotion guard removed:
   * `{name: {$exists: true, $ne: 'beta'}}` emitted `{name: {$ne: 'beta'}}` and
   * the key-swapped spelling emitted `{name: {$ne: null}}` — one predicate, two
   * documents, neither carrying both constraints. The emitter promotes the
   * lowered predicate to its own `$and` branch instead when the key is taken.
   */
  describe('composed constraints — the lowering must not clobber a sibling operator', () => {
    it('both constraints survive, and the two key orders emit the SAME document', () => {
      const a = translateFilter({ name: { $exists: true, $ne: 'beta' } } as never);
      const b = translateFilter({ name: { $ne: 'beta', $exists: true } } as never);
      expect(a).toEqual(b);
      expect(a).toEqual({ $and: [{ name: { $ne: 'beta' } }, { name: { $ne: null } }] });
    });

    it('a free key still merges inline — the promotion is not blanket', () => {
      expect(translateFilter({ name: { $exists: true, $eq: 'alpha-one' } } as never)).toEqual({
        name: { $eq: 'alpha-one', $ne: null },
      });
    });

    it('the composed predicate answers what each half requires, and is narrower than either', () => {
      expect(ids(NULLED, { name: { $exists: true, $ne: 'beta' } })).toEqual(['1']);
      expect(ids(MISSING, { name: { $exists: true, $ne: 'beta' } })).toEqual(['1']);
      // CONTROL — without these the block could pass on a fixture where the two
      // constraints happen to select the same rows, certifying nothing.
      expect(ids(NULLED, { name: { $exists: true } })).toEqual(['1', '2']);
      expect(ids(NULLED, { name: { $ne: 'beta' } })).toEqual(['1', '3']);
    });

    it('`$exists: false` beside an `$eq` keeps the contradiction rather than dropping a half', () => {
      // Unguarded this emitted `{name: {$eq: 'alpha-one'}}` and returned row 1 —
      // a row that HAS a value, answering a filter that demands it have none.
      expect(ids(NULLED, { name: { $exists: false, $eq: 'alpha-one' } })).toEqual([]);
    });
  });

  describe('the has-value spelling this translator ALREADY emits — measured, not proposed', () => {
    /**
     * The block that decided the ruling. It measured that the cost of option A
     * was zero invention — this translator already emitted a has-value spelling
     * — which is why the maintainer's 2026-08-30 ruling could adopt it.
     *
     * ⚠️ It is kept, unchanged, and it is now also a CONTROL: the `$exists`
     * cells above must equal these, and the `$null` cells here must not have
     * moved to meet them. Whether two authorable spellings for one predicate
     * should survive at all is NOT settled by that ruling — it is the consumer
     * census, #13492, and this file decides nothing about it.
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
