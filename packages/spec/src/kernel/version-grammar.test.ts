// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { SEMVER_2_0_0_VERSION_PATTERN } from './version-grammar';

/**
 * The accept-set pin for the ONE version grammar.
 *
 * Every carrier of "the version of a package or plugin" in this repo references
 * `SEMVER_2_0_0_VERSION_PATTERN`, so this file is the one place a verdict on a
 * version string is pinned — move a cell in the matrix below and you have moved
 * a PUBLISHED accept set on nine carriers at once, in one edit, visibly.
 *
 * ⛔ Do not "fix" a row to match an intuition. Each row records what the canon
 * accepts, and the canon is SemVer 2.0.0 exactly — neither the wider grammar the
 * boot path once ran nor the three-segment core the manifest key once demanded.
 * A row that surprises you is the finding, not the bug.
 *
 * The carriers' own suites — `manifest.test.ts` and `plugin.test.ts` here, and
 * `plugin-loader.test.ts` in `@objectstack/core` — pin the same verdicts through
 * the schemas that reference this constant; this file pins the constant itself.
 *
 * ⚠️ `PackageVersionSchema.version` and `PackageManifestSchema.version`
 * (`../marketplace/package-version.zod.ts`) have NO carrier suite behind them —
 * there is no `../marketplace/package-version.test.ts` in this tree — so for
 * those two this file is the only pin there is.
 */

/** One structural difference class per string — not an exhaustive accept set. */
const WITNESSES = [
  /* plain three-segment core                    */ '1.2.3',
  /* lowercase prerelease                        */ '2.0.0-beta.1',
  /* MIXED-CASE prerelease (SemVer preserves case) */ '1.0.0-Beta.1',
  /* build metadata                              */ '1.0.0+20230101',
  /* prerelease AND build together               */ '1.0.0-rc.1+exp.sha.5114f85',
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

/** `true` = the canon accepts the string. Measured, then pinned. */
const MATRIX: Record<Witness, boolean> = {
  '1.2.3': true,
  '2.0.0-beta.1': true,
  '1.0.0-Beta.1': true,
  '1.0.0+20230101': true,
  '1.0.0-rc.1+exp.sha.5114f85': true,
  '01.1.1': false,
  '1.0.0-0123': false,
  '1.0.0-alpha..1': false,
  '1.0.0+.': false,
  'v1.0.0': false,
  '1.0': false,
  latest: false,
  '': false,
};

/**
 * The eight strings SemVer 2.0.0 forbids that the boot path used to LOAD, named
 * in full rather than sampled.
 *
 * ⭐ This block is the bound on the narrowing, asserted rather than narrated.
 * The canon ruling narrows the boot path on exactly these and on nothing else,
 * which is what honours the earlier widen-never-narrow ruling: none of them is a
 * valid prerelease, and no precedence order exists for any of them, so a plugin
 * versioned this way could load and never be compared against its successor.
 */
const SEMVER_FORBIDDEN = [
  // §2 — numeric identifiers MUST NOT include leading zeroes.
  '01.1.1', '1.01.1', '1.1.01',
  // §9 — prerelease identifiers MUST NOT be empty or carry leading zeroes.
  '1.0.0-0123', '1.0.0-alpha..1', '1.0.0-alpha..', '1.0.0-.',
  // §10 — build-metadata identifiers MUST NOT be empty.
  '1.0.0+.',
] as const;

/**
 * Every prerelease and build form the boot path accepted under the wider
 * grammar that IS valid SemVer — the other half of the bound.
 *
 * ⛔ A failure here is not a pin to update: it means the narrowing overran its
 * mandate and refused something that loads today.
 */
const STILL_ACCEPTED_BY_THE_BOOT_PATH = [
  '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-0A.is.legal',
  '1.0.0-alpha0.valid', '1.0.0-alpha.0valid', '1.2.3-beta',
  '1.0.0+20230101', '1.1.2+meta', '1.0.0+0.build.1-rc.10000aaa-kk-0.1',
  '1.1.2-prerelease+meta', '1.0.0-rc.1+build.1', '2.0.0-rc.1+build.123',
  '0.0.0-fixture', '1.0.0-Beta.1', '1.0.0+Build.5', '17.0.0-rc.5',
] as const;

describe('SEMVER_2_0_0_VERSION_PATTERN — accept-set pin', () => {
  it('covers every witness in the matrix, and only those', () => {
    // Guards the pin against silently shrinking: a witness dropped from one
    // table and not the other fails here instead of going unmeasured.
    expect(Object.keys(MATRIX).sort()).toEqual([...WITNESSES].sort());
  });

  for (const witness of WITNESSES) {
    const expected = MATRIX[witness];
    it(`${expected ? 'accepts' : 'refuses'} ${JSON.stringify(witness)}`, () => {
      expect(SEMVER_2_0_0_VERSION_PATTERN.test(witness)).toBe(expected);
    });
  }

  it.each(SEMVER_FORBIDDEN)('refuses %s, which SemVer 2.0.0 forbids', (version) => {
    expect(SEMVER_2_0_0_VERSION_PATTERN.test(version)).toBe(false);
  });

  it.each(STILL_ACCEPTED_BY_THE_BOOT_PATH)(
    'still accepts %s — the narrowing refuses no valid prerelease or build form',
    (version) => {
      expect(SEMVER_2_0_0_VERSION_PATTERN.test(version)).toBe(true);
    },
  );

  it('pins the grammar by its source bytes', () => {
    // A rewritten-but-equivalent regex still moves the JSON Schema `pattern`
    // this spec publishes, so the bytes are part of the contract, not just the
    // verdicts above. This is semver.org's own published expression in its form
    // without named capture groups; ⛔ do not "tidy" it.
    expect(SEMVER_2_0_0_VERSION_PATTERN.source).toBe(
      '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)'
      + '(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)'
      + '(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?'
      + '(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$',
    );
  });

  it('carries no stateful flag, so the shared object is safe to reuse', () => {
    // `g`/`y` make `.test()` advance `lastIndex`, which would make a shared
    // pattern answer differently on the second call at a different carrier.
    expect(SEMVER_2_0_0_VERSION_PATTERN.flags).toBe('');
  });

  it('answers ONE way on the string this card was filed over', () => {
    // `2.0.0-beta.1` is the string `PackageVersionSchema.version`'s docstring
    // advertised while `ManifestSchema.version` refused it. Four accept sets
    // over ten carriers gave it two answers; there is one carrier grammar now,
    // so there is one answer.
    expect(SEMVER_2_0_0_VERSION_PATTERN.test('2.0.0-beta.1')).toBe(true);
  });
});
