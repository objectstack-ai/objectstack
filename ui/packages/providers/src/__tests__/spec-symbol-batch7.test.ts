/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ThemePreference` derivation pin
 * (objectui#3161, objectstack#4115 ledger batch 7; re-homed by objectui#5716).
 *
 * `Theme` → `ThemePreference`, derived from the theme MODE vocabulary plus the
 * one legacy spelling this provider still honours. The batch-7 naming
 * judgement is recorded at the declaration in `../types.ts`.
 *
 * This file used to read the vocabulary from the spec's `ThemeModeSchema` and
 * carried a designed tripwire: "if the spec retires `Theme`, this stops
 * compiling and the rename is up for re-triage". The spec DID retire its
 * theme module (objectstack#10485), the re-triage happened, and the
 * objectui#5716 ruling made `@object-ui/types` the vocabulary's owner
 * (`ThemeMode`, with the `THEME_MODES` runtime witness). So the pins below
 * read the new owner — the tripwire fired, was triaged, and is retired.
 */

import { describe, it, expect } from 'vitest';
import { THEME_MODES } from '@object-ui/types';
import type { ThemeMode } from '@object-ui/types';

import type { ThemePreference } from '../types';

describe("'system' is this package's own legacy spelling, not the vocabulary's", () => {
  it('reads a non-empty mode tuple from the owner (the probe is not vacuous)', () => {
    expect(Array.isArray(THEME_MODES) && THEME_MODES.length > 0).toBe(true);
  });

  it('the vocabulary never declares `system` — the OS-following mode is spelled `auto`', () => {
    expect(THEME_MODES).toContain('auto');
    expect(
      (THEME_MODES as readonly string[]).includes('system'),
      'the mode vocabulary now declares `system` too — drop the extra union member in types.ts, it is no longer a local alias',
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off type-check. */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

describe('ThemePreference is the mode vocabulary plus one legacy member', () => {
  it('is pinned at compile time', () => {
    // The owner's type is real (not `any`), and the runtime witness and the
    // type are the same vocabulary — the pair cannot drift apart.
    type _OwnerIsReal = Assert<Equal<IsAny<ThemeMode>, false>>;
    type _WitnessCarriesTheType = Assert<Equal<(typeof THEME_MODES)[number], ThemeMode>>;

    // …and this is exactly that vocabulary, plus `system`. Derived, so a mode
    // the owner adds appears here (and `ThemeProvider`'s branch must handle it
    // — `theme-mode-spec-parity.test.tsx` fails at runtime if it does not).
    type _IsTheModeVocabularyPlusLegacy = Assert<Equal<ThemePreference, ThemeMode | 'system'>>;
    type _NothingElseIsLocal = Assert<Equal<Exclude<ThemePreference, ThemeMode>, 'system'>>;

    expect(true).toBe(true);
  });
});
