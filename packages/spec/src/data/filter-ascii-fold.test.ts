// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6520] The ASCII fold every JS `$icontains` face shares.
 *
 * These three functions are the reason #6520 could give six evaluation faces one
 * answer instead of six near-copies, so they are pinned HERE rather than once
 * per consumer: a fold that drifts in one package is the #3948 shape reached
 * through the comparison instead of the vocabulary, and the per-face suites
 * would each go red on their own schedule.
 *
 * The rows deliberately reuse `FILTER_TEXT_ROWS`' pairs (`ACME Corp`/`acme
 * corp`, `CAFÉ`/`café`) — the conformance standard's own fixture — so a change
 * that satisfies this file and fails the standard cannot happen quietly. Note
 * this file must NOT import `FILTER_TEXT_CASES`: that marker is what
 * `check-driver-conformance.mjs` counts as coverage, and spec is not a driver.
 */

import { describe, it, expect } from 'vitest';
import {
  foldAsciiCase,
  asciiCaseInsensitiveContains,
  asciiCaseInsensitiveRegexSource,
} from './filter.zod';

describe('foldAsciiCase', () => {
  it('folds A-Z and nothing else', () => {
    expect(foldAsciiCase('ACME Corp')).toBe('acme corp');
    expect(foldAsciiCase('acme corp')).toBe('acme corp');
  });

  it('leaves non-ASCII letters ALONE — the #4706 Q1 boundary', () => {
    // The whole contract in one line: `toLowerCase()` answers 'café' here, and
    // that is the answer three of the five backends cannot deliver.
    expect(foldAsciiCase('CAFÉ')).toBe('cafÉ');
    expect(foldAsciiCase('МОСКВА')).toBe('МОСКВА');
    expect('CAFÉ'.toLowerCase()).toBe('café'); // the trap, pinned as a contrast
  });

  it('is idempotent and leaves digits, punctuation and spaces untouched', () => {
    expect(foldAsciiCase(foldAsciiCase('A1_b%.'))).toBe('a1_b%.');
    expect(foldAsciiCase('')).toBe('');
  });
});

describe('asciiCaseInsensitiveContains', () => {
  it('folds BOTH sides — an upper-case row from a lower-case comparand', () => {
    // Folding only the comparand matches just the already-lower-case row, which
    // is the mistake FILTER_TEXT_CASES' first row exists to catch.
    expect(asciiCaseInsensitiveContains('ACME Corp', 'acme')).toBe(true);
    expect(asciiCaseInsensitiveContains('acme corp', 'ACME')).toBe(true);
  });

  it('does NOT fold non-ASCII case', () => {
    expect(asciiCaseInsensitiveContains('CAFÉ', 'café')).toBe(false);
    expect(asciiCaseInsensitiveContains('café', 'CAFÉ')).toBe(false);
    // ASCII letters in the same string still fold — the fold is per character.
    expect(asciiCaseInsensitiveContains('CAFÉ', 'CAFÉ')).toBe(true);
  });

  it('compares the comparand LITERALLY', () => {
    expect(asciiCaseInsensitiveContains('a.b', 'a.b')).toBe(true);
    expect(asciiCaseInsensitiveContains('axb', 'a.b')).toBe(false);
    expect(asciiCaseInsensitiveContains('a_b', 'a_b')).toBe(true);
    expect(asciiCaseInsensitiveContains('axb', 'a_b')).toBe(false);
  });
});

describe('asciiCaseInsensitiveRegexSource', () => {
  /** How every pattern face uses it: NO flags — the source carries the fold. */
  const matches = (haystack: string, comparand: string): boolean =>
    new RegExp(asciiCaseInsensitiveRegexSource(comparand)).test(haystack);

  it('folds ASCII case in both directions without an `i` flag', () => {
    expect(matches('ACME Corp', 'acme')).toBe(true);
    expect(matches('acme corp', 'ACME')).toBe(true);
    expect(asciiCaseInsensitiveRegexSource('aZ')).toBe('[Aa][Zz]');
  });

  it('does NOT fold non-ASCII — the `i` flag would, which is why there is none', () => {
    expect(matches('CAFÉ', 'café')).toBe(false);
    expect(matches('café', 'CAFÉ')).toBe(false);
    // The trap, pinned: the same comparand WITH the flag folds É and is wrong.
    expect(new RegExp(asciiCaseInsensitiveRegexSource('café'), 'i').test('CAFÉ')).toBe(true);
  });

  it('escapes every regex metacharacter — the comparand is text, not a pattern', () => {
    expect(matches('a.b', 'a.b')).toBe(true);
    expect(matches('axb', 'a.b')).toBe(false);
    expect(matches('100% match', '100%')).toBe(true);
    expect(matches('a+b', 'a+b')).toBe(true);
    expect(matches('a(b)c', 'a(b)c')).toBe(true);
    expect(matches('a[b]c', 'a[b]c')).toBe(true);
    expect(matches('a\\b', 'a\\b')).toBe(true);
    expect(matches('a$b^c', 'a$b^c')).toBe(true);
    expect(matches('a|b', 'a|b')).toBe(true);
    expect(matches('a{2}b', 'a{2}b')).toBe(true);
    expect(matches('a?b', 'a?b')).toBe(true);
    expect(matches('a*b', 'a*b')).toBe(true);
  });

  it('produces a source that is a VALID regex for every ASCII byte', () => {
    // A metacharacter this function forgot to escape shows up as a thrown
    // SyntaxError rather than as a subtly wrong row set, so the sweep is worth
    // more than a hand-listed table.
    for (let code = 0x20; code < 0x7f; code++) {
      const ch = String.fromCharCode(code);
      expect(() => new RegExp(asciiCaseInsensitiveRegexSource(ch)), `char ${code}`).not.toThrow();
      expect(new RegExp(asciiCaseInsensitiveRegexSource(ch)).test(ch), `char ${code}`).toBe(true);
    }
  });
});
