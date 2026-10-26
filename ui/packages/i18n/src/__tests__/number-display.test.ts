/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Unit pins for the ONE number-display formatter (objectui#4033).
 *
 * The renderer-level pins live next to their renderers; these cover the policy
 * itself, including the two Intl traps the implementation is written around.
 */

import { describe, it, expect } from 'vitest';
import { formatDisplayNumber, shouldGroupDisplayNumber } from '../utils/number-display';

describe('shouldGroupDisplayNumber', () => {
  it('suppresses grouping for a declared scale of 0 with no currency', () => {
    expect(shouldGroupDisplayNumber(0, undefined)).toBe(false);
  });

  it('keeps grouping when the scale is undeclared (absent ≠ integer)', () => {
    expect(shouldGroupDisplayNumber(undefined, undefined)).toBe(true);
  });

  it('keeps grouping for a non-zero scale', () => {
    expect(shouldGroupDisplayNumber(2, undefined)).toBe(true);
  });

  it('keeps grouping for money even at scale 0 — an ordinal amount is not a thing', () => {
    expect(shouldGroupDisplayNumber(0, 'USD')).toBe(true);
  });
});

describe('formatDisplayNumber — grouping policy', () => {
  it('renders the card fixture (a scale-0 year) ungrouped', () => {
    expect(
      formatDisplayNumber(2026, {
        locale: 'en-US',
        scale: 0,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
    ).toBe('2026');
  });

  it('groups a scale-0 number once a currency is present', () => {
    expect(formatDisplayNumber(2026, { locale: 'en-US', scale: 0, currency: 'USD' })).toBe(
      '$2,026.00',
    );
  });

  it('groups when no scale is passed at all', () => {
    expect(formatDisplayNumber(1234567, { locale: 'en-US' })).toBe('1,234,567');
  });
});

describe('formatDisplayNumber — active locale', () => {
  it.each([
    ['en-US', '1,234.5'],
    ['de-DE', '1.234,5'],
    ['zh-CN', '1,234.5'],
  ])('formats 1234.5 per %s conventions', (locale, expected) => {
    expect(
      formatDisplayNumber(1234.5, { locale, minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    ).toBe(expected);
  });

  it('falls back to the runtime default instead of throwing on a malformed tag', () => {
    // A malformed `localization.locale` from a tenant config must never take a
    // cell down. `new Intl.NumberFormat('not a locale')` throws RangeError.
    expect(() => new Intl.NumberFormat('not a locale')).toThrow(RangeError);
    expect(formatDisplayNumber(1234, { locale: 'not a locale' })).toMatch(/^1.?234$/);
  });

  it('still surfaces a bad currency code to the caller', () => {
    // Call sites keep their own `${currency} ${value.toFixed(n)}` fallbacks, so
    // this must NOT be swallowed the way a bad locale is.
    expect(() => formatDisplayNumber(1234, { locale: 'en-US', currency: 'NOTACODE' })).toThrow();
  });
});

describe('formatDisplayNumber — the `useGrouping: true` trap', () => {
  /**
   * `useGrouping: true` is NOT equivalent to omitting the key. `true` means
   * "always"; omitting means "auto", which is the LOCALE's own preference — and
   * several locales do not group four-digit numbers under "auto".
   *
   * This pins the trap itself, so that anyone later "simplifying" the
   * implementation to always emit an explicit boolean sees exactly what breaks:
   * es-ES and pl-PL would start grouping numbers their conventions leave alone.
   */
  it.each(['es-ES', 'pl-PL'])(
    'keeps %s conventions for a 4-digit number rather than forcing a separator',
    (locale) => {
      const auto = new Intl.NumberFormat(locale, {}).format(1234);
      const always = new Intl.NumberFormat(locale, { useGrouping: true }).format(1234);

      // The premise of the trap: these genuinely differ in this locale.
      expect(auto).not.toBe(always);
      // And the shared formatter follows "auto", not "always".
      expect(formatDisplayNumber(1234, { locale })).toBe(auto);
    },
  );

  it('emits an explicit `false` only when suppressing', () => {
    // Deliberately en-US, NOT one of the two locales above. Reverse
    // verification caught this pin passing for an empty reason: es-ES renders
    // 1234 ungrouped under "auto" as well, so asserting '1234' there is green
    // whether or not the suppression exists. en-US separates the two —
    // "auto" gives `1,234`, suppression gives `1234`.
    expect(new Intl.NumberFormat('en-US', {}).format(1234)).toBe('1,234');
    expect(formatDisplayNumber(1234, { locale: 'en-US', scale: 0 })).toBe('1234');
  });
});
