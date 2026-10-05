// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20143] `$like` / `$ilike`: `_` is ONE Unicode code point on the JS faces,
 * as it is on every SQLite face.
 *
 * `likePatternToRegexSource` translates `_` to `[\s\S]`, and every JS face used
 * to compile that source with no flags, so it read one UTF-16 code unit — half
 * of an emoji. Measured at base `e7f69dbb` over the rows below: `$like: '_'`
 * missed a stored `😀` that better-sqlite3, sql.js and `TursoDriver` (local,
 * and remote on a real libSQL engine) all matched through GLOB's `?`, and `__`
 * matched it where they did not. `likePatternToRegExp` now owns the compilation
 * with the `u` flag; `matchesLikePattern` evaluates it.
 *
 * Every expected row set below is the code-point answer the SQLite faces give
 * (their own suites pin the same cells). The family cells are the card's:
 * `_`, `__`, `a_b`, `a__b` over values outside the BMP, plus the `$ilike` twin.
 */

import { describe, it, expect } from 'vitest';
import { likePatternToRegExp, likePatternToRegexSource, matchesLikePattern } from './filter.zod';

/** U+1F600 and U+1D49C: each is one code point, and two UTF-16 code units. */
const GRIN = String.fromCodePoint(0x1f600);
const SCRIPT_A = String.fromCodePoint(0x1d49c);

/** label → stored value. */
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

/**
 * [op, pattern, the code-point rows, the UTF-16 rows the JS faces answered
 * before]. The fourth column is kept so each row shows what it moved.
 */
const FAMILY: ReadonlyArray<readonly ['$like' | '$ilike', string, readonly string[], readonly string[]]> = [
  ['$like', '_', ['grin', 'x'], ['x']],
  ['$like', '__', ['ab', 'grin_grin'], ['ab', 'grin']],
  ['$like', 'a_b', ['a_grin_b', 'axb'], ['axb']],
  ['$like', 'a__b', ['a_grin_grin_b', 'axyb'], ['a_grin_b', 'axyb']],
  ['$like', '___', ['a_grin_b', 'axb', 'upper_script_b'], ['axb']],
  ['$like', GRIN + '_', ['grin_grin'], []],
  ['$like', '_' + GRIN, ['grin_grin'], []],
  ['$ilike', '_', ['grin', 'x'], ['x']],
  ['$ilike', 'A_B', ['a_grin_b', 'axb', 'upper_script_b'], ['axb']],
  ['$ilike', 'A__B', ['a_grin_grin_b', 'axyb'], ['a_grin_b', 'axyb', 'upper_script_b']],
];

const answer = (match: (v: string) => boolean): string[] =>
  Object.entries(ROWS).filter(([, v]) => match(v)).map(([label]) => label).sort();

describe('matchesLikePattern — `_` is one code point', () => {
  for (const [op, pattern, codePoint] of FAMILY) {
    it(`${op} ${JSON.stringify(pattern)} answers the code-point rows`, () => {
      expect(answer((v) => matchesLikePattern(v, pattern, op === '$ilike'))).toEqual([...codePoint]);
    });
  }

  it('the UTF-16 reading is what a flagless compilation of the same source still answers (the control)', () => {
    // The source is unchanged; only the compilation moved. Compiling it the old
    // way must still give the old rows, or the table above proves nothing
    // about the flag.
    for (const [op, pattern, codePoint, utf16] of FAMILY) {
      const flagless = new RegExp(likePatternToRegexSource(pattern, op === '$ilike'));
      expect(answer((v) => flagless.test(v)), `${op} ${JSON.stringify(pattern)}`).toEqual([...utf16]);
      expect(utf16, `${op} ${JSON.stringify(pattern)} must be a cell that moved`).not.toEqual(codePoint);
    }
  });

  it('`%` never splits a code point: `%` + a lone low surrogate does not match an emoji', () => {
    const lowHalf = String.fromCharCode(GRIN.charCodeAt(1));
    expect(matchesLikePattern(GRIN, '%' + lowHalf)).toBe(false);
    expect(matchesLikePattern(GRIN, '%')).toBe(true);
    expect(matchesLikePattern('a' + GRIN, 'a%')).toBe(true);
  });

  it('an escaped character outside the BMP is one literal character', () => {
    expect(matchesLikePattern(GRIN, '\\' + GRIN)).toBe(true);
    expect(matchesLikePattern(GRIN + GRIN, '\\' + GRIN)).toBe(false);
    expect(matchesLikePattern(GRIN + GRIN, '\\' + GRIN + '_')).toBe(true);
    expect(likePatternToRegexSource('\\' + GRIN)).toBe(`^${GRIN}$`);
  });
});

