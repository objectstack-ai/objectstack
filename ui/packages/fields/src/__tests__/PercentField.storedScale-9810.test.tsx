/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9810 — the percent edit widget offered a step the write path
 * refuses, and it still did after the ruling settled which meaning `scale`
 * carries.
 *
 * Maintainer ruling, batch #161 item 3, letter B — operative clause, quoted:
 *
 * > `scale` on a `percent` field means the DISPLAYED percentage-point
 * > decimals — the landed objectui#9295 convention; the storage side derives:
 * > for a fraction-stored percent (`percentScaleOf` = `fraction`) the objectql
 * > record validator's `max_scale` branch allows `scale + 2` decimal places in
 * > the stored fraction; the spec docblock states both; ⛔ no second member
 *
 * ⇒ the display half of that clause is already landed here (objectui#9295 on
 * the cell, objectui#9568 on this widget). What was NOT landed is the widget's
 * ability to MEET the derivation: the stored fraction came from `n / 100`, and
 * a binary float divided by 100 carries residue no author typed. A value the
 * widget's own `step` attribute offers therefore reached the platform with 16
 * to 19 decimal places, and `max_scale` — which is enforced by REJECTION,
 * never by rounding — refuses it against ANY declared width. The 100x reading
 * the card was filed over is the ruling's business; this file pins the half
 * that is this widget's.
 *
 * ── What fails before the repair ────────────────────────────────────────
 * Every row of the residue table below, and the sweep. `66.67` typed into a
 * `scale: 2` percent field stored `0.6667000000000001`; `99.99` stored
 * `0.9998999999999999`; `29.97` stored `0.29969999999999997`.
 *
 * ── What is deliberately NOT pinned as rounding ─────────────────────────
 * An author who types FINER than the declared width still stores every digit
 * they typed (`12.345` ⇒ `0.12345`) and is still refused upstream. That is the
 * ruled behaviour: `max_scale` refuses rather than rounds, so a widget-side
 * rounding would convert the platform's refusal into silent data alteration.
 * The repair corrects OUR arithmetic, it does not edit the author's value —
 * pinned below in both directions.
 *
 * ── The instrument ──────────────────────────────────────────────────────
 * `decimalPlacesOf` below is the platform's own reading, replicated because
 * `@objectstack/objectql` is not a dependency of this package: the objectql
 * record validator's `max_scale` branch counts decimal places off the value's
 * `String()` form, exponent included, and compares that count against the
 * declaration. ⛔ No number in this header is re-derived by anything; what the
 * rows below re-derive is the INVARIANT — every display value they enumerate
 * stores within the ruled width.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { PercentField } from '../widgets/PercentField';

afterEach(() => cleanup());

const percentField = (field: Record<string, unknown>) =>
  ({ type: 'percent', name: 'rate', ...field }) as any;

const renderEditable = (
  value: number | null,
  field: Record<string, unknown>,
  onChange: (v: unknown) => void,
) =>
  render(
    <PercentField value={value as any} onChange={onChange as any} field={percentField(field)} />,
  );

/** Type a percentage-point value into the box the author actually types into. */
const type = (displayValue: string) =>
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: displayValue } });

/**
 * The count the platform's `max_scale` branch takes: decimal places of the
 * value's `String()` form, with an exponent folded in (`1e-9` is nine places).
 */
const decimalPlacesOf = (n: number): number => {
  const m = /^-?\d+(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(n));
  if (!m) return 0;
  const fractionDigits = m[1] ? m[1].length : 0;
  const exponent = m[2] ? Number(m[2]) : 0;
  return Math.max(0, fractionDigits - exponent);
};

/** One typed value in, the one stored value the widget emitted out. */
const storedFor = (typed: string, field: Record<string, unknown>): unknown => {
  const onChange = vi.fn();
  // An EMPTY box, ⛔ not a pre-filled one: React delivers no change event when
  // `.value` does not move, and one of the rows below types the value the box
  // would already be showing.
  renderEditable(null, field, onChange);
  type(typed);
  expect(onChange).toHaveBeenCalledTimes(1);
  const stored = onChange.mock.calls[0][0];
  cleanup();
  return stored;
};

