/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11475 — the percent CELL scales at the storage the field DECLARES,
 * the way the read-only form already did, so one stored value reads one
 * percentage on both faces.
 *
 * The cell used to take its magnitude from `percentDisplayValue`'s guess,
 * `value > -1 && value < 1 ? value * 100 : value`, which read neither the field
 * nor its `max`. The read-only form (`PercentField`) reads the declaration
 * through the spec's rule — a fraction unless the field declares a `max` above
 * 1 — so the two faces parted on every value the guess got wrong. The card's
 * three rows, measured against the real faces at `6007dd4e4`:
 *
 *   stored / field                       read-only form   cell (before)
 *   `1`, no `max` (fraction)             `100%`           `1%`
 *   `1.5`, `scale: 1`, no `max`          `150.0%`         `1.5%`
 *   `0.5`, `max: 100` (whole)            `0.5%`           `50.0%`
 *
 * The third row is declared at `scale: 1` below, so its form reading is `0.5%`
 * rather than the default width's `1%`; the magnitude split is the same.
 *
 * Both faces are driven here, in the same run, and asserted EQUAL as well as
 * equal to the reading the declaration implies. The control, `0.25` on a
 * fraction-stored field, agreed before the change and must keep agreeing.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { PercentCellRenderer, formatPercent, percentCellScale } from '../index';
import { PercentField } from '../widgets/PercentField';

afterEach(cleanup);

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      {children}
    </I18nProvider>
  );
}

function formText(value: number, field: Record<string, unknown>): string {
  const { container, unmount } = render(
    <Providers>
      <PercentField value={value} onChange={() => {}} field={field as any} readonly />
    </Providers>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

function cellText(value: unknown, field: Record<string, unknown>): string {
  const { container, unmount } = render(
    <Providers>
      <PercentCellRenderer value={value as any} field={field as any} />
    </Providers>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

function cellBar(value: unknown, field: Record<string, unknown>): string | null {
  const { container, unmount } = render(
    <Providers>
      <PercentCellRenderer value={value as any} field={field as any} />
    </Providers>,
  );
  const bar = container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? null;
  unmount();
  return bar;
}

const ROWS: Array<[string, number, Record<string, unknown>, string]> = [
  ['a fraction-stored `1` is 100%', 1, { type: 'percent' }, '100%'],
  ['a fraction-stored `1.5` at `scale: 1` is 150.0%', 1.5, { type: 'percent', scale: 1 }, '150.0%'],
  ['a whole-stored `0.5` (`max: 100`) at `scale: 1` is 0.5%', 0.5, { type: 'percent', max: 100, scale: 1 }, '0.5%'],
];

describe('the read-only form and the cell read one stored value at one percentage (objectui#11475)', () => {
  it.each(ROWS)('%s, on both faces', (_label, value, field, expected) => {
    const form = formText(value, field);
    const cell = cellText(value, field);
    expect({ form, cell }).toEqual({ form: expected, cell: expected });
  });

  it('control: `0.25` on a fraction-stored field reads 25% on both faces, as it always did', () => {
    const field = { type: 'percent' };
    expect({ form: formText(0.25, field), cell: cellText(0.25, field) }).toEqual({ form: '25%', cell: '25%' });
  });

  it('a whole-stored `50` (`max: 100`, every shipped percent field) still reads 50% on both faces', () => {
    const field = { type: 'percent', max: 100 };
    expect({ form: formText(50, field), cell: cellText(50, field) }).toEqual({ form: '50%', cell: '50%' });
  });

  it("the bar's fill takes the same storage as the number", () => {
    expect(cellBar(1, { type: 'percent' })).toBe('100');
    expect(cellBar(0.5, { type: 'percent', max: 100 })).toBe('0.5');
  });
});

describe('`percentCellScale` — the storage every percent face reads (objectui#11475)', () => {
  it('a percent field is a fraction unless it declares a `max` above 1, the spec\'s `percentScaleOf`', () => {
    expect(percentCellScale({ type: 'percent' })).toBe('fraction');
    expect(percentCellScale({ type: 'percent', max: 1 })).toBe('fraction');
    expect(percentCellScale({ type: 'percent', max: 100 })).toBe('whole');
  });

  it('a `max` that is not a number is not a declaration', () => {
    expect(percentCellScale({ type: 'percent', max: '100' })).toBe('fraction');
  });

  it('`progress` is stated `whole`: the spec gives it no percent storage and its slider stores points', () => {
    expect(percentCellScale({ type: 'progress' })).toBe('whole');
    expect(cellText(50, { type: 'progress', min: 0, max: 100 })).toBe('50%');
    // Half a percentage point, rounded at the default width: never `50%`.
    expect(cellText(0.5, { type: 'progress' })).toBe('1%');
  });

  it('a textual field the `format: \'percent\'` hint promotes reads by the percent convention', () => {
    expect(percentCellScale({ type: 'text', format: 'percent' } as never)).toBe('fraction');
    expect(cellText('0.25', { type: 'text', format: 'percent' })).toBe('25%');
  });
});

describe('`formatPercent` takes the storage as a required argument (objectui#11475)', () => {
  it('scales at the stated storage', () => {
    expect(formatPercent(1, 'fraction')).toBe('100%');
    expect(formatPercent(1, 'whole')).toBe('1%');
    expect(formatPercent(0.255, 'fraction', 1, 'en')).toBe('25.5%');
  });

  it('refuses a storage outside the union rather than falling to a branch', () => {
    expect(() => formatPercent(1, 'points' as never)).toThrow(TypeError);
    expect(() => formatPercent(1, undefined as never)).toThrow(/percentScale must be 'fraction' or 'whole'/);
  });
});
