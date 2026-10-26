/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The rest of the line-items grid's chrome speaks the session locale
 * (objectui#11145).
 *
 * objectui#11131 moved the grid's Add button and its two empty states onto the
 * packs. The rest stayed English under a `zh` session: the footer `Total`, the
 * column chooser's `Columns` button and `Optional columns` heading, the
 * computed cell's `Computed` tooltip, and the row actions.
 *
 * The row actions also disagreed with themselves: two of them carried one
 * text as their `aria-label` and another as their `title` (`Open row` / `Open
 * full form`, `Duplicate row` / `Duplicate line`). Each meaning now has ONE
 * key, read by both attributes, and its English is the accessible name it
 * already had. One pin per meaning checks the two attributes agree, in zh and
 * in en.
 *
 * Reused keys: `table.columns` (the chooser button), `form.masterDetail.total`
 * (the footer, the word the master-detail totals stack uses for the same
 * figure) and `view.dragToReorder` (the drag handle).
 *
 * The provider-less English is the `.no-provider` companion of this file.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { GridField } from './GridField';

afterEach(() => cleanup());

const columns = [
  { name: 'qty', label: 'Qty', type: 'number' as const },
  { name: 'price', label: 'Price', type: 'number' as const },
  { name: 'amount', label: 'Amount', type: 'number' as const, computed: true, expr: 'record.qty * record.price' },
  { name: 'notes', label: 'Notes', type: 'text' as const, defaultHidden: true },
];
const rows = [{ qty: 2, price: 5, amount: 10 }];

function inLanguage(language: 'zh' | 'en', node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{node}</I18nProvider>,
  );
}

const editableGrid = (language: 'zh' | 'en') =>
  inLanguage(
    language,
    <GridField
      value={rows}
      onChange={() => {}}
      field={{ columns, totalField: 'amount' } as never}
      onRowExpand={() => {}}
    />,
  );

/** The row action's two attributes, which must name one meaning. */
const labelAndTitle = (el: Element) => [el.getAttribute('aria-label'), el.getAttribute('title')];

describe('GridField chrome resolves through the i18n catalogue (objectui#11145)', () => {
  it('zh: each row action reads one zh label, as both its aria-label and its title', async () => {
    editableGrid('zh');

    // Queried by test id, then read: the pin is that the two attributes agree.
    // `waitFor`: the zh catalogue loads after the first render.
    await waitFor(() =>
      expect(labelAndTitle(screen.getByTestId('line-items-drag-0'))).toEqual(['拖动排序', '拖动排序']),
    );
    expect(labelAndTitle(screen.getByTestId('line-items-expand-0'))).toEqual(['打开行', '打开行']);
    expect(labelAndTitle(screen.getByTestId('line-items-duplicate-0'))).toEqual(['复制行', '复制行']);
    // Remove has an accessible name and no tooltip, as before.
    expect(screen.getByTestId('line-items-remove-0').getAttribute('aria-label')).toBe('删除行');
    // And they are what assistive tech is told.
    expect(screen.getByRole('button', { name: '打开行' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制行' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除行' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /row|line/i })).toBeNull();
  });

  it('en: each row action reads one English label, as both its aria-label and its title', async () => {
    editableGrid('en');

    await waitFor(() =>
      expect(labelAndTitle(screen.getByTestId('line-items-drag-0'))).toEqual(['Drag to reorder', 'Drag to reorder']),
    );
    expect(labelAndTitle(screen.getByTestId('line-items-expand-0'))).toEqual(['Open row', 'Open row']);
    expect(labelAndTitle(screen.getByTestId('line-items-duplicate-0'))).toEqual(['Duplicate row', 'Duplicate row']);
    expect(screen.getByTestId('line-items-remove-0').getAttribute('aria-label')).toBe('Remove row');
  });

  it('zh: the footer reads 合计, the computed cell 自动计算, and the column chooser 列 / 可选列', async () => {
    const { container } = editableGrid('zh');

    const total = await screen.findByTestId('line-items-total');
    await waitFor(() => expect(total.closest('tr')?.textContent).toContain('合计'));
    expect(container.querySelector('[data-computed="amount"]')?.getAttribute('title')).toBe('自动计算');

    const chooser = screen.getByTestId('line-items-columns');
    expect(chooser.textContent).toBe('列');
    fireEvent.click(chooser);
    const heading = await screen.findByText('可选列');
    expect(within(heading.parentElement as HTMLElement).getByLabelText('Notes')).toBeInTheDocument();

    for (const english of ['Total', 'Columns', 'Optional columns']) {
      expect(document.body.textContent).not.toContain(english);
    }
  });

  it('zh: the read-only grid\'s footer reads 合计 too', async () => {
    inLanguage(
      'zh',
      <GridField value={rows} onChange={() => {}} field={{ columns, totalField: 'amount' } as never} readonly />,
    );

    const table = await screen.findByTestId('line-items-readonly');
    expect(await within(table).findByText('合计')).toBeInTheDocument();
    expect(table.textContent).not.toContain('Total');
  });
});
