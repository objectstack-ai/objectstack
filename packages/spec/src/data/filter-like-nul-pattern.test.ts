// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20041] `hasNulInLikePattern` — the shared test every `$like` / `$ilike`
 * refusal door asks, beside `hasDanglingLikeEscape`.
 *
 * The SQLite faces compile a pattern to `GLOB`, and SQLite reads a pattern only
 * up to its first U+0000, so a pattern holding one was cut there and answered a
 * different question than the JS translation. Every face that refuses a
 * dangling escape now refuses such a pattern too; the driver suites pin each
 * door's envelope. This file pins the predicate itself, and the two things it
 * deliberately does NOT change.
 */

import { describe, it, expect } from 'vitest';
import {
  hasNulInLikePattern,
  hasDanglingLikeEscape,
  likePatternToRegexSource,
  matchesLikePattern,
} from './filter.zod';

const NUL = String.fromCharCode(0x00);

describe('[#20041] hasNulInLikePattern', () => {
  it('finds U+0000 at the start, in the middle, at the end, and alone', () => {
    expect(hasNulInLikePattern(NUL + '%')).toBe(true);
    expect(hasNulInLikePattern('a' + NUL + 'b')).toBe(true);
    expect(hasNulInLikePattern('%' + NUL)).toBe(true);
    expect(hasNulInLikePattern(NUL)).toBe(true);
  });

  it('finds an ESCAPED U+0000 too: a backslash makes it literal, not absent', () => {
    expect(hasNulInLikePattern('\\' + NUL)).toBe(true);
    // ...and that pattern has no dangling escape, so only this predicate refuses it.
    expect(hasDanglingLikeEscape('\\' + NUL)).toBe(false);
  });

  it('answers false for every pattern without U+0000, wildcards and escapes included', () => {
    for (const pattern of ['', '%', '_', 'a%b', '100\\% match', 'a\\\\b', 'U+0000', '\\0', '%00%']) {
      expect(hasNulInLikePattern(pattern), JSON.stringify(pattern)).toBe(false);
    }
  });

  it('is a different test from the dangling escape: neither implies the other', () => {
    expect(hasNulInLikePattern('abc\\')).toBe(false);
    expect(hasDanglingLikeEscape('abc\\')).toBe(true);
    expect(hasNulInLikePattern('a' + NUL + '\\')).toBe(true);
    expect(hasDanglingLikeEscape('a' + NUL + '\\')).toBe(true);
  });

  it('does not change the JS translation: the refusal lives at the doors, not in the converters', () => {
    // `@objectstack/formula` evaluates through `matchesLikePattern` and is total
    // by contract, so folding the refusal into the converters would have turned
    // its answer into a caught throw, i.e. `false`. The doors refuse instead.
    expect(() => likePatternToRegexSource('%' + NUL)).not.toThrow();
    expect(matchesLikePattern('ab' + NUL, '%' + NUL)).toBe(true);
    expect(matchesLikePattern('ab', '%' + NUL)).toBe(false);
  });
});
