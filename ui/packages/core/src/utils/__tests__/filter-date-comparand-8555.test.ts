/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `Date` comparand through `convertFiltersToAST` — objectui#8555.
 *
 * ## The defect
 *
 * The operator-object arm opened on `typeof value === 'object' &&
 * !Array.isArray(value)`. A `Date` passes both tests, so it entered the
 * operator loop — and `Object.entries(someDate)` is `[]`, so the loop body
 * never ran and NO condition was pushed for that field.
 *
 * Not refused, not lowered wrongly: ABSENT. `{ status: 'a', created: someDate }`
 * lowered to `['status', '=', 'a']`, which is a WIDER result set than the author
 * asked for, with nothing thrown and nothing logged — the one failure direction
 * this file exists to avoid.
 *
 * It also made the field's fate depend on its SIBLINGS. With the Date alone,
 * `conditions` ended empty and `convertFiltersToAST` returned the ORIGINAL
 * OBJECT untouched, so the shape survived by accident and the defect only
 * appeared once a second field was present. That asymmetry is part of the bug;
 * section 2 is what pins it closed.
 *
 * ## The ruling — LOWER it, and the spec is what decides that
 *
 * This is the OPPOSITE answer to objectui#8514, which was resolved as a refusal
 * precisely because the spec DECLINED to rule on that shape. Here it rules,
 * measured against `@objectstack/spec` 17.3.0 and pinned in section 3:
 *
 *   - `ACCEPTED_FILTER_COMPARAND_TYPES` is
 *     `['string','number','bigint','boolean','null','Date']` — `Date` is a
 *     first-class literal comparand, and `isAcceptedFilterComparand(new Date())`
 *     is `true`.
 *   - `parseFilterAST(['created', '=', d])` hands back `{ created: d }` with the
 *     Date INSTANCE intact.
 *
 * So the wire-form question the card raised ("ISO string? epoch?") is answered
 * by NOT answering it here: the AST leaf carries the `Date`, exactly as the
 * operator arm has always emitted it for `{ created: { $gte: d } }`.
 * Stringifying in this arm would make the shorthand and the operator form emit
 * two different comparand types for one author intent.
 *
 * ## What carries the weight — three legs, RUN rather than predicted
 *
 * Each was applied to the committed implementation, proved on disk in both
 * directions, and restored by state. The counts and MODES below are measured,
 * not expected — one of them corrected the prediction written here first.
 *
 * 1. **Ablation** — the arm removed. 7 of 16 red. MODE: a MISSING condition.
 *    `{ status, created }` produces `['status', '=', 'a']` and `node[2]` is
 *    `undefined`. Sections 1 and 2 both carry it.
 * 2. **`value.toISOString()`** — the plausible wrong fix, since "what wire
 *    form?" is the question the card asks. 6 of 16 red. MODE: the right node
 *    with the WRONG COMPARAND TYPE — `'2026-01-01T00:00:00.000Z'` where a Date
 *    was expected.
 *    ⚠️ This paragraph first claimed only the `instanceof Date` and
 *    operator-parity pins would discriminate. Measured, six do: every
 *    `toEqual([..., D])` in sections 1 and 2 reddens too, because a string is
 *    not deep-equal to a Date. The correction that matters runs the other way —
 *    §2's "lone and sibling forms lower the SAME field" pin does NOT redden
 *    here, because the caricature is symmetric too. Symmetry alone never
 *    discriminates a wrong comparand type; the `instanceof` / `toBe(D)` pins
 *    are what do, and they are in their own `it()` blocks so no earlier
 *    assertion can stop them running (objectui#8506, objectui#8514).
 * 3. **`Object.keys(value).length === 0` as the gate** — handles the Date and
 *    reads EVERY entry-less object as an equality comparand. 2 of 16 red, both
 *    in section 4, and NOTHING else: for a Date input this caricature is
 *    byte-identical to the shipped fix, which is exactly why section 4 has to
 *    exist. MODE: over-promotion — `{}` and `/x/` appear in comparand position
 *    (`['created', '=', {}]`), and a RegExp comparand is one
 *    `normalizeFilterComparandTypes` refuses outright, so the caricature moves
 *    the failure downstream instead of removing it.
 *    ⚠️ Those three counts DATE FROM objectui#8555's own tree. objectui#8567
 *    then turned section 4's RegExp case from a silent-drop negative into a
 *    refusal, so re-running any of these legs today reads against a different
 *    section 4. The MODES are unchanged; the numbers are historical.
 */

import { describe, it, expect } from 'vitest';
import {
  isFilterAST,
  parseFilterAST,
  isAcceptedFilterComparand,
  ACCEPTED_FILTER_COMPARAND_TYPES,
} from '@objectstack/spec/data';
import {
  convertFiltersToAST,
  toFilterNode,
  mergeFilterNodes,
} from '../filter-converter';

const D = new Date('2026-01-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// 1. The Date is lowered — as a Date, not as a string this layer invented
// ---------------------------------------------------------------------------

describe('objectui#8555 — a Date comparand lowers to an equality node', () => {
  it('lowers { status, created } to BOTH conditions — the sibling no longer eats the Date', () => {
    // The whole node, so the pre-fix failure MODE is legible in the diff: the
    // old emission was `['status', '=', 'a']` — one condition, not two, and no
    // group at all.
    const node = convertFiltersToAST({ status: 'a', created: D });
    expect(node).toEqual(['and', ['status', '=', 'a'], ['created', '=', D]]);
  });

  it('emits the Date INSTANCE, not an ISO string', () => {
    // Its own block on purpose: this is the single assertion that separates the
    // shipped fix from `value.toISOString()`, and an earlier failing assertion
    // in a shared block would stop it ever running (objectui#8506 / #8514).
    const node = convertFiltersToAST({ created: D }) as [string, string, unknown];
    expect(node[2]).toBeInstanceOf(Date);
    expect(node[2]).toBe(D);
    expect(typeof node[2]).not.toBe('string');
  });

  it('emits the SAME comparand the operator arm has always emitted', () => {
    // Parity with `{ created: { $gte: d } }` is the reason the shorthand is not
    // stringified: one author intent, one comparand type. A stringifying fix
    // breaks this and nothing else.
    const shorthand = convertFiltersToAST({ created: D }) as [string, string, unknown];
    const operatorForm = convertFiltersToAST({ created: { $gte: D } }) as [string, string, unknown];
    expect(shorthand[2]).toBe(operatorForm[2]);
  });

  it('produces a node the spec accepts, with the Date intact through its doors', () => {
    const node = convertFiltersToAST({ created: D });
    expect(isFilterAST(node)).toBe(true);
    const parsed = parseFilterAST(node) as { created: unknown };
    expect(parsed).toEqual({ created: D });
    expect(parsed.created).toBeInstanceOf(Date);
  });

  it('lowers a Date inside $and / $or and through both public sinks', () => {
    expect(convertFiltersToAST({ $or: [{ created: D }, { status: 'open' }] }))
      .toEqual(['or', ['created', '=', D], ['status', '=', 'open']]);
    expect(toFilterNode({ status: 'a', created: D }))
      .toEqual(['and', ['status', '=', 'a'], ['created', '=', D]]);
    // One AST-node source beside the object source; `mergeFilterNodes` keeps
    // each source as its own child of the `and`.
    expect(mergeFilterNodes({ created: D }, ['stage', '=', 'won']))
      .toEqual(['and', ['created', '=', D], ['stage', '=', 'won']]);
  });
});

// ---------------------------------------------------------------------------
// 2. The ASYMMETRY — a Date ALONE behaves the same as a Date with siblings
// ---------------------------------------------------------------------------

describe('objectui#8555 — a lone Date is lowered, not handed back unchanged', () => {
  it('no longer returns the original filter object when the Date is the only field', () => {
    // Pre-fix: `conditions` was empty, so the `if (conditions.length === 0)`
    // fallback returned the INPUT OBJECT — `isFilterAST` false, and the wire
    // answers 400. The defect hid here, because the shape came back "unharmed".
    const node = convertFiltersToAST({ created: D });
    expect(node).toEqual(['created', '=', D]);
    expect(node).not.toBe(undefined);
    expect(Array.isArray(node)).toBe(true);
    expect(isFilterAST(node)).toBe(true);
  });

  it('lone and sibling forms lower the SAME field to the SAME condition', () => {
    const alone = convertFiltersToAST({ created: D });
    const withSibling = convertFiltersToAST({ status: 'a', created: D }) as unknown[];
    // The `created` child of the group is byte-for-byte the lone emission.
    expect(withSibling[2]).toEqual(alone);
  });
});

// ---------------------------------------------------------------------------
// 3. Why LOWER and not REFUSE — the spec's own ruling, pinned
// ---------------------------------------------------------------------------

describe('objectui#8555 — the spec rules Date IN, which is why this is not a refusal', () => {
  it('declares Date one of its six accepted literal comparand types', () => {
    expect(ACCEPTED_FILTER_COMPARAND_TYPES).toContain('Date');
    expect(isAcceptedFilterComparand(D)).toBe(true);
  });

  it('accepts a Date in the AST leaf and keeps it a Date', () => {
    // The wire-form question, answered by the spec rather than by this adapter.
    expect(isFilterAST(['created', '=', D])).toBe(true);
    expect((parseFilterAST(['created', '=', D]) as { created: unknown }).created)
      .toBeInstanceOf(Date);
  });

  it('has Date as the ONLY object-typed member, so this arm is a Date arm', () => {
    // The gate is `isAcceptedFilterComparand`, not `instanceof Date`. This pin
    // is what makes that safe to read: every OTHER accepted comparand type is a
    // primitive and can never reach the `typeof value === 'object'` branch. If
    // the spec ever adds a second object-shaped literal, this reddens and the
    // reader learns the arm's reach just widened.
    const objectTyped = ACCEPTED_FILTER_COMPARAND_TYPES.filter(
      (t) => t !== 'string' && t !== 'number' && t !== 'bigint' && t !== 'boolean' && t !== 'null',
    );
    expect(objectTyped).toEqual(['Date']);
  });
});

// ---------------------------------------------------------------------------
// 4. NON-regression — the operator-object path `Object.entries` is there for.
//    This is the axis that separates the fix from "anything entry-less is a
//    comparand". Every case asserts the PRODUCED node.
// ---------------------------------------------------------------------------

describe('objectui#8555 — operator objects lower exactly as before', () => {
  it('$gt / $gte / $lt / $lte still reach the operator loop', () => {
    expect(convertFiltersToAST({ age: { $gt: 26 } })).toEqual(['age', '>', 26]);
    expect(convertFiltersToAST({ age: { $gte: 18, $lte: 65 } }))
      .toEqual(['and', ['age', '>=', 18], ['age', '<=', 65]]);
  });

  it('an operator object carrying a Date value still lowers through the loop', () => {
    // The Date arm must not swallow `{ created: { $gte: d } }`: the VALUE of the
    // field is a plain object there, and only its member is a Date.
    expect(convertFiltersToAST({ created: { $gte: D } })).toEqual(['created', '>=', D]);
    expect(convertFiltersToAST({ created: { $between: [D, D] } }))
      .toEqual(['created', 'between', [D, D]]);
  });

  it('$in / $nin / $null / $exists and the refusals are untouched', () => {
    expect(convertFiltersToAST({ status: { $in: ['a', 'b'] } })).toEqual(['status', 'in', ['a', 'b']]);
    expect(convertFiltersToAST({ deleted: { $null: true } })).toEqual(['deleted', 'is_null', true]);
    expect(convertFiltersToAST({ deleted: { $exists: false } })).toEqual(['deleted', 'is_null', true]);
    expect(() => convertFiltersToAST({ name: { $regex: 'a.c' } })).toThrow(/\$regex/);
    expect(() => convertFiltersToAST({ tags: ['a'] })).toThrow(/bare ARRAY/);
  });

  it('an EMPTY operator object is not a comparand — and beside a key it is refused, not dropped', () => {
    // `{}` has no entries either, so a fix gated on `Object.keys(value).length
    // === 0` would lower it to `['created', '=', {}]`. That fence is unchanged:
    // it never reaches comparand position.
    //
    // ⚠️ FLIPPED ON PURPOSE by objectui#10788. This row used to pin
    // `['status', '=', 'a']` — the `created` key DROPPED and the result WIDER
    // than written, the very direction section 1 above calls this file's one
    // failure mode, read then as "no operators means no constraint".
    // `@objectstack/spec` records `{ field: {} }` as REJECTED by
    // objectstack#5240 (`FilterConditionSchema`), in every position, and
    // objectui#9164 already refused it alone. So it is now refused beside a
    // key too, naming the field; the envelope is pinned in
    // filter-empty-operator-map-beside-key-10788.test.ts.
    let thrown: unknown;
    try {
      convertFiltersToAST({ status: 'a', created: {} });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      name: 'FilterOperatorError', code: 'INVALID_FILTER', httpStatus: 400, field: 'created', operator: undefined,
    });
  });

  it('a non-Date exotic object is NOT promoted into comparand position', () => {
    // A `RegExp` is entry-less too, so the same `Object.keys` caricature would
    // emit `['created', '=', /x/]` — a comparand `normalizeFilterComparandTypes`
    // refuses outright (INVALID_FILTER / 400), i.e. the failure moves downstream
    // rather than going away. That is what section 4 holds closed, and it still
    // does: a RegExp never reaches comparand position.
    //
    // What CHANGED is the other direction. This case used to pin the negative
    // only — `.not.toEqual(...)` — because what the arm did with a RegExp was
    // the same silent DROP objectui#8555 describes, left in place deliberately
    // while only the Date half was in scope. objectui#8567 closed it: the spec
    // rules Date IN and rules RegExp OUT, so the drop became a refusal, and the
    // assertion is now the envelope rather than an inequality. The full class
    // lives in filter-exotic-comparand-8567.test.ts.
    expect(isAcceptedFilterComparand(/x/)).toBe(false);
    let thrown: unknown;
    try {
      convertFiltersToAST({ status: 'a', created: /x/ });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'INVALID_FILTER', httpStatus: 400 });
  });

  it('plain scalars, null and undefined are exactly what they were', () => {
    expect(convertFiltersToAST({ status: 'active' })).toEqual(['status', '=', 'active']);
    expect(convertFiltersToAST({ count: 0, ok: false })).toEqual([
      'and',
      ['count', '=', 0],
      ['ok', '=', false],
    ]);
    // A null/undefined value is skipped before any of this. UPDATED by
    // objectui#9020: an all-skipped filter now says so — `undefined`, "no
    // constraint" — instead of handing back the caller's original object. The
    // SKIP is what this control is about and it did not move; only the tail's
    // answer when the skip leaves nothing behind did.
    expect(convertFiltersToAST({ a: null, b: undefined })).toBeUndefined();
    expect(convertFiltersToAST({ a: null, status: 'active' })).toEqual(['status', '=', 'active']);
  });
});
