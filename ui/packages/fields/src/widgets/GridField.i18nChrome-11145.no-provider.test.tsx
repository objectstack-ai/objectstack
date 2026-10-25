/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * With no `I18nProvider` mounted, the grid chrome objectui#11145 moved onto
 * pack keys is English: the footer `Total`, the chooser's `Columns` /
 * `Optional columns`, the computed cell's `Computed`, and the row actions.
 *
 * Each row action reads one label as both its `aria-label` and its `title`.
 * The accessible names are unchanged; two tooltips changed to match them
 * (`Open full form` is now `Open row`, `Duplicate line` is now `Duplicate
 * row`).
 *
 * This is the provider-less path, served by the grid's inline defaults. The
 * zh half is `GridField.i18nChrome-11145.test.tsx`.
 *
 * Its own FILE on purpose: `createI18n` registers its instance as
 * react-i18next's module-global default, and that registration outlives
 * `cleanup()`, so one provider mount earlier in a file would answer every
 * later "no provider" render in it. Do not import or mount `I18nProvider`
 * here.
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { GridField } from './GridField';

const columns = [
  { name: 'qty', label: 'Qty', type: 'number' as const },
  { name: 'price', label: 'Price', type: 'number' as const },
  { name: 'amount', label: 'Amount', type: 'number' as const, computed: true, expr: 'record.qty * record.price' },
  { name: 'notes', label: 'Notes', type: 'text' as const, defaultHidden: true },
];

describe('GridField chrome with no i18n provider (objectui#11145)', () => {
  it('renders English, one label per row action as both aria-label and title', () => {
    const { container } = render(
      <GridField
        value={[{ qty: 2, price: 5, amount: 10 }]}
        onChange={() => {}}
        field={{ columns, totalField: 'amount' } as never}
        onRowExpand={() => {}}
      />,
    );

    const both = (id: string) => {
      const el = screen.getByTestId(id);
      return [el.getAttribute('aria-label'), el.getAttribute('title')];
    };
    expect(both('line-items-drag-0')).toEqual(['Drag to reorder', 'Drag to reorder']);
    expect(both('line-items-expand-0')).toEqual(['Open row', 'Open row']);
    expect(both('line-items-duplicate-0')).toEqual(['Duplicate row', 'Duplicate row']);
    expect(screen.getByTestId('line-items-remove-0').getAttribute('aria-label')).toBe('Remove row');

    expect(screen.getByTestId('line-items-total').closest('tr')?.textContent).toContain('Total');
    expect(container.querySelector('[data-computed="amount"]')?.getAttribute('title')).toBe('Computed');

    const chooser = screen.getByTestId('line-items-columns');
    expect(chooser.textContent).toBe('Columns');
    fireEvent.click(chooser);
    expect(screen.getByText('Optional columns')).toBeInTheDocument();
  });
});
