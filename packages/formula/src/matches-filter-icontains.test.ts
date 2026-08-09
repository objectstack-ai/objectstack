// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6520] `$icontains` on `matchesFilterCondition` — the RLS write-side `check`.
 *
 * This face is the one where the fold's DOMAIN is a security property rather
 * than a nicety. `matchesFilterCondition` evaluates the post-image of a write
 * against the same predicate `read-scope-sql.ts` compiles to SQL for the read
 * side. If this evaluator folded Unicode (the obvious `toLowerCase()`) while the
 * read scope folded ASCII, one policy would ALLOW a write here that the read
 * scope then hides — one rule, two row sets, which is #3948 reached through case
 * folding rather than through a dropped predicate.
 *
 * The census note on #6520 (#6993) measured this face answering `$icontains`
 * with a silent `false` before this change — not a refusal, an ANSWER of "no".
 * That is what these cases replace.
 */

import { describe, it, expect } from 'vitest';
import { FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import { matchesFilterCondition } from './matches-filter.js';

const ids = (filter: unknown): string[] =>
  FILTER_TEXT_ROWS.filter((r) => matchesFilterCondition({ ...r }, filter as any))
    .map((r) => r.id)
    .sort((a, b) => a.localeCompare(b));

describe('[#6520] matchesFilterCondition evaluates $icontains, ASCII fold only', () => {
  const CASES: Array<[string, unknown, string[]]> = [
    ['an upper-case row from a lower-case comparand', { name: { $icontains: 'acme' } }, ['1', '2']],
    ['a lower-case row from an upper-case comparand', { name: { $icontains: 'ACME' } }, ['1', '2']],
    ['ASCII-ONLY: `café` does not match `CAFÉ`', { name: { $icontains: 'café' } }, ['4']],
    ['ASCII-ONLY: `CAFÉ` does not match `café`', { name: { $icontains: 'CAFÉ' } }, ['3']],
    ['% is literal', { name: { $icontains: '100%' } }, ['5']],
    ['_ is literal', { name: { $icontains: 'a_b' } }, ['7']],
    ['. is literal, not a regex metacharacter', { name: { $icontains: 'a.b' } }, ['9']],
  ];

  for (const [label, filter, expected] of CASES) {
    it(label, () => { expect(ids(filter)).toEqual(expected); });
  }

  it('is no longer the silent `false` the #6993 census measured', () => {
    // The exact call from that census note, which returned `false` before.
    expect(matchesFilterCondition({ name: 'ACME CORP' }, { name: { $icontains: 'acme' } } as any))
      .toBe(true);
  });

  it('answers FALSE for a genuine non-match, not merely for an unknown operator', () => {
    expect(matchesFilterCondition({ name: 'zzz' }, { name: { $icontains: 'acme' } } as any))
      .toBe(false);
  });

  it('leaves $contains case-SENSITIVE', () => {
    expect(ids({ name: { $contains: 'acme' } })).toEqual(['2']);
  });

  it('composes under $or / $not, and a missing column does not satisfy it', () => {
    expect(ids({ $or: [{ name: { $icontains: 'ACME' } }, { name: { $icontains: 'a.b' } }] }))
      .toEqual(['1', '2', '9']);
    expect(matchesFilterCondition({ other: 'x' }, { name: { $icontains: 'acme' } } as any))
      .toBe(false);
  });

  /**
   * Fail-closed at the comparand, matching the drivers' refusal condition in
   * VERDICT even though this face expresses it as a denial rather than a throw
   * (see the module header's posture section). An empty comparand would
   * otherwise satisfy every post-image, which on a `check` clause means a rule
   * that permits every write.
   */
  it('DENIES an empty comparand rather than matching every record', () => {
    expect(matchesFilterCondition({ name: 'anything' }, { name: { $icontains: '' } } as any))
      .toBe(false);
  });

  it('DENIES a non-string comparand rather than coercing it', () => {
    expect(matchesFilterCondition({ name: '42' }, { name: { $icontains: 42 } } as any))
      .toBe(false);
  });
});

describe('[#6520] the unknown-operator posture, pinned as DECIDED', () => {
  /**
   * The decision recorded on `matches-filter.ts`'s header: unknown operators
   * keep the silent `false` on this face, because it governs a WRITE-side check
   * (an unevaluable condition DENIES, it does not widen) and because callers
   * such as `plugin-security`'s explain engine rely on this function being a
   * TOTAL per-record predicate.
   *
   * Pinned so the posture cannot drift unnoticed in either direction: an
   * upgrade to throwing should have to edit this test and say so.
   */
  it('answers an unknown operator with `false`, and does not throw', () => {
    expect(() => matchesFilterCondition({ name: 'x' }, { name: { $sounds_like: 'x' } } as any))
      .not.toThrow();
    expect(matchesFilterCondition({ name: 'x' }, { name: { $sounds_like: 'x' } } as any))
      .toBe(false);
  });

  it('answers a RETIRED spelling the same way — the residue #6520 left open', () => {
    // The other five JS faces throw INVALID_FILTER naming `$icontains` here.
    // This face denies silently. Recorded as the current, deliberate state, not
    // endorsed: see the module header's closing paragraph.
    expect(matchesFilterCondition({ name: 'acme' }, { name: { $regex: 'ac.*' } } as any))
      .toBe(false);
  });

  it('still THROWS for the one shape #5240 ruled refused', () => {
    // The posture is "silent false for vocabulary, throw for the ruled shape" —
    // this case is what keeps the two from being confused for one another.
    expect(() => matchesFilterCondition({ name: 'x' }, { name: {} } as any)).toThrow();
  });
});
