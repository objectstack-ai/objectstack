/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11026 — the field's authored `useGrouping` decides digit grouping,
 * over the interim scale-0 heuristic of objectui#4033.
 *
 * `@objectstack/spec` declares `FieldSchema.useGrouping` as a three-valued
 * hint: absent means the renderer decides, `false` is the author's opt-out,
 * `true` pins grouping on. Before this card nothing in the renderer read it,
 * so a `useGrouping: false` count with `scale: 2` still read `12,345.67` and a
 * `useGrouping: true` count with `scale: 0` still read `2026`.
 *
 * The rows below are the card's Acceptance: authored `false` wins even with a
 * non-zero scale, authored `true` wins even at `scale: 0`, and an unset key
 * keeps BOTH heuristic controls (`scale: 0` ungrouped, no scale grouped).
 *
 * The last block pins the one `Intl` spelling the card asked to mind: an
 * authored `true` reaches `Intl` as `true` ("always"), because the spec maps
 * the key 1:1 onto that option, while the heuristic's own "group" answer keeps
 * omitting the key ("auto"). A locale that leaves a four-digit number alone
 * under "auto" is the only place the two can be told apart.
 */

import { describe, it, expect } from 'vitest';
import { formatDisplayNumber, shouldGroupDisplayNumber } from '../number-display';

describe('shouldGroupDisplayNumber — an authored useGrouping answers first (objectui#11026)', () => {
  it('authored false wins over a non-zero scale', () => {
    expect(shouldGroupDisplayNumber(2, undefined, false)).toBe(false);
  });

  it('authored true wins over scale 0', () => {
    expect(shouldGroupDisplayNumber(0, undefined, true)).toBe(true);
  });

  it('authored false wins over the money rule too', () => {
    expect(shouldGroupDisplayNumber(0, 'USD', false)).toBe(false);
  });

  it('CONTROL: unset keeps the heuristic, scale 0 is ungrouped', () => {
    expect(shouldGroupDisplayNumber(0, undefined, undefined)).toBe(false);
  });

  it('CONTROL: unset keeps the heuristic, no scale is grouped', () => {
    expect(shouldGroupDisplayNumber(undefined, undefined, undefined)).toBe(true);
  });
});

describe('formatDisplayNumber — an authored useGrouping renders as declared (objectui#11026)', () => {
  const fixed = (digits: number) => ({ minimumFractionDigits: digits, maximumFractionDigits: digits });

  it('authored false renders ungrouped even with a non-zero scale', () => {
    expect(
      formatDisplayNumber(12345.67, { locale: 'en-US', scale: 2, useGrouping: false, ...fixed(2) }),
    ).toBe('12345.67');
  });

  it('CONTROL: the same number with no authored hint is grouped (scale 2 is not an ordinal)', () => {
    expect(formatDisplayNumber(12345.67, { locale: 'en-US', scale: 2, ...fixed(2) })).toBe('12,345.67');
  });

  it('authored true renders grouped even at scale 0', () => {
    expect(formatDisplayNumber(2026, { locale: 'en-US', scale: 0, useGrouping: true, ...fixed(0) })).toBe('2,026');
  });

  it('CONTROL: unset at scale 0 keeps the heuristic, 2026', () => {
    expect(formatDisplayNumber(2026, { locale: 'en-US', scale: 0, ...fixed(0) })).toBe('2026');
  });

  it('CONTROL: unset with no scale keeps the heuristic, 2,026', () => {
    expect(formatDisplayNumber(2026, { locale: 'en-US' })).toBe('2,026');
  });

  it('authored false suppresses grouping on money as well', () => {
    expect(formatDisplayNumber(1234, { locale: 'en-US', currency: 'USD', useGrouping: false })).toBe('$1234.00');
  });
});

describe('formatDisplayNumber — an authored true reaches Intl as "always" (objectui#11026)', () => {
  it.each(['es-ES', 'pl-PL'])('%s: authored true groups a four-digit number the locale leaves alone', (locale) => {
    const auto = new Intl.NumberFormat(locale, {}).format(1234);
    const always = new Intl.NumberFormat(locale, { useGrouping: true }).format(1234);
    // The premise: "auto" and "always" genuinely differ in this locale, so the
    // two assertions below can tell the spellings apart.
    expect(auto).not.toBe(always);

    expect(formatDisplayNumber(1234, { locale, useGrouping: true })).toBe(always);
    // CONTROL: the heuristic's own "group" answer still omits the key.
    expect(formatDisplayNumber(1234, { locale })).toBe(auto);
  });
});
