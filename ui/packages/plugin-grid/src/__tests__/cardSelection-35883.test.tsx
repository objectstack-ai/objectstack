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
 * - The page offers 「Select」 only where it would open a selection
 *   (`useListPageSelectable`): cards whose rows take more than one tick.
 *
 * Pinned at 390 px, the card layout (see `phoneCardRow-28484.test.tsx`).
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { requestListSelection, useListPageSelectable } from '../listPageScope';
import {
  ActionProvider,
  RelatedRecordActionsProvider,
  SchemaRendererProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
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
    expect(acme).toHaveAttribute('aria-pressed', 'true');
    expect(onRowSelect).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })]);

    const globex = await cardOf('Globex');
    expect(globex).toHaveAttribute('aria-pressed', 'false');
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

  it('a long press the browser ends with no click does not swallow the next tap', async () => {
    const { onRowSelect } = renderCards();
    const acme = await cardOf('Acme');
    fireEvent.pointerDown(acme, { clientX: 10, clientY: 10 });
    await hold(600);
    fireEvent.pointerUp(acme);
    // No click follows the press (Android after its context menu, a finger that slid off).
    expect(acme).toHaveAttribute('aria-pressed', 'true');

    const globex = await cardOf('Globex');
    fireEvent.pointerDown(globex, { clientX: 10, clientY: 60 });
    fireEvent.pointerUp(globex);
    fireEvent.click(globex);
    expect(globex, 'one tap ticks it').toHaveAttribute('aria-pressed', 'true');
    expect(onRowSelect).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'a1' }),
      expect.objectContaining({ id: 'a2' }),
    ]);
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
      expect(card).toHaveAttribute('aria-pressed', 'false');
    }
    // The selection bar (objectstack#35678) shows 「0 selected」 and its 「×」,
    // with no action to run on nothing; 「×」 ends the selection.
    const bar = screen.getByTestId('bulk-actions-bar');
    expect(within(bar).getByTestId('bulk-selection-count')).toHaveTextContent('0');
    expect(within(bar).queryAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual(['bulk-selection-clear']);
    fireEvent.click(within(bar).getByTestId('bulk-selection-clear'));
    expect(screen.queryAllByTestId('grid-card-check')).toHaveLength(0);
    expect(screen.queryByTestId('bulk-actions-bar')).toBeNull();
  });

  it('a long press shows the selection bar at the bottom of the cards with 「1 selected」', async () => {
    renderCards();
    const acme = await cardOf('Acme');
    fireEvent.pointerDown(acme, { clientX: 10, clientY: 10 });
    await hold(600);
    fireEvent.pointerUp(acme);
    const anchor = screen.getByTestId('floating-selection-bar');
    expect(within(anchor).getByTestId('bulk-selection-count')).toHaveTextContent('1');
    expect(screen.getByTestId('object-grid-card-scroller').nextElementSibling).toBe(anchor);
  });

  it('a keyboard reaches the card: Enter opens it, and while selecting Space toggles it', async () => {
    const { onRowClick, onRowSelect } = renderCards();
    const acme = await cardOf('Acme');
    expect(acme).toHaveAttribute('role', 'button');
    expect(acme).toHaveAttribute('tabIndex', '0');
    fireEvent.keyDown(acme, { key: 'Enter' });
    expect(onRowClick).toHaveBeenCalledTimes(1);
    act(() => requestListSelection(screen.getByTestId('page-column')));
    await waitFor(() => expect(screen.getAllByTestId('grid-card-check')).toHaveLength(2));
    fireEvent.keyDown(await cardOf('Acme'), { key: ' ' });
    expect(onRowSelect).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })]);
    expect(onRowClick).toHaveBeenCalledTimes(1);
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

  it('the page offers 「Select」 only on cards whose rows take more than one tick', async () => {
    for (const [selection, offered] of [
      [{ type: 'multiple' }, true],
      [{ type: 'single' }, false],
      [{ type: 'none' }, false],
    ] as const) {
      renderCards(selection);
      await cardOf('Acme');
      const scope = screen.getByTestId('page-column');
      const { getByTestId } = render(<SelectableProbe scope={scope} />);
      expect(getByTestId('selectable-probe').dataset.selectable, `selection ${selection.type}`).toBe(String(offered));
      cleanup();
    }
  });
});

