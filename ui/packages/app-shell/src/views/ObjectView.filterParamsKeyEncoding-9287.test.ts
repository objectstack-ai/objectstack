/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9287 — `ObjectView` re-serialized its `filter[...]` memo key BY HAND,
 * so a value containing `&` or `+` reached the reader mangled.
 *
 * The key was built as `entries().map(([k, v]) => k + '=' + v).join('&')` and
 * then re-parsed with `new URLSearchParams(key)`. `entries()` yields DECODED
 * values, and the join put back, unescaped, the two characters that are
 * STRUCTURAL in a query string:
 *
 *   - `&` TRUNCATED the value at its first occurrence — `Smith & Sons` reached
 *     the reader as `Smith `, plus a stray empty-valued param;
 *   - `+` came back as a space — `A+B` as `A B`.
 *
 * Neither is an absent condition. The list renders, scoped by
 * `account_name = 'Smith '`, and nothing anywhere says the value was cut.
 *
 * ## SUITE DIRECTION — stated before running
 *
 *   RED on the unmodified base tree: the `Smith & Sons` and `A+B` rows of the
 *   card's table (all three assertions each), plus both named-defect tests. The
 *   base tree has no `selectFilterParams` to import at all, so on the literal
 *   base bytes the red arrives as a resolution failure; the behavioural
 *   before/after over the live construction is in the PR body, and the ablation
 *   that reds this file against the repaired tree restores the hand-join INSIDE
 *   `selectFilterParams` rather than copying it here.
 *
 *   GREEN on both sides, by design: the LIT CONTROL (`Acme`) and the other five
 *   clean rows of the card's table. They are recorded because they are the
 *   evidence that ordinary values were not broken while the two failing ones
 *   were repaired — not because they pin this change.
 *
 * ## Every control here can fire
 *
 * - The LIT CONTROL is `Acme`: it reads identically on both sides of the
 *   mangling, so neither the two failures nor the six clean rows are unmeasured
 *   cells. It fires if this repair over-reaches — a key that double-encoded, or
 *   one that stopped reading plain values, breaks it while leaving the two
 *   defect rows green.
 * - `a b` and `100%` are in the table for the same reason: a repair that
 *   percent-encoded the ALREADY-decoded value twice reads `a%20b` back, and a
 *   repair that encoded the key string as a whole reads `100%` back as a broken
 *   escape. Both are green here and must stay green.
 * - The memo-identity block carries a non-vacuity control: a key that collapsed
 *   to a constant would satisfy "unchanged by an unrelated `uf_*` write" while
 *   asserting nothing, so a DIFFERENT filter value must produce a different key
 *   in the same run.
 *
 * ⛔ This file does not touch objectui#9196's plain-equality control — that pin
 * lives in `ObjectView.urlFilterSuffix-9196.test.ts` and is what proves the
 * equality arm did not move. `Acme` here is this card's own lit control.
 */

import { describe, it, expect } from 'vitest';
import { selectFilterParams } from './ObjectView';
import { parseUrlEqualityFilterTriples, serializeDrillFilterParams } from './drillUrlFilters';

/** The card's own example: a related-list "View All" scoped by a parent name. */
const FIELD = 'account_name';

/**
 * One trip down the real chain, from the URL a browser carries to the value the
 * reader receives.
 *
 * The URL is built by `serializeDrillFilterParams` — this family's declared
 * encoder, and the same `URLSearchParams` + `toString()` shape the two live
 * producers of this route use (`NavigationRenderer`'s `filters` links and
 * `RelatedList`'s parent scope). An unrelated `uf_*` param rides along in every
 * case, because absorbing those is the only reason the memo key exists.
 */