describe('likePatternToRegExp — the one compilation', () => {
  it('carries the `u` flag and nothing else (no `i`: the $ilike fold is in the source)', () => {
    expect(likePatternToRegExp('a_b').flags).toBe('u');
    expect(likePatternToRegExp('a_b', true).flags).toBe('u');
    expect(likePatternToRegExp('a_b').source).toBe(likePatternToRegexSource('a_b'));
    expect(likePatternToRegExp('A_b', true).source).toBe(likePatternToRegexSource('A_b', true));
  });

  it('`_` is `[\\s\\S]` — never `.` — so it matches a newline under `u` as before', () => {
    expect(likePatternToRegexSource('_')).toBe('^[\\s\\S]$');
    expect(likePatternToRegexSource('%')).toBe('^[\\s\\S]*$');
    expect(likePatternToRegExp('a_b').test('a\nb')).toBe(true);
    expect(likePatternToRegExp('a%b').test('a\n\nb')).toBe(true);
  });

  it('throws on a dangling escape, like the source translation (the backstop behind hasDanglingLikeEscape)', () => {
    expect(() => likePatternToRegExp('abc\\')).toThrow(/ends with a lone unpaired backslash/);
    expect(() => likePatternToRegExp('abc\\')).toThrow('write "\\\\\\\\" to match a literal backslash');
  });
});

describe('every ASCII punctuation character is `u`-legal, bare and escaped', () => {
  /** Printable ASCII that is neither a letter nor a digit, space included: 33 characters. */
  const PUNCTUATION = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i))
    .filter((c) => !/[A-Za-z0-9]/.test(c));
  /** The identity escapes the `u` flag accepts: the regex syntax characters and `/`. */
  const U_IDENTITY_ESCAPES = new Set('^$\\.*+?()[]{}|/');
  /** The pattern language's own three: wildcards and the escape. */
  const LIKE_SPECIAL = new Set(['%', '_', '\\']);

  it('covers all 33 (the premise)', () => {
    expect(PUNCTUATION).toHaveLength(33);
  });

  it('the `u` flag really does reject an identity escape outside that set (the control)', () => {
    // Without this, a green below could mean the engine never enforced it.
    expect(() => new RegExp('\\-', 'u')).toThrow(SyntaxError);
    expect(() => new RegExp('\\-')).not.toThrow();
    expect(() => new RegExp('\\:', 'u')).toThrow(SyntaxError);
  });

  it('the translation escapes EXACTLY the `u`-legal set, and leaves every other mark bare', () => {
    const escaped = PUNCTUATION.filter((c) => !LIKE_SPECIAL.has(c))
      .filter((c) => likePatternToRegexSource(c) !== `^${c}$`);
    for (const c of escaped) expect(likePatternToRegexSource(c), c).toBe(`^\\${c}$`);
    expect(new Set(escaped)).toEqual(new Set([...U_IDENTITY_ESCAPES].filter((c) => c !== '\\')));
  });

  for (const foldAscii of [false, true]) {
    it(`bare: each compiles under \`u\` and matches only itself (foldAscii=${foldAscii})`, () => {
      for (const c of PUNCTUATION.filter((ch) => !LIKE_SPECIAL.has(ch))) {
        const re = likePatternToRegExp(c, foldAscii);
        expect(re.test(c), JSON.stringify(c)).toBe(true);
        expect(re.test('x'), JSON.stringify(c)).toBe(false);
        expect(re.test(c + c), JSON.stringify(c)).toBe(false);
      }
    });

    it(`escaped: each of the 33 compiles under \`u\` and matches only itself (foldAscii=${foldAscii})`, () => {
      for (const c of PUNCTUATION) {
        const pattern = '\\' + c;
        const re = likePatternToRegExp(pattern, foldAscii);
        expect(re.test(c), JSON.stringify(pattern)).toBe(true);
        expect(re.test('x'), JSON.stringify(pattern)).toBe(false);
        expect(re.test(c + c), JSON.stringify(pattern)).toBe(false);
        const source = likePatternToRegexSource(pattern, foldAscii);
        for (const [, e] of source.replace(/\[\\s\\S\]/g, '').matchAll(/\\(.)/gsu)) {
          expect(U_IDENTITY_ESCAPES.has(e), `${JSON.stringify(pattern)} emitted \\${e}`).toBe(true);
        }
      }
    });
  }
});
