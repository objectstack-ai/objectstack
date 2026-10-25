/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10783 — a `currency` grid column's width is its currency's ISO 4217
 * minor unit, and a `scale` on the column decides nothing.
 *
 * `currencyWidth` used to read the column's `scale` first, so an authored
 * `scale` beat the minor unit on both faces: the value a computed amount is
 * stored at, and the places the cell shows. `@objectstack/spec` 17.5.0 refuses
 * `scale` on an inline grid column that declares `type: 'currency'`, with the
 * remedy that the minor unit decides (ruling B on
 * objectstack-ai/objectstack#19629, ruling 乙 on
 * objectstack-ai/objectstack#19910).
 *
 * Each row below authors a `scale` that disagrees with the currency's minor
 * unit, so the minor unit and the old `scale`-first read give different
 * answers: JPY (0 places) under `scale: 2`, USD (2) under `scale: 0`, and KWD
 * (3) under `scale: 2`. The `number` rows are the control: `scale` on a
 * `number` column is unchanged.
 *
 * The column that declares no `type` and takes `currency` from its child field
 * is pinned where that happens: `deriveMasterDetail.currencyScale-10783.test.ts`
 * in `@object-ui/plugin-form`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { LocalizationProvider } from '@object-ui/i18n';
import { GridField, computeRow, type GridColumn } from './GridField';

afterEach(() => cleanup());

/** `Intl` separates a code from its amount with a no-break space. */
const flat = (s: string | null | undefined): string => (s ?? '').replace(/\u00a0/g, ' ').trim();

/** The master-detail line `amount = quantity * unit_price`, carrying a `scale`. */
const amountColumn = (extra: Partial<GridColumn>): GridColumn => ({
  name: 'amount',
  label: 'Amount',
  type: 'currency',
  computed: true,
  expr: 'record.quantity * record.unit_price',
  ...extra,
});

/**
 * currency · authored scale · inputs · stored at the minor unit · what the old
 * `scale`-first read stored.
 */
const rows = [
  { currency: 'JPY', scale: 2, inputs: { quantity: 3, unit_price: 411.523 }, stored: 1235, scaleFirst: 1234.57 },
  { currency: 'USD', scale: 0, inputs: { quantity: 3, unit_price: 411.523 }, stored: 1234.57, scaleFirst: 1235 },
  { currency: 'KWD', scale: 2, inputs: { quantity: 3, unit_price: 1.2345 }, stored: 3.704, scaleFirst: 3.7 },
] as const;

describe('a currency column is stored at its currency minor unit, whatever its `scale` (objectui#10783)', () => {
  for (const r of rows) {
    it(`${r.currency}: \`scale: ${r.scale}\` does not decide the stored width`, () => {
      const next = computeRow([amountColumn({ scale: r.scale })], { ...r.inputs }, r.currency);
      expect(next.amount).toBe(r.stored);
      expect(next.amount).not.toBe(r.scaleFirst);
    });
  }

  it('number control: a `scale` on a `number` column still decides its stored width', () => {
    const next = computeRow([amountColumn({ type: 'number', scale: 2 })], { quantity: 3, unit_price: 411.523 }, 'JPY');
    expect(next.amount).toBe(1234.57);
  });
});

/**
 * currency · authored scale · the stored amount · shown at the minor unit ·
 * what the old `scale`-first read showed.
 */
const shown = [
  { currency: 'JPY', scale: 2, amount: 1234.57, text: '¥1,235', scaleFirst: '¥1,234.57' },
  { currency: 'USD', scale: 0, amount: 1234.57, text: '$1,234.57', scaleFirst: '$1,235' },
  { currency: 'KWD', scale: 2, amount: 3.704, text: 'KWD 3.704', scaleFirst: 'KWD 3.70' },
] as const;

describe('a currency cell shows its currency minor unit, whatever the column `scale` (objectui#10783)', () => {
  for (const s of shown) {
    it(`${s.currency}: \`scale: ${s.scale}\` does not decide the shown width`, () => {
      render(
        <LocalizationProvider value={{ currency: s.currency, locale: 'en' }}>
          <GridField
            value={[{ amount: s.amount }]}
            onChange={() => {}}
            field={{ columns: [amountColumn({ scale: s.scale })] } as never}
          />
        </LocalizationProvider>,
      );
      const text = flat(document.querySelector('[data-computed="amount"]')?.textContent);
      expect(text).toBe(s.text);
      expect(text).not.toBe(s.scaleFirst);
    });
  }
});
