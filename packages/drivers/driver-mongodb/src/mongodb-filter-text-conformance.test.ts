// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6682] `driver-mongodb` held to `FILTER_TEXT_CASES` — the text-operator
 * standard, answered without a server.
 *
 * ## Why this file only exists now
 *
 * The cell this file clears carried a measured DEBT row in
 * `scripts/check-driver-conformance.mjs` for as long as either half of the
 * #4706 ruling was open here, because that gate judges coverage by IMPORT: a
 * driver that imports the marker claims the WHOLE case-set, so a face answering
 * one requirement and not the other must not import it. The two halves closed
 * in different PRs:
 *
 * | requirement | where it landed |
 * |:--|:--|
 * | 1 — `$icontains`, ASCII-only (#4706 Q1 = A) | #6520, as a sanctioned one-off inside the #5499 freeze |
 * | 2 — the `$contains` family is case-SENSITIVE (#4706 Q2 = A) | #6682, this change |
 * | 3 — `$regex` / `$options` REFUSED, naming `$icontains` | #5702 |
 *
 * `mongodb-icontains.test.ts` drove `FILTER_TEXT_ROWS` and spelled its own
 * `$icontains` cases rather than naming the marker, precisely so requirement 1
 * would not flip this cell to covered while requirement 2 was open. With
 * requirement 2 answered, the marker comes in here and the ledger row goes in
 * the same PR — deleting it without this file fails CONSUMED, keeping it
 * alongside this file fails RECONCILED.
 *
 * ## Why the assertions run in-process rather than against mongod
 *
 * This package's real-mongod suites are OPT-IN
 * (`OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1`, #5517 — the binary is a ~123 MB
 * download that is not reachable on a restricted network), so a suite that
 * needed a server would not run in CI, and a standard that does not run is the
 * shape #4363 wrote the gate over. `translateFilter` is a pure function and the
 * whole of this driver's answer to these cases: the case sensitivity of a
 * `$regex` predicate is decided entirely by whether `$options: 'i'` is set
 * beside it. So the emitted documents are EVALUATED here, by
 * {@link selectIds}, the same judgement `mongodb-filter-logic-translation.test.ts`
 * makes for the logic case-set and `mongodb-aggregation-translation.test.ts`
 * for the aggregation one. The real-mongod half stays absent and is recorded as
 * such on #6682 rather than implied here.
 *
 * @see FILTER_TEXT_CASES — the standard
 * @see https://github.com/objectstack-ai/objectstack/issues/4706 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/6682 (requirement 2 on this driver)
 * @see https://github.com/objectstack-ai/objectstack/issues/6518 (the same flip on the SQL family)
 */

import { describe, it, expect } from 'vitest';
import {
  FILTER_TEXT_CASES,
  FILTER_TEXT_ROWS,
  type FilterTextCase,
  type FilterTextRejectionCase,
  type FilterTextRow,
} from '@objectstack/spec/data';
import { translateFilter } from './mongodb-filter.js';

// ── A deliberately strict reader of the emitted document ────────────────────
//
// Same discipline as `mongodb-filter-logic-translation.test.ts`'s `matchDoc`:
// every shape it does not model is a thrown error, never a silently-true
// predicate. A stand-in more permissive than the real engine turns this suite
// into a green light for broken code. Its own discrimination is proved at the
// bottom of this file — a folding document must FAIL the case-sensitive rows.

/** Thrown for any shape this matcher does not model — never swallowed. */
class UnsupportedShape extends Error {}

/**
 * `$options` is modelled rather than ignored, and that is the whole point: the
 * defect #6682 fixed was a hardcoded `$options: 'i'`, so a matcher that dropped
 * the flag would have reported the fixed answer from the broken translator.
 */
function matchRegexOps(value: unknown, ops: Record<string, unknown>): boolean {
  const source = ops.$regex;
  if (typeof source !== 'string') throw new UnsupportedShape('$regex without a string pattern');
  const options = ops.$options;
  if (options !== undefined && typeof options !== 'string') {
    throw new UnsupportedShape('$options without a string');
  }
  for (const key of Object.keys(ops)) {
    if (key !== '$regex' && key !== '$options') {
      throw new UnsupportedShape(`unsupported key beside $regex: '${key}'`);
    }
  }
  if (typeof value !== 'string') return false;
  return new RegExp(source, options ?? '').test(value);
}

/** Operators applied to one field's value. */
function matchOps(value: unknown, ops: Record<string, unknown>): boolean {
  const keys = Object.keys(ops);
  if (keys.includes('$regex') || keys.includes('$options')) return matchRegexOps(value, ops);
  for (const [op, arg] of Object.entries(ops)) {
    switch (op) {
      case '$eq':
        if (value !== arg) return false;
        break;
      case '$ne':
        if (value === arg) return false;
        break;
      case '$not': {
        // The per-field negation — the only `$not` MongoDB accepts, and the
        // shape `$notContains` leaves here as.
        if (!arg || typeof arg !== 'object' || Array.isArray(arg)) {
          throw new UnsupportedShape('per-field $not takes an operator document');
        }
        if (matchOps(value, arg as Record<string, unknown>)) return false;
        break;
      }
      default:
        throw new UnsupportedShape(`unsupported field operator '${op}'`);
    }
  }
  return true;
}

/** Evaluate an emitted MongoDB query document against one fixture row. */
function matchDoc(row: FilterTextRow, doc: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith('$')) throw new UnsupportedShape(`unsupported document operator '${key}'`);
    const field = (row as unknown as Record<string, unknown>)[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if (!matchOps(field, value as Record<string, unknown>)) return false;
    } else if (field !== value) {
      return false;
    }
  }
  return true;
}