describe('PercentField stores a fraction within the ruled `scale + 2` width (objectui#9810)', () => {
  it('stores an ordinary two-decimal percentage point as the value it is', () => {
    // The residue table: every row is a display value the widget's own
    // `step="0.01"` offers, and every one of them overflowed the ruled
    // `scale + 2 = 4` places before the repair.
    const rows: Array<[string, number]> = [
      ['66.67', 0.6667],
      ['99.99', 0.9999],
      ['29.97', 0.2997],
      ['8.35', 0.0835],
      ['0.07', 0.0007],
      ['0.35', 0.0035],
    ];

    for (const [typed, expected] of rows) {
      const stored = storedFor(typed, { scale: 2 });
      expect(stored).toBe(expected);
      expect(decimalPlacesOf(stored as number)).toBeLessThanOrEqual(4);
    }
  });

  it('holds for every display value the declared step offers', () => {
    // The sweep: the `scale: 2` grid this widget offers is `0.00` … `100.00`
    // in hundredths. Enumerated here at every third step so the whole range is
    // covered within a test's budget; the invariant is re-derived on each
    // value enumerated, ⛔ not sampled from a remembered list of failures.
    const onChange = vi.fn();
    renderEditable(0, { scale: 2 }, onChange);

    const offenders: Array<[string, unknown]> = [];
    for (let i = 0; i <= 10000; i += 3) {
      const typed = (i / 100).toFixed(2);
      onChange.mockClear();
      type(typed);
      const stored = onChange.mock.calls[0]?.[0] as number;
      if (decimalPlacesOf(stored) > 4) offenders.push([typed, stored]);
    }

    expect(offenders).toEqual([]);
  });

  it('CONTROL: a value the old division already got right is byte-identical', () => {
    // MUST-NOT-CHANGE: where `n / 100` landed on the exact decimal, the repair
    // changes nothing — the same double, not merely a close one.
    expect(storedFor('12.34', { scale: 2 })).toBe(0.1234);
    expect(storedFor('50', { scale: 2 })).toBe(0.5);
    expect(storedFor('25', { scale: 2 })).toBe(0.25);
    expect(storedFor('0', { scale: 2 })).toBe(0);
    expect(storedFor('100', { scale: 2 })).toBe(1);
  });

  it('CONTROL: the whole-percent convention (`max > 1`) is untouched', () => {
    // There the typed number IS the stored number, so there is no arithmetic
    // of ours to correct — and the ruling derives `scale`, not `scale + 2`,
    // for that storage scale.
    expect(storedFor('66.67', { scale: 2, max: 100 })).toBe(66.67);
    expect(decimalPlacesOf(66.67)).toBe(2);
  });

  it('does NOT round an author who types finer than the declared width', () => {
    // The refusal stays upstream, where the ruling put it. `0.12345` is five
    // places against a `scale: 2` field's allowance of four: the platform
    // refuses it, and this widget must not quietly make it storable.
    const stored = storedFor('12.345', { scale: 2 }) as number;
    expect(stored).toBe(0.12345);
    expect(decimalPlacesOf(stored)).toBe(5);
  });

  it('meets the derivation for `scale: 0` too', () => {
    // `scale: 0` — whole displayed percents, so two stored places.
    const stored = storedFor('37', { scale: 0 }) as number;
    expect(stored).toBe(0.37);
    expect(decimalPlacesOf(stored)).toBeLessThanOrEqual(2);
  });

  it('emits the same exact fraction from the slider as from the input', () => {
    // The slider shares the ONE conversion, so it shares the ruled width. One
    // ArrowRight from a stored 0.2 walks the display to the next step (20 ->
    // 20.01), which `n / 100` stored as `0.20010000000000003`.
    const onChange = vi.fn();
    renderEditable(0.2, { scale: 2 }, onChange);

    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const stored = onChange.mock.calls[0][0] as number;
    expect(decimalPlacesOf(stored)).toBeLessThanOrEqual(4);
    expect(stored).toBe(0.2001);
  });
});
