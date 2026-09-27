// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20143] `matchesFilterCondition` — `$like` / `$ilike` `_` is ONE Unicode
 * code point, the answer every SQLite face gives.
 *
 * This face evaluates the spec's `matchesLikePattern`, which compiled
 * `likePatternToRegexSource` with no flags until #20143, so `_` read one UTF-16
 * code unit: measured at base `e7f69dbb`, `$like: '_'` missed a stored `😀`
 * that better-sqlite3, sql.js and `TursoDriver` (local, and remote on a real
 * libSQL engine) all returned. It now answers their rows.
 *
 * No CEL rule here needs the UTF-16 reading: nothing in this package lowers
 * CEL to `$like`, and CEL's own `size()` already counts code points
 * (`size('😀')` is 1, pinned below), so the old `$like` answer disagreed with
 * this package's own string length.
 */

import { describe, it, expect } from 'vitest';
import { matchesFilterCondition } from './matches-filter.js';
import { celEngine } from './cel-engine.js';

const GRIN = String.fromCodePoint(0x1f600);
const SCRIPT_A = String.fromCodePoint(0x1d49c);

const ROWS: Readonly<Record<string, string>> = {
  x: 'x',
  grin: GRIN,
  grin_grin: GRIN + GRIN,
  a_grin_b: 'a' + GRIN + 'b',
  a_grin_grin_b: 'a' + GRIN + GRIN + 'b',
  upper_script_b: 'A' + SCRIPT_A + 'B',
  ab: 'ab',
  axb: 'axb',
  axyb: 'axyb',
};

/** [op, pattern, the code-point rows — the SQLite faces' answer]. */
const FAMILY: ReadonlyArray<readonly ['$like' | '$ilike', string, readonly string[]]> = [
  ['$like', '_', ['grin', 'x']],
  ['$like', '__', ['ab', 'grin_grin']],
  ['$like', 'a_b', ['a_grin_b', 'axb']],
  ['$like', 'a__b', ['a_grin_grin_b', 'axyb']],
  ['$like', '___', ['a_grin_b', 'axb', 'upper_script_b']],
  ['$like', GRIN + '_', ['grin_grin']],
  ['$like', '_' + GRIN, ['grin_grin']],
  ['$ilike', '_', ['grin', 'x']],
  ['$ilike', 'A_B', ['a_grin_b', 'axb', 'upper_script_b']],
  ['$ilike', 'A__B', ['a_grin_grin_b', 'axyb']],
];

const answer = (where: Record<string, unknown>): string[] =>
  Object.entries(ROWS)
    .filter(([, v]) => matchesFilterCondition({ v }, where as never))
    .map(([label]) => label)
    .sort();

describe('[#20143] matchesFilterCondition — `_` is one code point', () => {
  for (const [op, pattern, expected] of FAMILY) {
    it(`${op} ${JSON.stringify(pattern)} answers the code-point rows`, () => {
      expect(answer({ v: { [op]: pattern } })).toEqual([...expected]);
    });
  }

  it('$not $like "_" is the complement, not a second reading', () => {
    expect(answer({ $not: { v: { $like: '_' } } })).toEqual(
      Object.keys(ROWS).filter((l) => l !== 'grin' && l !== 'x').sort(),
    );
  });

  it("CEL's own size() already counts code points (why no CEL rule needs the UTF-16 reading)", () => {
    const size = (s: string) => celEngine.evaluate({ dialect: 'cel', source: 'size(record.s)' }, { record: { s } });
    expect(size(GRIN)).toEqual({ ok: true, value: 1 });
    expect(size('a' + GRIN + 'b')).toEqual({ ok: true, value: 3 });
  });
});
