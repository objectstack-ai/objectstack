// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  MAJOR_MINOR_PATCH_VERSION_PATTERN,
  SEMVER_SHAPED_VERSION_PATTERN,
  SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN,
} from './version-grammar';

/**
 * The accept-set pin for the three version grammars.
 *
 * Every carrier of "the version of a package or plugin" in this repo that
 * CONSTRAINS the string now references one of these three constants instead of
 * restating its regex (`PackageManifestSchema.version` constrains nothing — it
 * is a bare `z.string()` and references none of them), so this file is the ONE
 * place a verdict on a version string is pinned — move a
 * cell in the matrix below and you have moved a PUBLISHED accept set on every
 * carrier that references that constant, in one edit, visibly.
 *
 * ⛔ Do not "fix" a row to match an intuition about SemVer. Each row records
 * what these grammars accept TODAY, degenerate forms included; two of the three
 * are deliberately wider than SemVer 2.0.0 (#16365 froze the boot path's accept
 * set) and one is deliberately narrower. A row that surprises you is the
 * finding, not the bug.
 *
 * The carriers' own suites — `manifest.test.ts` and `plugin.test.ts` here, and
 * `plugin-loader.test.ts` in `@objectstack/core` — pin the same verdicts through
 * the schemas that reference these constants; this file pins the constants
 * themselves.
 *
 * ⚠️ `SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN` has NO carrier suite behind it:
 * there is no `../marketplace/package-version.test.ts` in this tree, so for that
 * one grammar this file is the only pin there is.
 */

/** One structural difference class per string — not an exhaustive accept set. */
const WITNESSES = [
  /* plain three-segment core                    */ '1.2.3',
  /* lowercase prerelease                        */ '2.0.0-beta.1',
  /* MIXED-CASE prerelease                       */ '1.0.0-Beta.1',
  /* build metadata                              */ '1.0.0+20230101',
  /* leading zero in the numeric core (SemVer §2)*/ '01.1.1',
  /* leading-zero prerelease ident (SemVer §9)   */ '1.0.0-0123',
  /* empty prerelease ident (SemVer §9)          */ '1.0.0-alpha..1',
  /* degenerate build metadata (SemVer §10)      */ '1.0.0+.',
  /* v-prefixed                                  */ 'v1.0.0',
  /* two segments                                */ '1.0',
  /* dist-tag, not a version                     */ 'latest',
  /* empty string                                */ '',
] as const;

type Witness = (typeof WITNESSES)[number];

/** `true` = the pattern accepts the string. Measured, then pinned. */
const MATRIX: Record<Witness, [g1: boolean, g2: boolean, g3: boolean]> = {
  '1.2.3': [true, true, true],
  '2.0.0-beta.1': [false, true, true],
  '1.0.0-Beta.1': [false, true, false],
  '1.0.0+20230101': [false, true, true],
  '01.1.1': [true, true, true],
  '1.0.0-0123': [false, true, true],
  '1.0.0-alpha..1': [false, true, true],
  '1.0.0+.': [false, true, true],
  'v1.0.0': [false, false, false],
  '1.0': [false, false, false],
  latest: [false, false, false],
  '': [false, false, false],
};

const PATTERNS = [
  ['MAJOR_MINOR_PATCH_VERSION_PATTERN', MAJOR_MINOR_PATCH_VERSION_PATTERN],
  ['SEMVER_SHAPED_VERSION_PATTERN', SEMVER_SHAPED_VERSION_PATTERN],
  ['SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN', SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN],
] as const;

describe('version grammars — accept-set pin', () => {
  it('covers every witness in the matrix, and only those', () => {
    // Guards the pin against silently shrinking: a witness dropped from one
    // table and not the other fails here instead of going unmeasured.
    expect(Object.keys(MATRIX).sort()).toEqual([...WITNESSES].sort());
  });

  for (const [index, [name, pattern]] of PATTERNS.entries()) {
    describe(name, () => {
      for (const witness of WITNESSES) {
        const expected = MATRIX[witness][index]!;
        it(`${expected ? 'accepts' : 'refuses'} ${JSON.stringify(witness)}`, () => {
          expect(pattern.test(witness)).toBe(expected);
        });
      }
    });
  }

  it('pins each grammar by its source bytes', () => {
    // A rewritten-but-equivalent regex still moves the JSON Schema `pattern`
    // this spec publishes, so the bytes are part of the contract, not just the
    // verdicts above.
    expect(MAJOR_MINOR_PATCH_VERSION_PATTERN.source).toBe('^\\d+\\.\\d+\\.\\d+$');
    expect(SEMVER_SHAPED_VERSION_PATTERN.source).toBe(
      '^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.-]+)?(\\+[a-zA-Z0-9.-]+)?$',
    );
    expect(SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN.source).toBe(
      '^\\d+\\.\\d+\\.\\d+(-[a-z0-9.-]+)?(\\+[a-z0-9.-]+)?$',
    );
  });

  it('carries no stateful flag, so the shared objects are safe to reuse', () => {
    // `g`/`y` make `.test()` advance `lastIndex`, which would make a shared
    // pattern answer differently on the second call at a different carrier.
    for (const [name, pattern] of PATTERNS) {
      expect(`${name}:${pattern.flags}`).toBe(`${name}:`);
    }
  });

  it('orders the three by strict containment over the witnesses', () => {
    // major.minor.patch ⊂ lowercase-suffixed ⊂ either-case-suffixed. The
    // middle relation is what lets a published release row pass the boot path.
    for (const witness of WITNESSES) {
      const [g1, g2, g3] = MATRIX[witness];
      if (g1) expect(g3, `${witness}: G1 accepts, G3 must too`).toBe(true);
      if (g3) expect(g2, `${witness}: G3 accepts, G2 must too`).toBe(true);
    }
    // ...and the containments are STRICT: each step admits something new.
    expect([
      MAJOR_MINOR_PATCH_VERSION_PATTERN.test('2.0.0-beta.1'),
      SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN.test('2.0.0-beta.1'),
    ]).toEqual([false, true]);
    expect([
      SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN.test('1.0.0-Beta.1'),
      SEMVER_SHAPED_VERSION_PATTERN.test('1.0.0-Beta.1'),
    ]).toEqual([false, true]);
  });
});
