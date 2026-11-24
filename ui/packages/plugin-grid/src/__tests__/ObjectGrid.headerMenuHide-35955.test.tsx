/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35955 — through the real `ObjectGrid` and its `data-table`, the
 * column menu's "Hide column" reaches the host that keeps the columns shown
 * (`onColumnHide`, with the column's field), so the list page can hold it in
 * the list's draft the way the hide-fields eye does. Before, the table only
 * dropped the column from its own state: the column went, nothing above the
 * table heard of it, and the list drew neither Discard nor Save.
 *
 * The CONTROL: with no `onColumnHide` the column still goes, so the hide is
 * the table's own, as before.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

function makeDataSource() {
  return {
    find: vi.fn(async () => ({
      data: [{ id: '1', name: 'Row 0', stage: 'open', amount: 10 }],
      total: 1,
    })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        stage: { type: 'text', label: 'Stage' },
        amount: { type: 'number', label: 'Amount' },
      },
    }),
  } as any;
}

const headers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('thead th[data-column-key]')).map((th) =>
    th.getAttribute('data-column-key'),
  );

function mount(onColumnHide?: (field: string) => void) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: 'crm_deal',
          columns: ['name', 'stage', 'amount'].map((field) => ({ field })),
        } as any}
        dataSource={makeDataSource()}
        headerMenu
        {...(onColumnHide ? { onColumnHide } : {})}
      />
    </ActionProvider>,
  );
}

async function hideFromHeaderMenu(container: HTMLElement, field: string) {
  const th = container.querySelector<HTMLElement>(`thead th[data-column-key="${field}"]`)!;
  fireEvent.click(th);
  fireEvent.click(within(screen.getByTestId('column-context-menu')).getByText('Hide column'));
}

describe('ObjectGrid — the column menu\'s Hide column reaches the host (objectstack#35955)', () => {
  it('hands the host the hidden column\'s field, once, and the column goes', async () => {
    const onColumnHide = vi.fn();
    const { container } = mount(onColumnHide);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    expect(headers(container)).toEqual(expect.arrayContaining(['name', 'stage', 'amount']));

    await hideFromHeaderMenu(container, 'stage');

    expect(onColumnHide).toHaveBeenCalledTimes(1);
    expect(onColumnHide).toHaveBeenCalledWith('stage');
    await waitFor(() => expect(headers(container)).not.toContain('stage'));
  });

  it('CONTROL: with no host handler the column still goes, in the table alone', async () => {
    const { container } = mount();
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    await hideFromHeaderMenu(container, 'stage');
    await waitFor(() => expect(headers(container)).not.toContain('stage'));
    expect(headers(container)).toEqual(expect.arrayContaining(['name', 'amount']));
  });
});
