// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6520] `$icontains` on the HAVING face.
 *
 * HAVING is the evaluation face no conformance table drives (`FILTER_LOGIC_CASES`
 * does not reach this path), which is exactly why it was the last to learn every
 * previous ruling — #5905 found it the lone holdout on #5298's NULL-safety
 * months after the other four faces converged. So the accept table below is
 * written out here rather than inherited, and it is the SAME table the drivers
 * answer: the fixture rows are `FILTER_TEXT_ROWS`, and an aggregated row is just
 * a row as far as a text predicate is concerned.
 *
 * The point of the operator reaching this face at all: `having` filters
 * AGGREGATED rows, so `{ label: { $icontains: 'acme' } }` over a groupBy
 * projection has to select the same labels the same predicate would select as a
 * `where` on any driver. One vocabulary, one fold.
 */

import { describe, it, expect } from 'vitest';
import { FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import { applyHaving } from './having-filter.js';

/** The conformance fixture, read as aggregated rows (`name` is a projection). */
const ROWS = FILTER_TEXT_ROWS.map((r) => ({ ...r, n: Number(r.id) }));

const ids = (having: unknown): string[] =>
  applyHaving(ROWS, having as any).map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));

describe('[#6520] HAVING evaluates $icontains, folding ASCII case only', () => {
  const CASES: Array<[string, unknown, string[]]> = [
    ['an upper-case row from a lower-case comparand', { name: { $icontains: 'acme' } }, ['1', '2']],
    ['a lower-case row from an upper-case comparand', { name: { $icontains: 'ACME' } }, ['1', '2']],
    ['ASCII-ONLY: `café` does not match `CAFÉ`', { name: { $icontains: 'café' } }, ['4']],
    ['ASCII-ONLY: `CAFÉ` does not match `café`', { name: { $icontains: 'CAFÉ' } }, ['3']],
    ['% is literal', { name: { $icontains: '100%' } }, ['5']],
    ['_ is literal', { name: { $icontains: 'a_b' } }, ['7']],
    ['. is literal, not a regex metacharacter', { name: { $icontains: 'a.b' } }, ['9']],
  ];

  for (const [label, having, expected] of CASES) {
    it(label, () => { expect(ids(having)).toEqual(expected); });
  }

  it('never returns every row — an ignored operator returns UNFILTERED aggregates', () => {
    // The failure this face refuses unknown operators to avoid, stated as a
    // count: a `$icontains` that fell through would leave the aggregate
    // unfiltered, and a chart drawn over it looks like a working chart.
    for (const [label, having] of CASES) {
      expect(ids(having).length, label).toBeLessThan(ROWS.length);
    }
  });

  it('leaves $contains case-SENSITIVE — the twin did not absorb its sibling', () => {
    expect(ids({ name: { $contains: 'acme' } })).toEqual(['2']);
    expect(ids({ name: { $contains: 'ACME' } })).toEqual(['1']);
  });

  it('composes under $not / $and like any other operator', () => {
    expect(ids({ $not: { name: { $icontains: 'acme' } } }))
      .toEqual(['3', '4', '5', '6', '7', '8', '9']);
    expect(ids({ $and: [{ name: { $icontains: 'ACME' } }, { n: { $gte: 2 } }] })).toEqual(['2']);
  });

  it('a non-string column does not satisfy it — same guard as $contains', () => {
    expect(applyHaving([{ id: 'x', name: 42 }], { name: { $icontains: '4' } } as any)).toEqual([]);
  });

  /**
   * The refusal wording, kept as a pin because this face's error is the author's
   * whole diagnostic: an operator listed as supported must APPEAR in the
   * "supports:" list a refusal prints, or the list sends its reader looking for
   * a name that is not there.
   */
  it('names $icontains in the supported set a refusal prints', () => {
    const err = (() => {
      try { applyHaving(ROWS, { name: { $sounds_like: 'acme' } } as any); return null; }
      catch (e) { return e as Error; }
    })();
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('$icontains');
  });
});
