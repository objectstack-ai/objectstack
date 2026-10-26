/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11444 — a read-only `PercentField` and a read-only `CurrencyField`
 * show the text their table cells show, because each face pair makes ONE
 * formatting call. The rest of objectui#11431's family (the `number` member,
 * `NumberField.readonlyDisplay-11431.test.tsx`).
 *
 * Two gaps, measured through the real `SchemaRenderer` form against the cell:
 *
 * - **percent:** the read-only face printed `toDisplay(value).toFixed(scale)`
 *   plus a literal `%`, with no display locale and no grouping. A `scale: 2`
 *   field holding `0.25` read `25.00%` in a `de` form while
 *   `PercentCellRenderer` read `25,00 %` (a no-break space before the sign).
 *   Both faces now render through `formatPercentPoints`, the body
 *   `formatPercent` uses. Each face keeps its own storage reading (the face's
 *   declared `max > 1` rule; the cell's `percentDisplayValue`), so every row
 *   below holds a value the two readings scale identically.
 * - **currency:** the cell's `formatCurrency` dropped the fraction of a whole
 *   amount (the objectui#4033 trimming) while the read-only face kept the ISO
 *   4217 minor-unit width (objectui#10276). Triage ruled the declared width is
 *   the protocol's convention and retired the trimming (objectui#11444,
 *   comment 5946462862), so both faces now read a whole USD `3456` as
 *   `$3,456.00`, and the face calls `formatCurrency` itself.
 *
 * The JPY rows are the controls for "declared width": JPY has no minor unit,
 * so a whole yen amount has no fraction on either face before or after. The
 * fix is the currency's own width, never "always two".
 *
 * ── Directions on the base tree (predicted before the first run) ──────────
 *   percent `de`, 0.25, `scale: 2` reads `25,00 %`        RED   (form `25.00%`)
 *   percent `en`, 0.25, `scale: 2` reads `25.00%`         GREEN (control)
 *   currency USD whole 3456 reads `$3,456.00` on both     RED   (cell `$3,456`)
 *   currency USD 3456.5 reads `$3,456.50` on both         GREEN (control)
 *   currency JPY whole 3456 reads `¥3,456` on both        GREEN (control)
 *   parity rows: RED wherever the locale, the grouping or a whole amount
 *   changes the text; GREEN for `en` percent rows below four digits, every
 *   fractional amount and every JPY row.
 *   Predicted count: 13 failed | 14 passed (27): the 2 named rows above,
 *   and 4 `en` plus 7 `de` parity rows.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { SchemaRenderer } from '@object-ui/react';
// Module scope: the form renderer's registration side effect.
import '@object-ui/components';
// Module scope, not a hook: the barrel runs `registerAllFields()` on import,
// and importing the widgets here pays their `React.lazy` chunk loads before any
// bounded `waitFor` window opens (AGENTS.md 测试纪律 / objectui#3010). These
// resolve to the same modules `fieldWidgetMap`'s loaders import.
import { PercentCellRenderer, CurrencyCellRenderer } from '../index';
import '../widgets/PercentField';
import '../widgets/CurrencyField';

afterEach(() => {
  cleanup();
});

type Declaration = Record<string, unknown>;
type Kind = 'percent' | 'currency';

/** The text a read-only field shows in a real form, read off the host's group. */
async function readonlyText(type: Kind, value: unknown, declaration: Declaration, locale: string): Promise<string> {
  const { container, unmount } = render(
    <LocalizationProvider value={{ locale }}>
      <SchemaRenderer
        schema={
          {
            type: 'form',
            showSubmit: false,
            showCancel: false,
            defaultValues: { amount: value },
            fields: [{ name: 'amount', label: 'Amount', type, readonly: true, ...declaration }],
          } as never
        }
      />
    </LocalizationProvider>,
  );
  // The form renderer wraps a read-only registered widget in this group, and
  // nothing else renders inside it, so its text is the widget's text.
  const selector = '[data-field="amount"] [data-slot="readonly-field-group"]';
  await waitFor(() => expect(container.querySelector(selector)?.textContent).toBeTruthy());
  const text = container.querySelector(selector)!.textContent ?? '';
  unmount();
  return text;
}

/** The text the table cell shows for the same field and value. */
function cellText(type: Kind, value: unknown, declaration: Declaration, locale: string): string {
  const Cell = type === 'percent' ? PercentCellRenderer : CurrencyCellRenderer;
  const { container, unmount } = render(
    <LocalizationProvider value={{ locale }}>
      <Cell value={value} field={{ name: 'amount', type, ...declaration } as never} />
    </LocalizationProvider>,
  );
  // The percent cell also draws a progress bar, which carries no text.
  const text = container.textContent ?? '';
  unmount();
  return text;
}

const fixed = (code: string): Declaration => ({
  currencyConfig: { currencyMode: 'fixed', defaultCurrency: code },
});

describe('read-only percent and currency faces render through the cell formatters (objectui#11444)', () => {
  describe('percent: the display locale reaches the read-only face', () => {
    it('`de`, `scale: 2`, a stored 0.25 reads `25,00 %` in the form and in the cell', async () => {
      const form = await readonlyText('percent', 0.25, { scale: 2 }, 'de');
      expect(form).toBe('25,00\u00a0%');
      expect(form).toBe(cellText('percent', 0.25, { scale: 2 }, 'de'));
    });

    it('`en`, `scale: 2`, a stored 0.25 reads `25.00%` in the form and in the cell (control)', async () => {
      const form = await readonlyText('percent', 0.25, { scale: 2 }, 'en');
      expect(form).toBe('25.00%');
      expect(form).toBe(cellText('percent', 0.25, { scale: 2 }, 'en'));
    });
  });

  describe('currency: the declared width, ISO 4217 minor units, on both faces', () => {
    it('a whole USD 3456 reads `$3,456.00` in the form and in the cell', async () => {
      const form = await readonlyText('currency', 3456, fixed('USD'), 'en');
      expect(form).toBe('$3,456.00');
      expect(cellText('currency', 3456, fixed('USD'), 'en')).toBe('$3,456.00');
    });

    it('a fractional USD 3456.5 reads `$3,456.50` in the form and in the cell (control)', async () => {
      const form = await readonlyText('currency', 3456.5, fixed('USD'), 'en');
      expect(form).toBe('$3,456.50');
      expect(cellText('currency', 3456.5, fixed('USD'), 'en')).toBe('$3,456.50');
    });

    it('a whole JPY 3456 reads `¥3,456`, no fraction, in the form and in the cell (control: zero minor units)', async () => {
      const form = await readonlyText('currency', 3456, fixed('JPY'), 'en');
      expect(form).toBe('¥3,456');
      expect(cellText('currency', 3456, fixed('JPY'), 'en')).toBe('¥3,456');
    });
  });

  // Parity: the read-only text EQUALS the cell's text, so the pin keeps no
  // second table of literals that could drift from the cell. Each row is one
  // input the formatting reads: the width, the grouping, the storage
  // convention a declared `max > 1` selects, the currency's minor-unit count
  // (2, 0, 3) and a field with no currency resolved at all.
  const PERCENT_ROWS: Array<[string, number, Declaration]> = [
    ['fraction, `scale: 2`', 0.1234, { scale: 2 }],
    ['fraction, no `scale` (the protocol width)', 0.25, {}],
    ['whole (`max: 100`), `scale: 1`', 12.5, { max: 100, scale: 1 }],
    ['whole (`max: 10000`), four digits, `scale: 1`', 1234.5, { max: 10000, scale: 1 }],
  ];
  const CURRENCY_ROWS: Array<[string, number, Declaration]> = [
    ['USD whole', 3456, fixed('USD')],
    ['USD fractional', 3456.5, fixed('USD')],
    ['JPY whole', 3456, fixed('JPY')],
    ['JPY fractional', 3456.5, fixed('JPY')],
    ['KWD whole (three minor units)', 3456, fixed('KWD')],
    ['no currency resolved, whole', 3456, {}],
    ['no currency resolved, fractional', 3456.5, {}],
  ];

  for (const locale of ['en', 'de']) {
    for (const [label, value, declaration] of PERCENT_ROWS) {
      it(`percent, ${label}, in ${locale}: the read-only form reads what the table cell reads`, async () => {
        expect(await readonlyText('percent', value, declaration, locale)).toBe(
          cellText('percent', value, declaration, locale),
        );
      });
    }
    for (const [label, value, declaration] of CURRENCY_ROWS) {
      it(`currency, ${label}, in ${locale}: the read-only form reads what the table cell reads`, async () => {
        expect(await readonlyText('currency', value, declaration, locale)).toBe(
          cellText('currency', value, declaration, locale),
        );
      });
    }
  }
});
