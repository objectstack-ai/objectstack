/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression for objectstack-ai/objectstack#5066: the percent / progress cell
 * renderer emitted a FIXED-WIDTH, NON-SHRINKABLE bar (`w-16 shrink-0`) next to a
 * shrinkable value span. Inside a narrow clipping container — a
 * `record:highlights` chip is `basis-[9rem]` / `min-w-[7rem]` and clips with
 * `truncate` — the 64px bar won the space and the VALUE was cut mid-digit: a
 * stored `33.33` carried `33%` in the DOM but read as `3` on screen (measured:
 * 79px clipping box, 32px text node, 25px overflow), with no ellipsis and no
 * signal in the accessible name. A silently wrong number, not a cosmetic glitch.
 *
 * Pin: the number is the CONTENT (`shrink-0`, never sacrificed) and the bar is
 * DECORATION (`w-16` as its preferred width, free to shrink away under
 * pressure — and never `flex-1`, so a wide grid cell keeps today's 64px bar).
 *
 * jsdom has no layout engine, so these are class-semantics assertions (same
 * approach as `cell-truncation.test.tsx` for objectui#3466) plus DOM-text
 * assertions — deliberately not brittle pixel measurements.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { PercentCellRenderer } from '../index';

const renderPercent = (value: unknown, field: Record<string, unknown> = {}) =>
  render(
    <PercentCellRenderer value={value as any} field={{ type: 'percent', ...field } as any} />,
  );

/**
 * objectui#11475 — `33.33` is percentage POINTS, so the field says so the way
 * a whole-stored field does: a `max` above 1 (the spec's `percentScaleOf`). The
 * cell reads that declaration now; it used to guess points from the value's
 * size. The layout contract this file pins is unchanged.
 */
const WHOLE = { max: 100 };

/** The decorative bar: `role="progressbar"` wrapper the renderer emits. */
const bar = () => screen.getByRole('progressbar');
/** The row that holds bar + value. */
const row = () => bar().parentElement!;

describe('PercentCellRenderer — value beats the decorative bar (issue #5066)', () => {
  it('renders BOTH the bar and the value at normal width', () => {
    renderPercent(33.33, WHOLE);

    expect(bar()).toBeInTheDocument();
    expect(bar()).toHaveAttribute('aria-valuenow', '33.33');
    expect(screen.getByText('33%')).toBeInTheDocument();
    // Bar and value are siblings in one flex row (nothing was dropped).
    expect(row()).toHaveClass('flex');
    expect(row()).toContainElement(screen.getByText('33%'));
  });

  it('gives the value span shrink priority so a narrow chip cannot clip it', () => {
    renderPercent(33.33, WHOLE);

    const value = screen.getByText('33%');
    // The number never shrinks — it is the content of the cell.
    expect(value).toHaveClass('shrink-0');
    expect(value).toHaveClass('whitespace-nowrap', 'tabular-nums');
  });

  it('lets the bar shrink away instead of pushing the value out of the clip box', () => {
    renderPercent(33.33, WHOLE);

    // The bar keeps `w-16` as its PREFERRED width but is shrinkable, and
    // `min-w-0` stops the automatic minimum size from pinning it at 64px.
    expect(bar()).toHaveClass('w-16', 'min-w-0', 'shrink');
    // The pre-fix spelling: a non-shrinkable bar is exactly the bug.
    expect(bar()).not.toHaveClass('shrink-0');
    // The row itself must be able to shrink below its content width inside the
    // chip's flex column, or the deficit never reaches the bar.
    expect(row()).toHaveClass('min-w-0');
  });

  it('does not let the bar GROW in a wide cell (no flex-1 / grow)', () => {
    renderPercent(33.33, WHOLE);

    // `flex-1` would also make the bar stretch to fill every wide grid cell —
    // `w-16` stays the upper bound, only the shrink direction changed.
    expect(bar().className).not.toMatch(/(^|\s)(flex-1|grow|basis-)/);
  });

  it('keeps the full formatted value in the DOM (fraction, whole, precision)', () => {
    const first = renderPercent(33.33, WHOLE);
    expect(screen.getByText('33%')).toBeInTheDocument();
    first.unmount();

    // A declared `scale` keeps the decimals — the widest text, worst overflow.
    // ⛔ NOT `precision` (objectui#9295): that is the column's TOTAL digit
    // count, and reading it here is the defect that card removed.
    renderPercent(33.33, { ...WHOLE, scale: 2 });
    const wide = screen.getByText('33.33%');
    expect(wide).toBeInTheDocument();
    expect(wide).toHaveClass('shrink-0');
  });

  it('scales a fraction-stored percent and still renders both parts', () => {
    renderPercent(0.8);

    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(bar()).toHaveAttribute('aria-valuenow', '80');
    expect(screen.getByText('80%')).toHaveClass('shrink-0');
  });

  it('applies the same contract to whole-percent `progress` fields', () => {
    renderPercent(33.33, { type: 'progress', name: 'progress' });

    // 0-100 storage: no fraction scaling, value rendered as-is.
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByText('33%')).toHaveClass('shrink-0');
    expect(bar()).toHaveClass('min-w-0', 'shrink');
    expect(bar()).not.toHaveClass('shrink-0');
  });
});