function tripFor(value: string) {
  const emitted = serializeDrillFilterParams({ [FIELD]: value }).toString();
  // What react-router parses out of `?...` and hands the view.
  const searchParams = new URLSearchParams(`${emitted}&uf_status=open`);
  const filterParams = selectFilterParams(searchParams);
  const key = filterParams.toString();
  return {
    key,
    entries: Array.from(filterParams.entries()),
    /** What the component reads: the params object, directly. */
    read: parseUrlEqualityFilterTriples(filterParams),
    /** The same params re-derived from the memo key — the round trip. */
    reread: parseUrlEqualityFilterTriples(new URLSearchParams(key)),
  };
}

/**
 * The card's table, verbatim. `discriminating` marks the rows measured RED
 * before this repair; the rest were clean on both sides and are carried so the
 * failures are not a two-cell reading.
 */
const ROWS: Array<{ value: string; discriminating: boolean }> = [
  { value: 'Acme', discriminating: false }, // LIT CONTROL
  { value: 'Smith & Sons', discriminating: true },
  { value: 'A+B', discriminating: true },
  { value: 'a=b', discriminating: false },
  { value: '100%', discriminating: false },
  { value: 'a b', discriminating: false },
  { value: 'Ünïcøde', discriminating: false },
  { value: 'a#b', discriminating: false },
];

describe("objectui#9287 — the card's table: the value in the URL is the value the reader receives", () => {
  it.each(ROWS)('$value (discriminating: $discriminating)', ({ value }) => {
    const { read, reread, entries } = tripFor(value);
    // What the component does: read the params object directly.
    expect(read).toEqual([[FIELD, '=', value]]);
    // And the memo key is a faithful identity for exactly those params.
    expect(reread).toEqual([[FIELD, '=', value]]);
    // One condition in, one param out — no stray empty-valued leftover.
    expect(entries).toEqual([[`filter[${FIELD}]`, value]]);
  });
});

describe('objectui#9287 — the two failures, named', () => {
  it('an ampersand does not truncate the value at its first occurrence', () => {
    const { read, entries } = tripFor('Smith & Sons');
    expect(read).toEqual([[FIELD, '=', 'Smith & Sons']]);
    // The base tree emitted `Smith ` AND a second, empty-valued param (` Sons`),
    // so the truncation is stated both ways: the value that arrives, and the
    // debris the split left behind.
    expect(read).not.toContainEqual([FIELD, '=', 'Smith ']);
    expect(entries).toHaveLength(1);
  });

  it('a plus stays a plus instead of arriving as a space', () => {
    const { read } = tripFor('A+B');
    expect(read).toEqual([[FIELD, '=', 'A+B']]);
    expect(read).not.toContainEqual([FIELD, '=', 'A B']);
  });

  it('LIT CONTROL — a plain value reads the same on both sides of the mangling', () => {
    // Green before this repair and green after. It is the evidence that the two
    // rows above are a repair and not a rewrite of what the reader receives.
    expect(tripFor('Acme').read).toEqual([[FIELD, '=', 'Acme']]);
  });
});

describe('objectui#9287 — the key still does the one job it exists for', () => {
  const keyFor = (search: string) => selectFilterParams(new URLSearchParams(search)).toString();

  it('an unrelated `uf_*` write does not change the key', () => {
    const a = keyFor('filter[stage]=won&uf_status=open');
    const b = keyFor('filter[stage]=won&uf_status=closed&uf_owner=me');
    expect(b).toBe(a);
  });

  it('non-vacuity control — a different filter value DOES change the key', () => {
    // Without this, a key that collapsed to a constant (or to '') would pass the
    // assertion above while identifying nothing.
    expect(keyFor('filter[stage]=lost&uf_status=open')).not.toBe(
      keyFor('filter[stage]=won&uf_status=open'),
    );
  });

  it('carries every `filter[...]` param and nothing else', () => {
    const params = selectFilterParams(
      new URLSearchParams('filter[stage]=won&uf_status=open&recordId=abc&filter[region]=emea'),
    );
    expect(Array.from(params.entries())).toEqual([
      ['filter[stage]', 'won'],
      ['filter[region]', 'emea'],
    ]);
  });
});
