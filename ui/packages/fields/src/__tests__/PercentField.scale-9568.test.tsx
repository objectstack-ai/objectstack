/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9568 — the percent EDIT WIDGET read `precision` as a fraction
 * width, so a `decimal(10, 2)` percent field showed `25.0000000000%` and
 * stepped by `1e-10`.
 *
 * `@objectstack/spec` declares the pair on the field face in its own words —
 * `precision` is "Total digits (non-negative integer)" and `scale` is "Decimal
 * places (non-negative integer)" — so the member a decimal-place width comes
 * from is `scale`. `NumberField` in the same directory already carries that
 * correction for its step, and objectui#9295 made it on the read-only cell,
 * the grid summary footer and the detail summary chip. This widget is the face
 * that did not move, and the one the user TYPES into.
 *
 * ── Why the assertions are on the rendered control ──────────────────────
 * The defect is what the user sees and what the spinner offers, so every row
 * below goes through the component and reads the DOM it produced: the readonly
 * span's text, and the `step` attribute the browser's spinner and keyboard
 * affordances obey. The slider's step is not a DOM attribute, so it is driven
 * instead — one keyboard increment, whose emitted value IS the step.
 *
 * ── What fails before the repair ────────────────────────────────────────
 * Every `scale`-declaring row. `{ precision: 10, scale: 2 }` rendered
 * `25.0000000000%` readonly, `step="0.0000000001"` editable, and a slider
 * increment of `1e-10`; `{ scale: 0 }` was ignored outright because
 * `precision` was absent, so the width fell to the widget's own 2.
 *
 * ── The ABSENT-`scale` case moved later, by its own ruling ──────────────
 * objectui#9568 kept this widget's own 2 for a field declaring neither member
 * and pinned it as a must-not-change control, declining to settle the
 * disagreement with `PercentCellRenderer`, which spelled the same absence `0`.
 * objectui#9843 settled it (ruling A′): the absent width is the protocol's,
 * read through `@objectstack/spec`'s `resolveFieldScale` on every face. The
 * rows below that declare no `scale` now assert that width; the five-face
 * parity pin is `percentAbsentScale.fiveFaces-9843.test.tsx` in plugin-grid.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { resolveFieldScale } from '@objectstack/spec/data';

import { PercentField } from '../widgets/PercentField';

afterEach(() => cleanup());

const percentField = (field: Record<string, unknown>) =>
  ({ type: 'percent', name: 'rate', ...field }) as any;

const renderReadonly = (value: number, field: Record<string, unknown> = {}) =>
  render(
    <PercentField value={value} onChange={() => {}} field={percentField(field)} readonly />,
  );

const renderEditable = (
  value: number,
  field: Record<string, unknown> = {},
  onChange: (v: unknown) => void = () => {},
) =>
  render(
    <PercentField value={value} onChange={onChange as any} field={percentField(field)} />,
  );

/** The width the readonly face renders, percent sign included. */
const readonlyText = () => document.body.textContent ?? '';

/** The granularity the browser's spinner and arrow keys obey. */
const inputStep = () => screen.getByRole('spinbutton').getAttribute('step');

describe('PercentField reads `scale`, not `precision` (objectui#9568)', () => {
  it('does not pad a decimal(10, 2) percent field out to ten fraction digits', () => {
    // The card's headline reading, on the readonly face.
    renderReadonly(0.25, { precision: 10, scale: 2 });

    expect(readonlyText()).toContain('25.00%');
    expect(readonlyText()).not.toContain('25.0000000000%');
  });

  it('offers a usable spinner step for a decimal(10, 2) percent field', () => {
    // The half that is not cosmetic: `1e-10` is not a granularity anybody can
    // operate, and it is what the browser's arrow keys and spinner obeyed.
    renderEditable(0.25, { precision: 10, scale: 2 });

    expect(inputStep()).toBe('0.01');
    expect(inputStep()).not.toBe('0.0000000001');
  });

  it('steps the slider by the same declared width as the input', () => {
    // The slider's step is a prop, not an attribute, so it is DRIVEN: one
    // ArrowRight from a stored 0.25 emits the next value one step away, in
    // display magnitude (25 -> 25.01), stored back as a fraction. Before the
    // repair the same keystroke emitted 0.25 + 1e-12.
    const onChange = vi.fn();
    renderEditable(0.25, { precision: 10, scale: 2 }, onChange);

    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0.2501, 6);
  });

  it('honours `scale: 0`, which truthiness would have dropped', () => {
    // `scale: 0` is a valid declaration — a percent field that edits whole
    // percents. Before the repair this field had NO declared width at all
    // (`precision` absent), so it rendered two decimals and stepped by 0.01.
    renderReadonly(0.25, { scale: 0 });
    expect(readonlyText()).toContain('25%');
    expect(readonlyText()).not.toContain('25.00%');
    cleanup();

    renderEditable(0.25, { scale: 0 });
    expect(inputStep()).toBe('1');
  });

  it('ignores `precision` entirely when no `scale` is declared', () => {
    // decimal(10, 0) — ten total digits. `precision` alone must move nothing,
    // in either face: the field is undeclared, and takes the protocol's width.
    const width = resolveFieldScale({ type: 'percent' }) as number;
    renderReadonly(0.25, { precision: 10 });
    expect(readonlyText()).toContain(`${(25).toFixed(width)}%`);
    expect(readonlyText()).not.toContain('25.0000000000%');
    cleanup();

    renderEditable(0.25, { precision: 10 });
    expect(inputStep()).toBe((10 ** -width).toFixed(width));
    expect(inputStep()).not.toBe('0.0000000001');
  });

  it('a field declaring neither member takes the protocol’s absent width (objectui#9843)', () => {
    // This row pinned the widget's own `2` (`12.35%`, `step="0.01"`) until
    // objectui#9843 retired it; the width is `resolveFieldScale`'s now, the
    // same one `PercentCellRenderer` reads, so the widget renders `12%`.
    renderReadonly(0.12345);
    expect(readonlyText()).toContain('12%');
    expect(readonlyText()).not.toContain('12.35%');
    cleanup();

    renderEditable(0.12345);
    expect(inputStep()).toBe('1');
  });

  it('applies the declared width to the whole-percent convention too', () => {
    // A field declaring `max > 1` stores percentage POINTS, and that detection
    // is untouched by this repair: a stored 25 is 25%, rendered at the width
    // `scale` declares.
    renderReadonly(25, { max: 100, precision: 10, scale: 1 });
    expect(readonlyText()).toContain('25.0%');
    expect(readonlyText()).not.toContain('25.0000000000%');
    cleanup();

    renderEditable(25, { max: 100, precision: 10, scale: 1 });
    expect(inputStep()).toBe('0.1');
  });
});
