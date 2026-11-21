/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35883 — the ways into a selection on a phone's card list.
 *
 * - A long press (500 ms, held still) on a card starts the selection with that
 *   card ticked; the click that ends the press opens nothing.
 * - While selecting, a tap ticks or unticks a card; unticking the last one
 *   ends the selection.
 * - The page's 「Select」 (`requestListSelection` on the page column) starts
 *   the selection with nothing ticked.
 *
 * Pinned at 390 px, the card layout (see `phoneCardRow-28484.test.tsx`).
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { requestListSelection } from '../listPageBarSlot';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';

beforeAll(() => {
  registerAllFields();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
});

const ROWS = [
  { id: 'a1', name: 'Acme' },
  { id: 'a2', name: 'Globex' },
];

function renderCards(selection: unknown = { type: 'multiple' }) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
  const onRowClick = vi.fn();
  const onRowSelect = vi.fn();
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      nameField: 'name',
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    }),
  } as never;
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <div data-testid="page-column">
          <ObjectGrid
            schema={{
              type: 'object-grid',
              objectName: 'account_35883',
              columns: [{ field: 'name' }],
              selection,
              pagination: { pageSize: 50 },
            } as never}
            dataSource={dataSource}
            onRowClick={onRowClick}
            onRowSelect={onRowSelect}
          />
        </div>
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  return { onRowClick, onRowSelect };
}

const cardOf = async (title: string) => {
  await waitFor(() => expect(screen.getAllByTestId('grid-mobile-card').length).toBe(2));
  return screen.getAllByTestId('grid-mobile-card').find((c) => c.textContent?.includes(title))!;
};

const hold = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe('card list selection on a phone (objectstack#35883)', () => {
  it('a long press ticks the card and opens nothing; a tap then ticks another, unticking the last ends it', async () => {
    const { onRowClick, onRowSelect } = renderCards();
    const acme = await cardOf('Acme');
    fireEvent.pointerDown(acme, { clientX: 10, clientY: 10 });
    await hold(600);
    fireEvent.pointerUp(acme);
    fireEvent.click(acme);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(acme).toHaveAttribute('aria-selected', 'true');
    expect(onRowSelect).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })]);

    const globex = await cardOf('Globex');
    expect(globex).toHaveAttribute('aria-selected', 'false');
    expect(within(globex).getByTestId('grid-card-check')).toBeInTheDocument();
    fireEvent.click(globex);
    expect(onRowSelect).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'a1' }),
      expect.objectContaining({ id: 'a2' }),
    ]);

    fireEvent.click(globex);
    fireEvent.click(await cardOf('Acme'));
    expect(onRowSelect).toHaveBeenLastCalledWith([]);
    expect(screen.queryAllByTestId('grid-card-check')).toHaveLength(0);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('a press that moves (a scroll) starts nothing; a plain tap opens the record', async () => {
    const { onRowClick } = renderCards();
    const acme = await cardOf('Acme');
    fireEvent.pointerDown(acme, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(acme, { clientX: 10, clientY: 40 });
    await hold(600);
    expect(screen.queryAllByTestId('grid-card-check')).toHaveLength(0);
    fireEvent.click(acme);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('the page\'s 「Select」 starts a selection with nothing ticked', async () => {
    renderCards();
    await cardOf('Acme');
    act(() => requestListSelection(screen.getByTestId('page-column')));
    await waitFor(() => expect(screen.getAllByTestId('grid-card-check')).toHaveLength(2));
    for (const card of screen.getAllByTestId('grid-mobile-card')) {
      expect(card).toHaveAttribute('aria-selected', 'false');
    }
  });

  it('a list without selection: no long press, no 「Select」', async () => {
    const { onRowClick } = renderCards({ type: 'none' });
    const acme = await cardOf('Acme');
    fireEvent.pointerDown(acme, { clientX: 10, clientY: 10 });
    await hold(600);
    act(() => requestListSelection(screen.getByTestId('page-column')));
    expect(screen.queryAllByTestId('grid-card-check')).toHaveLength(0);
    fireEvent.click(acme);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
