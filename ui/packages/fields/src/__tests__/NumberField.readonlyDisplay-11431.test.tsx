/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11431 — a read-only `NumberField` shows the text its table cell
 * shows, because both faces make ONE formatting call.
 *
 * The read-only branch printed the raw stored value: a field declaring
 * `scale: 2` and holding `1234.5` read `1234.5` in a read-only form, exactly
 * as with no `scale`, while `NumberCellRenderer` read the same field
 * `1,234.50`. No width, no grouping, no display locale. The cell's three
 * inputs are the width `resolveFieldScale` answers (ruling A′,
 * objectstack-ai/objectstack#19628), the field's grouping policy
 * (`useGrouping` over the `scale` heuristic, objectui#4033 / objectui#11026)
 * and `useDisplayLocale()`. Both faces now hand those to
 * `formatNumberFieldValue`, so the parity block below asserts EQUALITY with the
 * cell instead of keeping a second table of literals that could drift from it.
 *
 * Driven through the real `SchemaRenderer`, the real form renderer and the
 * real `@object-ui/fields` registration: the path objectui#11413's
 * measurement took when it found this.
 *
 * ── Directions on the base tree (predicted before the first run) ──────────
 *   `scale: 2`, 1234.5 reads `1,234.50`           RED   (`1234.5`)
 *   no `scale`, 3.14159 reads `3.14159`            GREEN (control: no width either way)
 *   parity with the cell, per declaration/locale   RED wherever width, grouping
 *                                                  or locale changes the text
 *   no stored value reads the placeholder          GREEN (unchanged)
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { SchemaRenderer } from '@object-ui/react';
// Module scope: the form renderer's registration side effect.
import '@object-ui/components';
// Module scope, not a hook: the barrel runs `registerAllFields()` on import,
// and importing the widget here pays the `React.lazy` chunk load before any
// bounded `waitFor` window opens (AGENTS.md 测试纪律 / objectui#3010). This
// resolves to the same module `fieldWidgetMap`'s `number` loader imports.
import { NumberCellRenderer } from '../index';
import '../widgets/NumberField';

afterEach(() => {
  cleanup();
});

type Declaration = Record<string, unknown>;

/** The text a read-only number field shows in a real form, read off the host's group. */
async function readonlyText(value: unknown, declaration: Declaration = {}, locale = 'en'): Promise<string> {
  const { container, unmount } = render(
    <LocalizationProvider value={{ locale }}>
      <SchemaRenderer
        schema={
          {
            type: 'form',
            showSubmit: false,
            showCancel: false,
            defaultValues: { amount: value },
            fields: [{ name: 'amount', label: 'Amount', type: 'number', readonly: true, ...declaration }],
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
function cellText(value: unknown, declaration: Declaration = {}, locale = 'en'): string {
  const { container, unmount } = render(
    <LocalizationProvider value={{ locale }}>
      <NumberCellRenderer value={value} field={{ name: 'amount', type: 'number', ...declaration } as never} />
    </LocalizationProvider>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

describe('a read-only NumberField renders through the cell formatter (objectui#11431)', () => {
  it('a field declaring `scale: 2` shows a stored 1234.5 as 1,234.50', async () => {
    expect(await readonlyText(1234.5, { scale: 2 })).toBe('1,234.50');
  });

  it('a field with no `scale` shows the natural precision, with no width imposed (control)', async () => {
    expect(await readonlyText(3.14159)).toBe('3.14159');
  });

  it('no stored value still shows the placeholder, never a fabricated 0', async () => {
    const { container } = render(
      <SchemaRenderer
        schema={
          {
            type: 'form',
            showSubmit: false,
            showCancel: false,
            defaultValues: { amount: null },
            fields: [{ name: 'amount', label: 'Amount', type: 'number', readonly: true, scale: 2 }],
          } as never
        }
      />,
    );
    const selector = '[data-field="amount"] [data-slot="readonly-field-group"]';
    await waitFor(() => expect(container.querySelector(selector)?.textContent).toBeTruthy());
    const group = container.querySelector(selector)!;
    expect(group.querySelector('[data-slot="empty-value"]')).not.toBeNull();
    expect(group.textContent).not.toMatch(/\d/);
  });

  // Each row is one declaration the cell's inputs read: the width, the
  // ordinal policy a declared `scale: 0` triggers, and an authored
  // `useGrouping` overriding that policy in either direction. Run in two
  // locales, so the display locale is an input too.
  const ROWS: Array<[string, number, Declaration]> = [
    ['`scale: 2`', 1234.5, { scale: 2 }],
    ['no `scale`', 1234.5, {}],
    ['`scale: 0` (an ordinal: ungrouped)', 2026, { scale: 0 }],
    ['`scale: 0` with `useGrouping: true`', 2026, { scale: 0, useGrouping: true }],
    ['`useGrouping: false`', 12345.5, { useGrouping: false }],
  ];

  for (const locale of ['en', 'de']) {
    for (const [label, value, declaration] of ROWS) {
      it(`${label} in ${locale}: the read-only form reads what the table cell reads`, async () => {
        expect(await readonlyText(value, declaration, locale)).toBe(cellText(value, declaration, locale));
      });
    }
  }
});
