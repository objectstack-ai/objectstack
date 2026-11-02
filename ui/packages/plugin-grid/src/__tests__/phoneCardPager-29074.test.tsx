/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29074 — the phone card list turns pages.
 *
 * Under server pagination the grid holds one page of the match set. The table
 * has a pager for the rest; the phone's card list had none, so a 403-record
 * list showed its first 50 and nothing reached the others. The card list now
 * ends in a pager that turns the same page the table's does, with the table's
 * words, at 44 px.
 *
 * The control: a match set that fits one page draws no pager.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';

beforeAll(() => {
  registerAllFields();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });
}

afterEach(() => {
  cleanup();
  setWidth(ORIGINAL_INNER_WIDTH);
});

const OBJECT = 'crm_account_29074';
const FIELDS = { id: { type: 'text' }, name: { type: 'text', label: 'Name' } };
const PAGE_SIZE = 5;

/** A match set of `total` accounts, served one page at a time. */
function renderGrid(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({ id: `a${i + 1}`, name: `Account ${i + 1}` }));
  const find = vi.fn(async (_object: string, params: { $skip?: number; $top?: number; skip?: number; top?: number }) => {
    const skip = Number(params?.$skip ?? params?.skip ?? 0);
    const top = Number(params?.$top ?? params?.top ?? PAGE_SIZE);
    return { data: all.slice(skip, skip + top), total, hasMore: skip + top < total, pageSize: top };
  });
  const dataSource = {
    find,
    getObjectSchema: async (name: string) => ({ name, nameField: 'name', fields: structuredClone(FIELDS) }),
  } as never;
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: OBJECT,
            columns: [{ field: 'name' }],
            pagination: { pageSize: PAGE_SIZE },
          } as never}
          dataSource={dataSource}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  return find;
}

const titles = () =>
  [...document.querySelectorAll('[data-testid="grid-card-title"]')].map((el) => el.textContent);

describe('the phone card list pager (objectstack#29074)', () => {
  it('a match set past one page ends the card list in a pager that turns to the next page', async () => {
    setWidth(390);
    renderGrid(12);
    await waitFor(() => expect(titles()[0]).toBe('Account 1'));
    expect(titles()).toHaveLength(PAGE_SIZE);

    const pager = screen.getByTestId('object-grid-card-pager');
    // At the end of the card list, inside the scroller.
    expect(screen.getByTestId('object-grid-card-scroller')).toContainElement(pager);
    expect(within(pager).getByTestId('object-grid-card-page-info')).toHaveTextContent('Page 1 of 3');
    expect(within(pager).getByRole('button', { name: 'Previous page' })).toBeDisabled();
    for (const button of within(pager).getAllByRole('button')) {
      expect(button.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-11', 'w-11']));
    }

    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(titles()[0]).toBe('Account 6'));
    expect(screen.getByTestId('object-grid-card-page-info')).toHaveTextContent('Page 2 of 3');

    fireEvent.click(within(screen.getByTestId('object-grid-card-pager')).getByRole('button', { name: 'Last page' }));
    await waitFor(() => expect(titles()).toEqual(['Account 11', 'Account 12']));
    expect(within(screen.getByTestId('object-grid-card-pager')).getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('control: a match set that fits one page draws no pager', async () => {
    setWidth(390);
    renderGrid(3);
    await waitFor(() => expect(titles()).toHaveLength(3));
    expect(screen.queryByTestId('object-grid-card-pager')).toBeNull();
  });
});
