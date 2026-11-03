/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29150 — on a phone, each list card offers its row's actions
 * through one 44 px "⋮" control, and a tap on the card still opens the record.
 *
 * Driven through the real `ObjectGrid` card face at 390 px against the same
 * grid at 1280 px:
 *
 * 1. Parity: a card's menu lists the row's actions in the set and order the
 *    desktop row's context menu lists them (the "⋮" items plus the inline
 *    primary, where the plan places primaries), a `visible` predicate removing
 *    one from both.
 * 2. The control is the row's own trigger, 44 px below `sm`, and choosing an
 *    item runs it without opening the record; a tap on the card opens it.
 * 3. A grid whose rows offer no action draws no control on its cards.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ isLoaded: false, checkField: () => true, getObjectApiOperations: () => undefined, can: () => true }),
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

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

const OBJECT = 'account';
const ROWS = [
  { id: 'a1', name: 'Acme', status: 'draft' },
  { id: 'a2', name: 'Globex', status: 'active' },
];

/** The object's `list_item` actions: one gated per row, one ungated, one primary. */
const ROW_ACTIONS = [
  { name: 'submit_review', label: 'Submit for review', type: 'api', target: '/api/submit', locations: ['list_item'], visible: "record.status == 'draft'" },
  { name: 'archive', label: 'Archive', type: 'api', target: '/api/archive', locations: ['list_item'] },
  { name: 'promote', label: 'Promote', type: 'api', target: '/api/promote', locations: ['list_item'], variant: 'primary' },
];

function renderGrid(opts: {
  rowActionDefs?: unknown[];
  onRowClick?: (row: any) => void;
  onEdit?: ((row: any) => void) | null;
  onDelete?: ((row: any) => void) | null;
} = {}) {
  const dataSource: any = {
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, status: { type: 'text', label: 'Status' } },
    }),
  };
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [{ field: 'name', label: 'Name' }, { field: 'status', label: 'Status' }],
    data: { provider: 'value', items: ROWS },
    rowActionDefs: opts.rowActionDefs ?? ROW_ACTIONS,
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid
          schema={schema}
          dataSource={dataSource}
          onEdit={opts.onEdit === null ? undefined : (opts.onEdit ?? vi.fn())}
          onDelete={opts.onDelete === null ? undefined : (opts.onDelete ?? vi.fn())}
          onRowClick={opts.onRowClick}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

const itemIds = (menu: HTMLElement) =>
  within(menu).queryAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
const OPEN_ITEMS = ['row-context-open', 'row-context-open-new-tab'];

/** Desktop: the row's context menu, minus Open / Open in new tab. */
async function desktopRowActions(): Promise<Record<string, (string | null)[]>> {
  setWidth(1280);
  renderGrid();
  // Cells are masked until the object's field types land; read nothing before.
  await waitFor(() => expect(screen.getByText('Globex')).toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByTestId('row-action-trigger').length).toBe(ROWS.length));
  expect(document.querySelector('[data-testid="grid-mobile-card"]'), 'the table, not the cards').toBeNull();
  const out: Record<string, (string | null)[]> = {};
  for (const row of ROWS) {
    const cell = within(screen.getByText(row.name).closest('tr') as HTMLElement).getByText(row.status);
    act(() => { fireEvent.contextMenu(cell, { button: 2, clientX: 40, clientY: 60 }); });
    const menu = await screen.findByTestId('row-context-menu');
    out[row.name] = itemIds(menu).filter((id) => !OPEN_ITEMS.includes(id ?? ''));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('row-context-menu')).toBeNull());
  }
  cleanup();
  return out;
}

const cards = () => [...document.querySelectorAll('[data-testid="grid-mobile-card"]')] as HTMLElement[];
const cardOf = (name: string) =>
  cards().find((card) => within(card).queryByTestId('grid-card-title')?.textContent === name)!;

async function phoneCards(opts: Parameters<typeof renderGrid>[0] = {}) {
  setWidth(390);
  renderGrid(opts);
  await waitFor(() => expect(cards()).toHaveLength(ROWS.length));
  // Titles are masked until the object's field types land.
  await waitFor(() => expect(cardOf('Globex')).toBeDefined());
}

/** A card's menu items, read off its real menu, which is closed again. */
async function cardItemIds(name: string): Promise<(string | null)[]> {
  await userEvent.click(within(cardOf(name)).getByTestId('row-action-trigger'));
  const menu = await screen.findByRole('menu');
  const ids = itemIds(menu);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return ids;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setWidth(ORIGINAL_INNER_WIDTH);
});

describe('objectstack#29150 · a phone list card offers its row actions', () => {
  it('at 390 px each card\'s menu lists the desktop row\'s actions, in the same order', async () => {
    const desktop = await desktopRowActions();
    // The desktop reference is the full set: Edit, Delete, the primary, then
    // the secondaries, the gated one only where its predicate holds.
    expect(desktop.Acme).toEqual([
      'row-action-builtin-edit',
      'row-action-builtin-delete',
      'row-action-promote',
      'row-action-submit_review',
      'row-action-archive',
    ]);
    expect(desktop.Globex).not.toContain('row-action-submit_review');

    await phoneCards();
    for (const row of ROWS) {
      expect(await cardItemIds(row.name), row.name).toEqual(desktop[row.name]);
    }
    // Every action sits in the one menu: the card draws no inline button.
    expect(screen.queryByTestId('row-action-inline-promote')).toBeNull();
  });

  it('the control is one 44 px trigger per card, at the card\'s right', async () => {
    await phoneCards();
    for (const row of ROWS) {
      const card = cardOf(row.name);
      const triggers = within(card).getAllByTestId('row-action-trigger');
      expect(triggers).toHaveLength(1);
      // 44 px below `sm`, the touch-target floor every phone control keeps.
      expect(triggers[0].className).toMatch(/(^|\s)min-h-\[44px\](\s|$)/);
      expect(triggers[0].className).toMatch(/(^|\s)min-w-\[44px\](\s|$)/);
      expect(card.lastElementChild?.contains(triggers[0])).toBe(true);
    }
  });

  it('choosing an item runs it and does not open the record; a tap on the card opens it', async () => {
    const onRowClick = vi.fn();
    const onEdit = vi.fn();
    await phoneCards({ onRowClick, onEdit });

    await userEvent.click(within(cardOf('Acme')).getByTestId('row-action-trigger'));
    const menu = await screen.findByRole('menu');
    expect(onRowClick).not.toHaveBeenCalled();
    await userEvent.click(within(menu).getByTestId('row-action-builtin-edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toMatchObject({ id: 'a1' });
    expect(onRowClick).not.toHaveBeenCalled();

    await userEvent.click(within(cardOf('Globex')).getByTestId('grid-card-title'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'a2' });
  });

  it('a card whose row offers no action draws no control', async () => {
    await phoneCards({ rowActionDefs: [], onEdit: null, onDelete: null });
    expect(screen.queryAllByTestId('row-action-trigger')).toHaveLength(0);
  });
});
