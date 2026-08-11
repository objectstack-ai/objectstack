// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6520] `$icontains` on driver-mongodb — server-free, over the documents
 * `translateFilter` emits.
 *
 * Server-free is not a convenience here, it is what makes the cell testable at
 * all: this package is in the #5499 frozen family and its real-mongod suites are
 * OPT-IN (`OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1`), so a suite that needed a
 * server would not run in CI. The pattern this translator emits is the whole
 * behaviour — MongoDB's own `$regex` semantics are not under test — which is the
 * same judgement `mongodb-filter-logic-translation.test.ts` makes for the logic
 * case-set. The emitted patterns are additionally EXECUTED as JS `RegExp`s
 * below, which is the same regex engine flavour and turns "the pattern looks
 * right" into "the pattern selects the right rows".
 *
 * This file deliberately drives the shared text fixture's ROWS rather than
 * naming that case-set's marker export: doing the latter would have flipped
 * this driver's conformance cell to covered while requirement 2 (the
 * `$contains` family's hardcoded `$options: 'i'`) was still open — #6682 — and
 * an entry for a covered cell fails the gate's RECONCILED invariant.
 *
 * [#6682] That requirement is answered now, and the marker is imported by
 * `mongodb-filter-text-conformance.test.ts`, which is what CONSUMED counts and
 * where the ledger row used to be. This file stays as it is rather than being
 * folded into that one: it asserts the emitted PATTERN (`[Aa][Cc]…`, which the
 * case-set cannot express — it speaks in row ids), and the spelled-out cases
 * here are the ASCII-boundary reasoning in the form the #6520 card left it.
 */

import { describe, it, expect } from 'vitest';
import { FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import { translateFilter } from './mongodb-filter.js';

/** The pattern this translator emits for one field's `$icontains`. */
const patternFor = (comparand: string): RegExp => {
  const out = translateFilter({ name: { $icontains: comparand } }) as any;
  const spec = out.name;
  expect(spec, 'no predicate was emitted for $icontains').toBeDefined();
  expect(spec.$options, '$options must NOT be set — it folds the whole Unicode range').toBeUndefined();
  return new RegExp(spec.$regex);
};

/** Ids of the conformance rows the emitted pattern selects. */
const selects = (comparand: string): string[] =>
  FILTER_TEXT_ROWS.filter((r) => patternFor(comparand).test(r.name))
    .map((r) => r.id)
    .sort((a, b) => a.localeCompare(b));

describe('[#6520] $icontains translates to an ASCII-only case-insensitive $regex', () => {
  it('emits a $regex with NO $options — the fold lives in the pattern', () => {
    const out = translateFilter({ name: { $icontains: 'acme' } }) as any;
    expect(out).toEqual({ name: { $regex: '[Aa][Cc][Mm][Ee]' } });
  });

  /**
   * The contrast that makes the row above meaningful, FLIPPED by #6682.
   *
   * This assertion used to pin the DEFECT — the four case-EXACT operators
   * carrying the hardcoded `$options: 'i'` this driver had always had — so that
   * "fixed the family" and "broke `$icontains`" could not be confused for one
   * another. The family is fixed now, so the pin asserts the ruled answer
   * rather than being deleted: `$contains` emits a bare pattern, `$icontains`
   * emits the ASCII class expansion, and the two remain visibly DIFFERENT
   * spellings — which is what this row has always guarded. Neither is
   * `$options: 'i'`, the retired spelling this driver refuses on input (#5702).
   */
  it('the $contains family is case-SENSITIVE beside it — a bare pattern, no $options (#6682)', () => {
    expect(translateFilter({ name: { $contains: 'acme' } })).toEqual({
      name: { $regex: 'acme' },
    });
    // …and the two arms have NOT collapsed into one answer: `$icontains` still
    // folds ASCII case, `$contains` no longer folds anything.
    expect(translateFilter({ name: { $icontains: 'acme' } })).toEqual({
      name: { $regex: '[Aa][Cc][Mm][Ee]' },
    });
  });

  const CASES: Array<[string, string, string[]]> = [
    ['an upper-case row from a lower-case comparand', 'acme', ['1', '2']],
    ['a lower-case row from an upper-case comparand', 'ACME', ['1', '2']],
    ['ASCII-ONLY: `café` does not match `CAFÉ`', 'café', ['4']],
    ['ASCII-ONLY: `CAFÉ` does not match `café`', 'CAFÉ', ['3']],
    ['% is literal, not a wildcard', '100%', ['5']],
    ['_ is literal, not a wildcard', 'a_b', ['7']],
    ['. is literal, not a regex metacharacter', 'a.b', ['9']],
  ];

  for (const [label, comparand, expected] of CASES) {
    it(`selects the right rows: ${label}`, () => {
      expect(selects(comparand)).toEqual(expected);
    });
  }

  it('never selects every row — a dropped predicate WIDENS (#3948)', () => {
    for (const [label, comparand] of CASES) {
      expect(selects(comparand).length, label).toBeLessThan(FILTER_TEXT_ROWS.length);
    }
  });
});

describe('[#6520] $icontains comparand refusals', () => {
  const refusalOf = (filter: unknown): any => {
    try {
      translateFilter(filter as any);
      throw new Error('expected a refusal, got a translation');
    } catch (e: any) {
      return e;
    }
  };

  /**
   * `code` AND `status`, not a bare `toThrow()`. This driver is the exact reason
   * that bar exists: its `default:` arm threw a bare `new Error` with no `code`
   * and no `status` until #5702, so a throw-only assertion was green against the
   * very shape #5702 fixed.
   */
  for (const [label, comparand] of [
    ['an EMPTY comparand — it would match every row', ''],
    ['a NON-STRING comparand — coercion would answer a query nobody wrote', 42],
  ] as const) {
    it(`refuses ${label}`, () => {
      const err = refusalOf({ name: { $icontains: comparand } });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('$icontains');
      expect(err.message).toContain('NON-EMPTY');
    });
  }

  /**
   * The gate sits on the validating WALK, not in the emitter, so a sibling that
   * settles the enclosing node by boolean identity cannot skip it. Without that
   * placement this filter would reduce to TRUE on its first disjunct and the
   * empty comparand would never be judged — the evaluation-order dependence
   * #5368 exists to rule out.
   */
  it('refuses under an $or whose first branch already settles the node', () => {
    const err = refusalOf({ $or: [{}, { name: { $icontains: '' } }] });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('$icontains');
  });
});
