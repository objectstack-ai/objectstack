/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9295 — `PercentCellRenderer` read `precision` as a FRACTION-digit
 * count, in the same file whose number arm records that `precision` is the
 * TOTAL digit count of a `decimal(p, s)` column.
 *
 * `@objectstack/spec` declares the pair on the field face in its own words —
 * `precision` is "Total digits (non-negative integer)" and `scale` is "Decimal
 * places (non-negative integer)" — so the member to read is `scale`. This is
 * the identical repair objectui#2131 made on the currency arm and
 * objectui#2134 on the number arm, arriving one type later.
 *
 * ── Why the assertions are on RENDERED OUTPUT ───────────────────────────
 * The defect is what the user sees in the cell, and `formatPercent` is a
 * shared helper that was never wrong — it formats to the width it is handed.
 * Asserting the helper's return value would pin the wrong end and stay green
 * on the defect. Every row below goes through the component.
 *
 * ── What fails before the repair ────────────────────────────────────────
 * `decimal(10, 2)` — `{ precision: 10, scale: 2 }` — rendered
 * `25.0000000000%` for a stored `0.25`, padded out to the column's TOTAL
 * width. The grid footer beneath it read `Sum: 25.0000000000%` for the same
 * reason; its half of this card is pinned in `@object-ui/plugin-grid`.
 *
 * ── The ABSENT-`scale` case is a DECISION, not a leftover ───────────────
 * An absent `scale` stays `0` here, and deliberately NOT the `undefined`
 * (min 0 / max 20) that `NumberCellRenderer` uses for the same absence. This
 * path multiplies by 100 first (`percentDisplayValue`) and `Intl` renders from
 * the shortest decimal representation of the resulting double, so an unbounded
 * maximum prints binary residue: measured, a stored `0.07` scales to
 * `7.000000000000001` and `0.29` to `28.999999999999996`. The last two cases
 * below pin that those values stay readable.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { PercentCellRenderer } from '../index';

const renderPercent = (value: unknown, field: Record<string, unknown> = {}) =>
  render(
    <PercentCellRenderer value={value as any} field={{ type: 'percent', ...field } as any} />,
  );

/** The cell's whole text, bar included — the bar contributes none. */
const cellText = () => screen.getByRole('progressbar').parentElement!.textContent ?? '';

describe('PercentCellRenderer reads `scale`, not `precision` (objectui#9295)', () => {
  it('does not pad a decimal(10, 2) percent field out to ten fraction digits', () => {
    renderPercent(0.25, { name: 'rate', precision: 10, scale: 2 });

    // The card's headline reading, and the row that fails before the repair.
    expect(cellText()).toContain('25.00%');
    expect(cellText()).not.toContain('25.0000000000%');
  });

  it('ignores `precision` entirely when no `scale` is declared', () => {
    // decimal(10, 0) — ten total digits, zero decimal places. `precision`
    // alone must move nothing.
    renderPercent(0.25, { name: 'rate', precision: 10 });

    expect(cellText()).toContain('25%');
    expect(cellText()).not.toMatch(/\.0{3,}/);
  });

  it('honours a declared `scale` on its own', () => {
    renderPercent(0.25, { name: 'rate', scale: 3 });
    expect(cellText()).toContain('25.000%');
  });

  it('applies the same member to a value already in percentage points', () => {
    // A stored 25 is 25% here, not 2500%, because the field declares
    // whole-point storage (`max: 100`; objectui#11475 made the storage the
    // field's statement rather than a guess from the value's size). That is
    // the arm the value takes, and it reads `scale` like every other one.
    //
    // ⚠️ `progress` is kept as the field name deliberately. Until
    // objectui#9452 this input reached a SECOND scaling arm chosen by that
    // name, which was handed the same wrong member; the name is inert now and
    // the row still has to answer `25.00%`.
    renderPercent(25, { name: 'progress', precision: 10, scale: 2, max: 100 });

    expect(cellText()).toContain('25.00%');
    expect(cellText()).not.toContain('25.0000000000%');
  });

  it('leaves a field declaring neither member exactly where it was', () => {
    // MUST-NOT-CHANGE control: absent `scale` is still zero fraction digits,
    // so this repair is invisible to every field that declares nothing.
    renderPercent(0.12345, { name: 'rate' });
    expect(cellText()).toContain('12%');
  });

  it('keeps an absent `scale` free of binary floating-point residue', () => {
    // The measured reason the absent case is `0` and not `undefined`
    // (min 0 / max 20): `0.07 * 100` is `7.000000000000001` as a double.
    renderPercent(0.07, { name: 'rate' });
    expect(cellText()).toContain('7%');
    expect(cellText()).not.toContain('7.000000000000001%');
    cleanup();

    renderPercent(0.29, { name: 'rate' });
    expect(cellText()).toContain('29%');
    expect(cellText()).not.toContain('28.999999999999996%');
  });
});
