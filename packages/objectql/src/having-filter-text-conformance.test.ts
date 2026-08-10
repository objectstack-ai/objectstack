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
 * ## Two rejection rows are DELIBERATELY not enrolled
 *
 * The table's five rejection rows split three/two against what this face does
 * today, measured by execution on `origin/main` @ `3e8e669` before this card's
 * change:
 *
 * | row | `having` today |
 * |:--|:--|
 * | `$regex` refused | refused (uncoded before this card) |
 * | `$regex` + `$options` refused as one mistake | refused (uncoded before this card) |
 * | dangling `$options` refused | refused (uncoded before this card) |
 * | **empty `$icontains` comparand refused** | **NOT refused — matched ALL NINE rows** |
 * | **non-string `$icontains` comparand refused** | **NOT refused — matched none** |
 *
 * The first three are this card: the refusal was already correct and only the
 * envelope was missing, so they are enrolled and are what
 * {@link RETIRED_REJECTION_CASES} drives.
 *
 * The last two are a DIFFERENT defect — a comparand-shape gate this face has
 * never had, which the driver faces get from `driver-memory`'s
 * `icontainsComparandError` and `driver-sql`'s twin. Closing it means REFUSING
 * filters this face evaluates today, which is a behaviour change beyond an
 * envelope card and belongs in its own PR with its own changeset (the same
 * fence #6993 kept, and the reason this card exists separately from it). Note
 * the empty-comparand row in particular: matching all nine rows is a predicate
 * that constrains NOTHING, i.e. the WIDENING that is a permission bypass rather
 * than a degraded filter on an RLS read scope (#3948).
 *
 * They are named here rather than filtered out silently, and pinned by
 * {@link UNENROLLED_REJECTION_CASES} below, so the exclusion is a measured
 * statement that goes RED when it stops being true — not a gap that reads as
 * coverage. Tracked as #7158.
 *
 * @see FILTER_TEXT_CASES — the standard
 * @see https://github.com/objectstack-ai/objectstack/issues/7047 (this card)
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

/** The rejection rows whose refusal this face already makes. */
const RETIRED_REJECTION_SPELLINGS = ['$regex', '$options'] as const;

function isRejection(c: FilterTextCase): c is FilterTextRejectionCase {
  return c.expectRejection === true;
}

/** A rejection row is this card's iff its filter names a RETIRED operator. */
function namesRetiredOperator(c: FilterTextRejectionCase): boolean {
  const constraints = Object.values(c.filter as Record<string, unknown>);
  return constraints.some((spec) =>
    !!spec
    && typeof spec === 'object'
    && Object.keys(spec).some((op) => (RETIRED_REJECTION_SPELLINGS as readonly string[]).includes(op)));
}

const ROWS_CASES = FILTER_TEXT_CASES.filter((c): c is Exclude<FilterTextCase, FilterTextRejectionCase> =>
  !isRejection(c));
const RETIRED_REJECTION_CASES = FILTER_TEXT_CASES.filter(isRejection).filter(namesRetiredOperator);
const UNENROLLED_REJECTION_CASES = FILTER_TEXT_CASES.filter(isRejection).filter((c) => !namesRetiredOperator(c));

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

describe('[#7047] `having` answers FILTER_TEXT_CASES — the retired-operator refusals', () => {
  for (const testCase of RETIRED_REJECTION_CASES) {
    it(`${testCase.name} — refused in the ADR-0112 envelope`, () => {
      let err: (Error & { code?: string; status?: number }) | undefined;
      try {
        applyHaving(AGGREGATED_ROWS, testCase.filter);
      } catch (e) {
        err = e as Error & { code?: string; status?: number };
      }

      // Not `expected: []`. The whole reason `FilterTextRejectionCase` is a
      // separate discriminant is that "returned no rows" and "refused to run"
      // must be told apart — answering zero rows is the silent wrong answer
      // #4706 retired the operator over.
      expect(err, testCase.note ?? 'expected a refusal').toBeInstanceOf(Error);

      // The `code` half — the field this card adds and the reason a
      // throw-only assertion stayed green through the defect.
      expect(err!.code).toBe(testCase.code);
      expect(err!.status).toBe(400);

      for (const mention of testCase.mustMention) expect(err!.message).toContain(mention);
    });
  }

  it('drives every retired-operator rejection row the table declares', () => {
    // A guard on the filters above: if a retired spelling joins
    // `RETIRED_FILTER_OPERATORS` and the table, this count moves and the
    // enrolment is re-read rather than silently skipping the new row.
    expect(RETIRED_REJECTION_CASES.map((c) => c.name)).toEqual([
      '$regex is REFUSED, and the refusal names $icontains',
      '$regex with $options is REFUSED as one mistake, not two',
      'a dangling $options with no $regex is REFUSED',
    ]);
  });
});

/**
 * [#7047] The exclusion, stated as a measurement rather than as prose.
 *
 * These two rows are NOT enrolled above (see the module note). This block pins
 * WHY — the face does not refuse them at all — so the day someone adds the
 * comparand gate, this test goes red and forces the rows into the enrolment
 * instead of leaving them permanently excluded by a comment nobody re-reads.
 * Tracked as #7158.
 */
describe('[#7047] the two comparand-shape rejection rows this face does NOT yet refuse (#7158)', () => {
  it('names exactly the two rows left out of the enrolment', () => {
    expect(UNENROLLED_REJECTION_CASES.map((c) => c.name)).toEqual([
      'an empty $icontains comparand is REFUSED',
      'a non-string $icontains comparand is REFUSED',
    ]);
  });

  it('an empty $icontains comparand is EVALUATED, and matches every row — the widening', () => {
    // The sharp one: a predicate that constrains nothing does not narrow a
    // query, it WIDENS it (#3948). Measured, not predicted.
    expect(matchesHaving({ name: 'ACME Corp' }, { name: { $icontains: '' } })).toBe(true);
    expect(applyHaving(AGGREGATED_ROWS, { name: { $icontains: '' } })).toHaveLength(
      AGGREGATED_ROWS.length);
  });

  it('a non-string $icontains comparand is EVALUATED as "no rows" rather than refused', () => {
    expect(matchesHaving({ name: 'ACME Corp' }, { name: { $icontains: 42 } as never })).toBe(false);
    expect(applyHaving(AGGREGATED_ROWS, { name: { $icontains: 42 } as never })).toHaveLength(0);
  });
});
