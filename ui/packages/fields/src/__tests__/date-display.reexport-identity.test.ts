/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7178 — the down-move's safety net, and the pin that makes the
 * ruling's "no second date formatter" mechanical instead of aspirational.
 *
 * `formatDate`, `formatDateTime`, `formatRelativeDate` and `DateDisplayOptions`
 * moved from this package's barrel into `@object-ui/core`'s
 * `utils/date-display.ts`, because `core`'s `formatMeasure` needed exactly this
 * path and, as the React-free engine, could not import from a React package.
 * This barrel re-exports them, so no consumer's import path changes.
 *
 * A re-export is only worth anything if it names the SAME thing, so this file
 * pins IDENTITY rather than behaviour — the same shape as
 * `@object-ui/i18n`'s `number-display.reexport-identity.test.ts`, written for
 * the same move one type over (objectui#4576). A second copy of the date
 * convention would pass every behavioural assertion in the repo and fail only
 * here, and that copy is precisely what #4576 already cost the repo once, in
 * percent.
 *
 * ── PREDICTIONS, written before the run ──
 * RED before the fix, at MODULE LOAD: `@object-ui/core` exported no
 * `formatDate`, so the import fails outright — a resolution failure, not an
 * assertion one. The behavioural case below passes on both sides (the
 * implementation is byte-identical; that is what a move means), which is
 * exactly why identity is what this file asserts.
 */

import { describe, it, expect } from 'vitest';

import {
  formatDate as fromCore,
  formatDateTime as fromCoreDateTime,
  formatRelativeDate as fromCoreRelative,
} from '@object-ui/core';
import {
  formatDate as fromEntry,
  formatDateTime as fromEntryDateTime,
  formatRelativeDate as fromEntryRelative,
} from '../index';

describe('the moved date-display symbols are re-exported, not re-implemented (#7178)', () => {
  it('the cell renderer\'s date path and `@object-ui/core`\'s are the SAME function object', () => {
    expect(fromEntry).toBe(fromCore);
    expect(fromEntryDateTime).toBe(fromCoreDateTime);
    expect(fromEntryRelative).toBe(fromCoreRelative);
  });

  it('still formats the way it did before the move', () => {
    // A non-current year, so the "drop the year" branch is not in play.
    expect(fromEntry('2024-07-04', undefined, { locale: 'en-US' })).toBe('Jul 4, 2024');
    expect(fromEntry('2024-07-04', 'short', { locale: 'en-US' })).toBe("Jul 4, '24");
    expect(fromEntry('', undefined, { locale: 'en-US' })).toBe('—');
  });
});
