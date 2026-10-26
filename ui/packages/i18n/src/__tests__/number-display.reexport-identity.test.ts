/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4576 — the down-move's safety net.
 *
 * `formatDisplayNumber`, `shouldGroupDisplayNumber` and
 * `DisplayNumberFormatOptions` moved from this package into `@object-ui/core`,
 * and this package re-exports them so no consumer's import path changes.
 * A re-export is only worth anything if it names the SAME thing, so this file
 * pins identity rather than behaviour: same function object, same type, from
 * all three paths a consumer can reach them by.
 *
 * ── PREDICTIONS, written before the run ──
 * RED before the fix, at MODULE LOAD: `@object-ui/core` exports no
 * `formatDisplayNumber`, so the import fails outright — not an assertion
 * failure but a resolution one. The behavioural cases below would pass on both
 * sides (the implementation is byte-identical; that is the point of a move),
 * which is exactly why identity, not behaviour, is what this file asserts.
 *
 * The three paths, and who uses each one:
 *   - `@object-ui/core`             — the new home; `dataset-format.ts` reads it
 *   - `../utils/number-display`     — the relative path THIS package's own
 *                                     `number-display.test.ts` has always used
 *   - `../index` (`@object-ui/i18n`) — the published entry `fields`,
 *                                     `components` and `plugin-dashboard` import
 */

import { describe, it, expect } from 'vitest';

import {
  formatDisplayNumber as fromCore,
  shouldGroupDisplayNumber as groupFromCore,
  type DisplayNumberFormatOptions as OptionsFromCore,
} from '@object-ui/core';
import {
  formatDisplayNumber as fromModule,
  shouldGroupDisplayNumber as groupFromModule,
  type DisplayNumberFormatOptions as OptionsFromModule,
} from '../utils/number-display';
import {
  formatDisplayNumber as fromEntry,
  shouldGroupDisplayNumber as groupFromEntry,
  type DisplayNumberFormatOptions as OptionsFromEntry,
} from '../index';

describe('the moved number-display symbols are re-exported, not re-implemented (#4576)', () => {
  it('all three import paths resolve to the SAME function object', () => {
    // Reference equality, not deep equality: a second copy of the
    // implementation would pass every behavioural assertion in the repo and
    // fail only here. That is the drift this card removed.
    expect(fromModule).toBe(fromCore);
    expect(fromEntry).toBe(fromCore);
    expect(groupFromModule).toBe(groupFromCore);
    expect(groupFromEntry).toBe(groupFromCore);
  });

  it('the option type is the same type, not a structural twin', () => {
    // Compile-time pin, erased at runtime — `tsc -p tsconfig.test.json` is the
    // only thing that checks it, which is why this package's `type-check`
    // chains that project. Assignability in BOTH directions is what makes it an
    // identity check: two independently declared but structurally identical
    // interfaces would also pass a one-way assignment.
    const viaCore: OptionsFromCore = { locale: 'de-DE', style: 'percentPoints', scale: 0 };
    const viaModule: OptionsFromModule = viaCore;
    const viaEntry: OptionsFromEntry = viaModule;
    const backToCore: OptionsFromCore = viaEntry;
    expect(backToCore.locale).toBe('de-DE');
    expect(backToCore.style).toBe('percentPoints');
  });

  it('and the re-exported function still behaves — the entry path formats identically', () => {
    // Not a defect pin (green on both sides once the import resolves); it is
    // here so a reader can see the re-export is wired to a working function and
    // not merely to a name.
    const options: OptionsFromEntry = {
      locale: 'de-DE',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    };
    expect(fromEntry(1234.5, options)).toBe(fromCore(1234.5, options));
    expect(fromEntry(1234.5, options)).toBe('1.234,5');
    expect(groupFromEntry(0, undefined)).toBe(false);
    expect(groupFromEntry(0, 'USD')).toBe(true);
  });
});
