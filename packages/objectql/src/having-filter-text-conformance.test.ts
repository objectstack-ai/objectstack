// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7047] `having` held to `FILTER_TEXT_CASES` — the standard the driver faces
 * answer, driven against the SIXTH text-operator face.
 *
 * ## Why this file exists at all
 *
 * `having` is the one refusal face with no conformance-table coverage, and both
 * of the last two defects on it say the same thing about that gap:
 *
 * - #5905: HAVING was the lone holdout on #5298's NULL-safety ruling, and "no
 *   conformance table would have caught it, because `FILTER_LOGIC_CASES` does
 *   not drive the HAVING path".
 * - #7047 (this card): HAVING was the lone face whose refusals carried no
 *   ADR-0112 envelope, while `FilterTextRejectionCase.code` — the field that
 *   pins exactly that — sat in a table this package imported nowhere.
 *
 * `scripts/check-driver-conformance.mjs` scopes its ledger to
 * `packages/drivers/*`, so no gate was ever going to notice. Both defects were
 * found by a human-run census (#6993) rather than by CI, twice. This file is
 * the coverage, so the five faces cannot drift apart again silently.
 *
 * ## [#7158] ALL FIVE rejection rows are enrolled now
 *
 * When #7047 wrote this file the table's five rejection rows split three/two
 * against what this face did, measured by execution on `origin/main` @
 * `3e8e669`:
 *
 * | row | `having` under #7047 | `having` now (#7158) |
 * |:--|:--|:--|
 * | `$regex` refused | refused, enveloped by #7047 | unchanged |
 * | `$regex` + `$options` refused as one mistake | refused, enveloped by #7047 | unchanged |
 * | dangling `$options` refused | refused, enveloped by #7047 | unchanged |
 * | **empty `$icontains` comparand refused** | **NOT refused — matched ALL NINE rows** | **refused** |
 * | **non-string `$icontains` comparand refused** | **NOT refused — matched none** | **refused** |
 *
 * The first three were #7047's: the refusal was already correct and only the
 * envelope was missing. The last two were a DIFFERENT defect — a comparand-shape
 * gate this face had never had, which the driver faces get from `driver-memory`'s
 * `icontainsComparandError` and `driver-sql`'s twin — and closing it meant
 * REFUSING filters this face used to evaluate, a behaviour change that took its
 * own card and its own changeset (the same fence #6993 kept). That card is
 * #7158, and `having-filter.ts`'s `icontainsComparandError` is its landing.
 *
 * #7047 did not filter those two rows out silently: it PINNED them as
 * measurements — asserting that the face did not refuse them, and that the empty
 * comparand matched all nine rows — precisely so that adding the gate would go
 * RED and force them into the enrolment rather than leaving a gap that reads as
 * coverage. It did. {@link REJECTION_CASES} is now every rejection row the table
 * declares, and the flipped measurements are kept below rather than deleted, in
 * their new direction: the two expressions that used to answer now refuse.
 *
 * @see FILTER_TEXT_CASES — the standard
 * @see https://github.com/objectstack-ai/objectstack/issues/7047 (the envelope card, which wrote this file)
 * @see https://github.com/objectstack-ai/objectstack/issues/7158 (the comparand gate)
 * @see https://github.com/objectstack-ai/objectstack/issues/6993 (the five-face census)
 * @see https://github.com/objectstack-ai/objectstack/issues/5324 (the envelope half)
 */

import { describe, it, expect } from 'vitest';
import {
  FILTER_TEXT_CASES,
  FILTER_TEXT_ROWS,
  type FilterTextCase,
  type FilterTextRejectionCase,
} from '@objectstack/spec/data';
import { applyHaving, matchesHaving } from './having-filter.js';

function isRejection(c: FilterTextCase): c is FilterTextRejectionCase {
  return c.expectRejection === true;
}

const ROWS_CASES = FILTER_TEXT_CASES.filter((c): c is Exclude<FilterTextCase, FilterTextRejectionCase> =>
  !isRejection(c));

/**
 * [#7158] EVERY rejection row the table declares — no `namesRetiredOperator`
 * partition any more, because the two families it separated are both refused by
 * this face now. The partition existed to name an EXCLUSION; with nothing
 * excluded, keeping it would mean re-deriving a distinction the enrolment no
 * longer makes.
 */
const REJECTION_CASES = FILTER_TEXT_CASES.filter(isRejection);

/**
 * A rejection row's refusal, asserted on the ADR-0112 envelope rather than on
 * "it threw".
 *
 * `toThrow()` alone carries one bit where the defect has two (#6142/#6050) — it
 * is exactly what stayed green through #7047's missing `code`/`status`, and what
 * would stay green again if this face grew a second error shape for the same
 * mistake.
 */
function expectRefusal(
  run: () => unknown,
  testCase: FilterTextRejectionCase,
): void {
  let err: (Error & { code?: string; status?: number }) | undefined;
  try {
    run();
  } catch (e) {
    err = e as Error & { code?: string; status?: number };
  }

  // Not `expected: []`. The whole reason `FilterTextRejectionCase` is a separate
  // discriminant is that "returned no rows" and "refused to run" must be told
  // apart — answering zero rows is the silent wrong answer #4706 retired the
  // operator over, and (for the comparand rows) the very shape #7158 closed.
  expect(err, testCase.note ?? 'expected a refusal').toBeInstanceOf(Error);
  expect(err!.code).toBe(testCase.code);
  expect(err!.status).toBe(400);
  for (const mention of testCase.mustMention) expect(err!.message).toContain(mention);
}

/**
 * The fixture rows are `{ id, name }`, which is exactly the shape of an
 * aggregated row this face filters — a groupBy projection (`name`) beside an
 * identifier. No adaptation needed, which is the point: HAVING's namespace is
 * the aggregated row's own columns, so one text predicate must select the same
 * rows here as it does in a driver's `where`.
 */
const AGGREGATED_ROWS = FILTER_TEXT_ROWS.map((row) => ({ ...row }));

describe('[#7047] `having` answers FILTER_TEXT_CASES — the evaluated rows', () => {
  // The precondition for the refusal half meaning anything. If this face
  // selected different rows from the driver faces, agreeing on the shape of a
  // refusal would be agreement about the wrong thing.
  for (const testCase of ROWS_CASES) {
    it(testCase.name, () => {
      const ids = applyHaving(AGGREGATED_ROWS, testCase.filter).map((row) => row.id);
      expect(ids, testCase.note).toEqual([...testCase.expected]);
    });
  }
});

describe('[#7047/#7158] `having` answers FILTER_TEXT_CASES — every rejection row', () => {
  for (const testCase of REJECTION_CASES) {
    it(`${testCase.name} — refused in the ADR-0112 envelope`, () => {
      expectRefusal(() => applyHaving(AGGREGATED_ROWS, testCase.filter), testCase);
    });
  }

  it('drives every rejection row the table declares', () => {
    // A guard on the filter above: if a rejection row joins the table — a new
    // retirement, or a comparand shape some face stops evaluating — this list
    // moves and the enrolment is re-read rather than silently skipping it.
    //
    // [#7158] The last two rows are the ones #7047 could not enrol. They are IN
    // this list now, which is the single assertion that says the exclusion is
    // over: five declared, five driven.
    expect(REJECTION_CASES.map((c) => c.name)).toEqual([
      '$regex is REFUSED, and the refusal names $icontains',
      '$regex with $options is REFUSED as one mistake, not two',
      'a dangling $options with no $regex is REFUSED',
      'an empty $icontains comparand is REFUSED',
      'a non-string $icontains comparand is REFUSED',
    ]);
  });
});

/**
 * [#7158] The two measurements #7047 pinned, kept and FLIPPED.
 *
 * These are the same four expressions that block asserted, in their new
 * direction. They are not folded into the enrolment above because they say
 * something the table-driven rows cannot: the enrolment asserts that a REJECTION
 * ROW is refused, while these assert that the two specific behaviours the defect
 * consisted of — matching every row, and answering "no rows" — are gone at the
 * `matchesHaving` entry point as well as at `applyHaving`.
 *
 * The empty-comparand half is the sharp one: it is not a filter that returned
 * the wrong rows, it is a filter that returned the UNFILTERED aggregate (#3948),
 * which on an RLS read scope is a permission bypass rather than a degraded
 * filter.
 */
describe('[#7158] the two comparand-shape measurements, in their post-gate direction', () => {
  const EMPTY_COMPARAND_CASE = REJECTION_CASES.find(
    (c) => c.name === 'an empty $icontains comparand is REFUSED')!;
  const NON_STRING_COMPARAND_CASE = REJECTION_CASES.find(
    (c) => c.name === 'a non-string $icontains comparand is REFUSED')!;

  it('an empty $icontains comparand is REFUSED — it no longer matches every row', () => {
    expectRefusal(
      () => matchesHaving({ name: 'ACME Corp' }, { name: { $icontains: '' } }),
      EMPTY_COMPARAND_CASE);
    expectRefusal(
      () => applyHaving(AGGREGATED_ROWS, { name: { $icontains: '' } }),
      EMPTY_COMPARAND_CASE);
  });

  it('a non-string $icontains comparand is REFUSED — it no longer answers "no rows"', () => {
    expectRefusal(
      () => matchesHaving({ name: 'ACME Corp' }, { name: { $icontains: 42 } as never }),
      NON_STRING_COMPARAND_CASE);
    expectRefusal(
      () => applyHaving(AGGREGATED_ROWS, { name: { $icontains: 42 } as never }),
      NON_STRING_COMPARAND_CASE);
  });

  /**
   * The refusal NAMES the position, which is what makes it actionable on a face
   * whose clause nests. `having.$and[0].name.$icontains` tells its reader which
   * branch of which clause to fix; `having` alone would not.
   */
  it('names the field and its position inside the `having` clause', () => {
    const err = (() => {
      try {
        applyHaving(AGGREGATED_ROWS, { $and: [{ name: { $icontains: '' } }] });
        return null;
      } catch (e) { return e as Error; }
    })();
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('on field "name"');
    expect(err!.message).toContain('at having.$and[0].name.$icontains');
  });
});
