/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11254 — `NumberCellRenderer` reads its width through
 * `resolveFieldScale`, a carrier of ruling A′ (objectstack-ai/objectstack#19628),
 * instead of `typeof scale === 'number'`.
 *
 * The two reads agree for every WELL-FORMED declaration and for an absent one.
 * They part only on a malformed declaration that is still a JS number — the
 * resolver's door is `Number.isInteger(scale) && scale >= 0`, the one
 * `objectql`'s record validator applies, and anything else is "no declaration":
 *   - `scale: 1.5` — `Intl` floored it to one place, so `3.14159` read `3.1`, a
 *     width nobody declared, while the grid footer (already on the resolver)
 *     read the same column at its natural precision;
 *   - `scale: -1` — `Intl` refused it, so the cell threw a `RangeError` and
 *     took its row down.
 * A string `scale: "2"` was already no declaration on both reads (a control).
 *
 * The resolved value also feeds the grouping POLICY (objectui#4033) the way
 * the raw one did: a declared `scale: 0` is an ordinal and renders ungrouped,
 * an absent one keeps grouping.
 *
 * ── Directions on the base tree (predicted before the first run) ──────────
 *   `scale: 1.5`                 RED   (`3.1` before)
 *   `scale: -1`                  RED   (RangeError before)
 *   `scale: "2"`                 GREEN (no declaration on both reads)
 *   `scale: 2` / absent          GREEN
 *   `scale: 0` year / absent year GREEN (ungrouped / grouped)
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { NumberCellRenderer } from '../index';

const cellText = (value: unknown, field: Record<string, unknown> = {}): string => {
  const { container, unmount } = render(
    <LocalizationProvider value={{ locale: 'en' }}>
      <NumberCellRenderer value={value as any} field={{ type: 'number', ...field } as any} />
    </LocalizationProvider>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
};

describe('NumberCellRenderer reads the resolved width (objectui#11254)', () => {
  it('a non-integer `scale: 1.5` is no declaration: natural precision, not a floored width', () => {
    expect(cellText(3.14159, { scale: 1.5 })).toBe('3.14159');
  });

  it('a negative `scale: -1` is no declaration: the cell renders instead of throwing', () => {
    expect(cellText(3.14159, { scale: -1 })).toBe('3.14159');
  });

  it('a string `scale: "2"` is no declaration (control)', () => {
    expect(cellText(3.14159, { scale: '2' })).toBe('3.14159');
  });

  it('a declared `scale: 2` is that width (control)', () => {
    expect(cellText(3.14159, { scale: 2 })).toBe('3.14');
  });

  it('an absent `scale` has no fixed width (control)', () => {
    expect(cellText(3.14159)).toBe('3.14159');
  });

  it('a declared `scale: 0` still renders ungrouped, an absent one still groups (objectui#4033)', () => {
    expect(cellText(2026, { scale: 0 })).toBe('2026');
    expect(cellText(2026)).toBe('2,026');
  });
});
