/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The aggregate footer's provider-less fallback stays ENGLISH — objectui#4024,
 * and the #4514 trap.
 *
 * `useColumnSummary` is a PUBLIC export of `@object-ui/plugin-grid`
 * (`src/index.tsx:35`) and its sibling suite `useColumnSummary.test.tsx` asserts
 * `/Sum: /` with only a `LocalizationProvider` mounted — no i18n provider at
 * all. Routing the prefix through `createSafeTranslation` rather than
 * `useObjectTranslation` is what keeps that suite, and every downstream
 * consumer's provider-less test, rendering English instead of
 * `grid.summary.sum`.
 *
 * Separate FILE, not a separate `it`: `createI18n` registers a react-i18next
 * module-global default that survives `cleanup()`, so a no-provider case
 * sharing a file with locale-mounted renders resolves against whichever locale
 * ran last (objectstack#5505/#5506).
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * PASSES before and after — a must-not-change pin. It goes red only if the fix
 * reaches for `useObjectTranslation` directly.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useColumnSummary } from './useColumnSummary';

const DATA = [{ amount: 1000 }, { amount: 234 }, { amount: null }];

describe('aggregate footer with no I18nProvider (objectui#4024 / #4514)', () => {
  it('renders the English prefix and separator, never a raw bundle key', () => {
    const cols: any[] = [{ field: 'amount', summary: 'sum' }];
    const { result } = renderHook(() => useColumnSummary(cols, DATA));
    const label = result.current.summaries.get('amount')?.label ?? '';

    expect(label).toBe('Sum: 1,234');
    expect(label).not.toContain('grid.summary');
  });

  it('every kind keeps an English prefix with no provider', () => {
    for (const [kind, expected] of [
      ['avg', 'Avg: 617'],
      ['min', 'Min: 234'],
      ['max', 'Max: 1,000'],
      ['count', 'Count: 3'],
      ['count_unique', 'Unique: 2'],
    ] as const) {
      const cols: any[] = [{ field: 'amount', summary: kind }];
      const { result } = renderHook(() => useColumnSummary(cols, DATA));
      expect(result.current.summaries.get('amount')?.label).toBe(expected);
    }
  });
});