/** Ids the emitted document selects from the shared fixture, ascending. */
function selectIds(doc: Record<string, unknown>): string[] {
  return FILTER_TEXT_ROWS.filter((row) => matchDoc(row, doc))
    .map((row) => row.id)
    .sort((a, b) => a.localeCompare(b));
}

function isRejection(c: FilterTextCase): c is FilterTextRejectionCase {
  return c.expectRejection === true;
}

const ROWS_CASES = FILTER_TEXT_CASES.filter(
  (c): c is Exclude<FilterTextCase, FilterTextRejectionCase> => !isRejection(c),
);
const REJECTION_CASES = FILTER_TEXT_CASES.filter(isRejection);

// ── The shared standard: the evaluated rows ─────────────────────────────────

describe('[#6682] translateFilter answers FILTER_TEXT_CASES — the evaluated rows', () => {
  for (const testCase of ROWS_CASES) {
    it(testCase.name, () => {
      const doc = translateFilter(testCase.filter) as Record<string, unknown>;
      expect(selectIds(doc), `${testCase.note ?? ''}\nemitted: ${JSON.stringify(doc)}`).toEqual([
        ...testCase.expected,
      ]);
    });
  }
});

// ── The shared standard: the refusals ───────────────────────────────────────

describe('[#6682] translateFilter answers FILTER_TEXT_CASES — every rejection row', () => {
  for (const testCase of REJECTION_CASES) {
    it(`${testCase.name} — refused in the ADR-0112 envelope`, () => {
      let err: (Error & { code?: string; status?: number }) | undefined;
      try {
        translateFilter(testCase.filter);
      } catch (e) {
        err = e as Error & { code?: string; status?: number };
      }
      // Not `expected: []`. `FilterTextRejectionCase` is a separate discriminant
      // because "translated to a predicate that matched nothing" and "refused to
      // run" must be told apart — and `code`/`status` rather than a bare
      // `toThrow()` because this driver is the reason that bar exists: its
      // `default:` arm threw a bare `new Error` with no envelope until #5702.
      expect(err, testCase.note ?? 'expected a refusal').toBeInstanceOf(Error);
      expect(err!.code).toBe(testCase.code);
      expect(err!.status).toBe(400);
      for (const mention of testCase.mustMention) expect(err!.message).toContain(mention);
    });
  }

  it('drives every rejection row the table declares', () => {
    // A guard on the filter above: if a rejection row joins the table, this
    // list moves and the enrolment is re-read rather than silently skipping it.
    expect(REJECTION_CASES.map((c) => c.name)).toEqual([
      '$regex is REFUSED, and the refusal names $icontains',
      '$regex with $options is REFUSED as one mistake, not two',
      'a dangling $options with no $regex is REFUSED',
      'an empty $icontains comparand is REFUSED',
      'a non-string $icontains comparand is REFUSED',
    ]);
  });
});

// ── The matcher is not the thing being tested, so it gets tested ────────────

describe('[#6682] the in-process matcher discriminates', () => {
  it('a folding document FAILS the case-sensitive rows — the #6682 defect itself', () => {
    // This is the exact document `translateFilter` emitted before this change.
    // If the sweep above can pass with this, it is proving nothing.
    expect(selectIds({ name: { $regex: 'acme', $options: 'i' } })).toEqual(['1', '2']);
    expect(selectIds({ name: { $regex: 'acme' } })).toEqual(['2']);
  });

  it('models the per-field $not rather than treating it as true', () => {
    expect(selectIds({ name: { $not: { $regex: 'acme' } } })).toEqual([
      '1', '3', '4', '5', '6', '7', '8', '9',
    ]);
  });

  it('refuses any operator it does not model, rather than answering true', () => {
    expect(() => selectIds({ name: { $unmodelled: 1 } })).toThrow(/unsupported field operator/);
    expect(() => selectIds({ $where: 'true' })).toThrow(/unsupported document operator/);
  });
});