/**
 * objectstack#36044 — while a selection is open, every tap on a card ticks or
 * unticks it, a tap on a link the card draws included: the email, the
 * referenced record's chip and the row's 「⋮」 open nothing. When the selection
 * ends, the same taps open again.
 */
describe('a tap on a link inside a card while selecting ticks the card (objectstack#36044)', () => {
  const LINKED_ROWS = [
    { id: 'a1', name: 'Acme', email: 'ada@acme.test', owner: { id: 'u9', name: 'Grace' } },
    { id: 'a2', name: 'Globex', email: 'hank@globex.test', owner: { id: 'u8', name: 'Linus' } },
  ];
  const opened: Array<[string, string | number]> = [];
  const host: RelatedRecordActionsValue = {
    resolve: () => ({}),
    recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}`,
    openRecord: (objectName, recordId) => { opened.push([objectName, recordId]); },
  };

  function renderLinkedCards(width = 390) {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
    opened.length = 0;
    const onRowClick = vi.fn();
    const onRowSelect = vi.fn();
    const dataSource = {
      find: vi.fn(async () => ({ data: LINKED_ROWS, total: LINKED_ROWS.length, hasMore: false, pageSize: 50 })),
      getObjectSchema: async (name: string) => ({
        name,
        nameField: 'name',
        fields: {
          id: { type: 'text' },
          name: { type: 'text', label: 'Name' },
          email: { type: 'email', label: 'Email' },
          owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
        },
      }),
    } as never;
    render(
      <ActionProvider>
        <RelatedRecordActionsProvider value={host}>
          <SchemaRendererProvider dataSource={dataSource}>
            <div data-testid="page-column">
              <ObjectGrid
                schema={{
                  type: 'object-grid',
                  objectName: 'account_36044',
                  columns: [{ field: 'name' }, { field: 'email' }, { field: 'owner' }],
                  selection: { type: 'multiple' },
                  pagination: { pageSize: 50 },
                } as never}
                dataSource={dataSource}
                onRowClick={onRowClick}
                onRowSelect={onRowSelect}
                // An edit makes the card draw the row's 「⋮」 (objectstack#29150).
                onEdit={vi.fn()}
              />
            </div>
          </SchemaRendererProvider>
        </RelatedRecordActionsProvider>
      </ActionProvider>,
    );
    return { onRowClick, onRowSelect };
  }

  const mailOf = async (address: string) => {
    await waitFor(() => expect(document.querySelector(`a[href="mailto:${address}"]`)).not.toBeNull());
    return document.querySelector<HTMLElement>(`a[href="mailto:${address}"]`)!;
  };
  const chipOf = async (id: string) => {
    await waitFor(() => expect(document.querySelector(`a[href="/apps/demo/sys_user/record/${id}"]`)).not.toBeNull());
    return document.querySelector<HTMLElement>(`a[href="/apps/demo/sys_user/record/${id}"]`)!;
  };
  const startSelecting = async () => {
    act(() => requestListSelection(screen.getByTestId('page-column')));
    await waitFor(() => expect(screen.getAllByTestId('grid-card-check')).toHaveLength(2));
  };
  const endSelecting = () => {
    fireEvent.click(within(screen.getByTestId('bulk-actions-bar')).getByTestId('bulk-selection-clear'));
    expect(screen.queryAllByTestId('grid-card-check')).toHaveLength(0);
  };

  it('a tap on the email ticks the card and opens nothing; after 「×」 the same tap opens the link', async () => {
    const { onRowClick, onRowSelect } = renderLinkedCards();
    await mailOf('ada@acme.test');
    await startSelecting();
    // `fireEvent` answers false when the click's default (following the
    // mailto) was cancelled.
    expect(fireEvent.click(await mailOf('ada@acme.test')), 'the link does not open').toBe(false);
    expect(await cardOf('Acme')).toHaveAttribute('aria-pressed', 'true');
    expect(onRowSelect).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })]);
    expect(fireEvent.click(await mailOf('hank@globex.test'))).toBe(false);
    expect(await cardOf('Globex')).toHaveAttribute('aria-pressed', 'true');
    // A second tap on the same link unticks its card.
    expect(fireEvent.click(await mailOf('hank@globex.test'))).toBe(false);
    expect(await cardOf('Globex')).toHaveAttribute('aria-pressed', 'false');
    expect(onRowClick).not.toHaveBeenCalled();

    endSelecting();
    const ticks = onRowSelect.mock.calls.length;
    expect(fireEvent.click(await mailOf('ada@acme.test')), 'the link opens again').toBe(true);
    expect(onRowSelect).toHaveBeenCalledTimes(ticks);
    expect(screen.queryAllByTestId('grid-card-check')).toHaveLength(0);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('a tap on the referenced record\'s chip ticks the card and opens no record; after 「×」 it opens it', async () => {
    const { onRowClick, onRowSelect } = renderLinkedCards();
    await chipOf('u9');
    await startSelecting();
    expect(fireEvent.click(await chipOf('u9'))).toBe(false);
    expect(await cardOf('Acme')).toHaveAttribute('aria-pressed', 'true');
    expect(onRowSelect).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })]);
    expect(opened).toEqual([]);
    expect(onRowClick).not.toHaveBeenCalled();

    endSelecting();
    fireEvent.click(await chipOf('u9'));
    expect(opened).toEqual([['sys_user', 'u9']]);
  });

  it('a tap on the card\'s 「⋮」 ticks the card and opens no menu', async () => {
    const { onRowSelect } = renderLinkedCards();
    await mailOf('ada@acme.test');
    await startSelecting();
    await userEvent.click(within(await cardOf('Acme')).getByTestId('row-action-trigger'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(await cardOf('Acme')).toHaveAttribute('aria-pressed', 'true');
    expect(onRowSelect).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })]);
  });

  // objectstack#36315 — a keyboard on the 「⋮」 is a tap too: Enter or Space
  // ticks the card and opens no menu (nor does ArrowDown); after 「×」 Enter
  // opens the menu again.
  it.each(['{Enter}', ' '])('while selecting, %s on the card\'s 「⋮」 ticks the card and opens no menu', async (key) => {
    const { onRowSelect } = renderLinkedCards();
    await mailOf('ada@acme.test');
    await startSelecting();
    within(await cardOf('Acme')).getByTestId('row-action-trigger').focus();
    await userEvent.keyboard(key);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(await cardOf('Acme')).toHaveAttribute('aria-pressed', 'true');
    expect(onRowSelect).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })]);
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(await cardOf('Acme')).toHaveAttribute('aria-pressed', 'true');

    endSelecting();
    within(await cardOf('Acme')).getByTestId('row-action-trigger').focus();
    await userEvent.keyboard(key);
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  });

  it('while selecting, Enter on a link inside the card ticks the card and opens nothing', async () => {
    const { onRowClick, onRowSelect } = renderLinkedCards();
    await mailOf('ada@acme.test');
    await startSelecting();
    (await mailOf('ada@acme.test')).focus();
    await userEvent.keyboard('{Enter}');
    expect(await cardOf('Acme')).toHaveAttribute('aria-pressed', 'true');
    expect(onRowSelect).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })]);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('a long press on the email starts the selection with its card ticked, and the click that ends it opens nothing', async () => {
    const { onRowClick, onRowSelect } = renderLinkedCards();
    const mail = await mailOf('ada@acme.test');
    fireEvent.pointerDown(mail, { clientX: 10, clientY: 10 });
    await hold(600);
    fireEvent.pointerUp(mail);
    expect(fireEvent.click(mail), 'the link does not open').toBe(false);
    expect(await cardOf('Acme')).toHaveAttribute('aria-pressed', 'true');
    expect(onRowSelect).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })]);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('on a desktop width the table keeps its links while rows are ticked', async () => {
    const { onRowSelect } = renderLinkedCards(1280);
    const mail = await mailOf('ada@acme.test');
    expect(document.querySelector('[data-testid="grid-mobile-card"]'), 'the table, not the cards').toBeNull();
    const row = mail.closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    await waitFor(() => expect(onRowSelect).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })]));
    const ticks = onRowSelect.mock.calls.length;
    expect(fireEvent.click(await mailOf('ada@acme.test')), 'the link opens').toBe(true);
    fireEvent.click(await chipOf('u9'));
    expect(opened).toEqual([['sys_user', 'u9']]);
    expect(onRowSelect).toHaveBeenCalledTimes(ticks);
  });
});

function SelectableProbe({ scope }: { scope: HTMLElement }) {
  return <span data-testid="selectable-probe" data-selectable={String(useListPageSelectable(scope))} />;
}
