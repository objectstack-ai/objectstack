/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28434 — a right-click on a list row opens that row's actions at
 * the pointer; a right-click on a row inside a selection of two or more opens
 * the selection's bulk actions.
 *
 * Driven through the real `ObjectGrid` → `data-table` → `RowActionMenu` chain:
 *
 * 1. Parity: for each row, the context menu lists exactly the row's "⋮" items
 *    (after Open / Open in new tab), in the same order, a `visible` predicate
 *    removing an action from both; the inline primary the cell's width budget
 *    keeps out of the "⋮" is listed too, where the plan places primaries.
 * 2. Selection: the bulk actions the bar offers, with count and Clear, and no
 *    single-record action; a row outside the selection still opens its own.
 * 3. The browser's menu stays on a link, a cell in edit mode, a text selection
 *    in the row, and a touch long-press.
 * 4. Keyboard: Shift+F10 / the context-menu key on a focused cell opens the
 *    same menu; Esc closes it and focus goes back to the cell.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { ActionProvider, RelatedRecordActionsProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'account';
const ROWS = [
  { id: 'a1', name: 'Acme', status: 'draft' },
  { id: 'a2', name: 'Globex', status: 'active' },
  { id: 'a3', name: 'Initech', status: 'draft' },
];

/** The object's `list_item` actions: one gated per row, one ungated. */
const SECONDARY_ACTIONS = [
  { name: 'submit_review', label: 'Submit for review', type: 'api', target: '/api/submit', locations: ['list_item'], visible: "record.status == 'draft'" },
  { name: 'archive', label: 'Archive', type: 'api', target: '/api/archive', locations: ['list_item'] },
];
/** A primary: the cell draws it inline, outside the "⋮". */
const PRIMARY_ACTION = { name: 'promote', label: 'Promote', type: 'api', target: '/api/promote', locations: ['list_item'], variant: 'primary' };

function makeHost() {
  return {
    resolve: () => ({}),
    recordHref: (objectName: string, recordId: string | number) => `/apps/crm/${objectName}/record/${recordId}`,
    openRecord: vi.fn(),
  } as any;
}

function renderGrid(opts: {
  rowActionDefs?: unknown[];
  schema?: Record<string, unknown>;
  onRowClick?: (row: any, e?: any) => void;
  host?: boolean;
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
    columns: [{ field: 'name', label: 'Name', link: true }, { field: 'status', label: 'Status' }],
    data: { provider: 'value', items: ROWS },
    // The host-derived form of the object's `list_item` actions — what
    // `ObjectView` hands the grid (`objectDef.actions` filtered by location).
    rowActionDefs: opts.rowActionDefs ?? SECONDARY_ACTIONS,
    ...opts.schema,
  };
  const grid = (
    <ObjectGrid
      schema={schema}
      dataSource={dataSource}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onRowClick={opts.onRowClick}
    />
  );
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        {opts.host === false ? grid : <RelatedRecordActionsProvider value={makeHost()}>{grid}</RelatedRecordActionsProvider>}
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** The `<tr>` of the row showing `name`. */
function rowOf(name: string): HTMLElement {
  const tr = screen.getByText(name).closest('tr');
  if (!tr) throw new Error(`no row for ${name}`);
  return tr as HTMLElement;
}

/** A plain (non-link) data cell of that row: its Status cell. */
function plainCellOf(name: string): HTMLElement {
  const row = ROWS.find((r) => r.name === name)!;
  return within(rowOf(name)).getByText(row.status).closest('td') as HTMLElement;
}

async function settle() {
  await waitFor(() => expect(screen.getByText('Initech')).toBeInTheDocument());
  // The row actions depend on `getObjectSchema`; read nothing before it lands.
  await waitFor(() => expect(screen.getAllByTestId('row-action-trigger').length).toBeGreaterThan(0));
}

const contextMenu = () => screen.queryByTestId('row-context-menu');
const itemIds = (menu: HTMLElement) =>
  within(menu).queryAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));

/** The "⋮" items of a row, read off its real menu, which is closed again. */
async function kebabItemIds(name: string): Promise<(string | null)[]> {
  await userEvent.click(within(rowOf(name)).getByTestId('row-action-trigger'));
  const menu = await screen.findByRole('menu');
  const ids = itemIds(menu);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return ids;
}

/** Right-click a row's plain cell; returns whether the browser's menu was allowed. */
function rightClick(el: HTMLElement): boolean {
  return fireEvent.contextMenu(el, { button: 2, clientX: 40, clientY: 60 });
}

async function contextItemIds(name: string): Promise<(string | null)[]> {
  act(() => { rightClick(plainCellOf(name)); });
  const menu = await screen.findByTestId('row-context-menu');
  const ids = itemIds(menu);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(contextMenu()).toBeNull());
  return ids;
}

const OPEN_ITEMS = ['row-context-open', 'row-context-open-new-tab'];

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
  window.getSelection()?.removeAllRanges();
});

describe('objectstack#28434 · a row\'s context menu lists exactly its "⋮" items', () => {
  it('per row: Open, Open in new tab, then the "⋮" items in their order — a false `visible` removes one from both', async () => {
    renderGrid();
    await settle();
    for (const row of ROWS) {
      const kebab = await kebabItemIds(row.name);
      const context = await contextItemIds(row.name);
      expect(context.slice(0, 2)).toEqual(OPEN_ITEMS);
      expect(context.slice(2)).toEqual(kebab);
      // The per-row predicate decides in both menus alike.
      expect(kebab.includes('row-action-submit_review')).toBe(row.status === 'draft');
    }
  });

  it('lists the inline primary too, where the plan places primaries (above the secondaries)', async () => {
    renderGrid({ rowActionDefs: [...SECONDARY_ACTIONS, PRIMARY_ACTION] });
    await settle();
    // The cell draws the primary inline, so the "⋮" does not hold it.
    expect(within(rowOf('Acme')).getByTestId('row-action-inline-promote')).toBeInTheDocument();
    const kebab = await kebabItemIds('Acme');
    expect(kebab).not.toContain('row-action-promote');
    const context = await contextItemIds('Acme');
    expect(context).toEqual([
      ...OPEN_ITEMS,
      'row-action-builtin-edit',
      'row-action-builtin-delete',
      'row-action-promote',
      'row-action-submit_review',
      'row-action-archive',
    ]);
  });

  it('Open is the row click, and Open in new tab is the row\'s own record URL', async () => {
    const onRowClick = vi.fn();
    renderGrid({ onRowClick });
    await settle();
    act(() => { rightClick(plainCellOf('Globex')); });
    const menu = await screen.findByTestId('row-context-menu');
    const newTab = within(menu).getByTestId('row-context-open-new-tab');
    expect(newTab).toHaveAttribute('href', '/apps/crm/account/record/a2');
    expect(newTab).toHaveAttribute('target', '_blank');
    await userEvent.click(within(menu).getByTestId('row-context-open'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'a2' });
  });

  it('a chosen action dispatches through the cell\'s own handler', async () => {
    renderGrid();
    await settle();
    act(() => { rightClick(plainCellOf('Globex')); });
    const menu = await screen.findByTestId('row-context-menu');
    await userEvent.click(within(menu).getByTestId('row-action-archive'));
    await waitFor(() => expect(fetchMock.mock.calls.map((call) => call[0])).toContain('/api/archive'));
  });

  it('a row whose every action is hidden by its predicate still opens Open and Open in new tab', async () => {
    // One gated action, no Edit/Delete, rows not selectable: Globex (active)
    // offers nothing, yet the table offers row actions, so its menu still opens.
    renderGrid({
      rowActionDefs: [SECONDARY_ACTIONS[0]],
      schema: { operations: { update: false, delete: false }, selection: { type: 'none' } },
    });
    await settle();
    expect(within(rowOf('Globex')).queryByTestId('row-action-trigger')).toBeNull();
    let allowed = true;
    act(() => { allowed = rightClick(plainCellOf('Globex')); });
    expect(allowed).toBe(false);
    const menu = await screen.findByTestId('row-context-menu');
    expect(itemIds(menu)).toEqual(OPEN_ITEMS);
  });

  it('CONTROL — without a host record URL there is no Open in new tab, and Open stays', async () => {
    renderGrid({ host: false });
    await settle();
    const context = await contextItemIds('Acme');
    expect(context[0]).toBe('row-context-open');
    expect(context).not.toContain('row-context-open-new-tab');
  });
});

describe('objectstack#28434 · a row inside a selection of two or more opens the selection\'s bulk actions', () => {
  async function selectRows(...names: string[]) {
    for (const name of names) {
      await userEvent.click(within(rowOf(name)).getByRole('checkbox'));
    }
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
  }

  it('lists the bar\'s bulk actions, the count and Clear — never a single-record action', async () => {
    renderGrid({ schema: { bulkActionDefs: [{ name: 'mass_archive', label: 'Archive selected', type: 'api', target: '/api/mass-archive' }] } });
    await settle();
    await selectRows('Acme', 'Globex', 'Initech');
    // The bar offers it…
    expect(screen.getByTestId('bulk-action-mass_archive')).toBeInTheDocument();
    act(() => { rightClick(plainCellOf('Globex')); });
    const menu = await screen.findByTestId('row-context-menu');
    // …and so does the menu, with the bar's count and Clear.
    expect(within(menu).getByTestId('row-context-selection-count')).toHaveTextContent('3');
    expect(itemIds(menu)).toEqual(['row-context-bulk-mass_archive', 'row-context-clear-selection']);
    expect(within(menu).queryByTestId(/^row-action-/)).toBeNull();
    expect(within(menu).queryByTestId('row-context-open')).toBeNull();
  });

  it('with no declared bulk action: count and Clear, and Clear clears the selection', async () => {
    renderGrid({ schema: { selection: { type: 'multiple' } } });
    await settle();
    await selectRows('Acme', 'Globex');
    act(() => { rightClick(plainCellOf('Acme')); });
    const menu = await screen.findByTestId('row-context-menu');
    expect(within(menu).getByTestId('row-context-selection-count')).toHaveTextContent('2');
    expect(itemIds(menu)).toEqual(['row-context-clear-selection']);
    await userEvent.click(within(menu).getByTestId('row-context-clear-selection'));
    await waitFor(() => expect(screen.queryByTestId('bulk-actions-bar')).toBeNull());
    expect(within(rowOf('Acme')).getByRole('checkbox')).not.toBeChecked();
  });

  it('CONTROL — a row OUTSIDE the selection opens its own actions', async () => {
    renderGrid({ schema: { selection: { type: 'multiple' } } });
    await settle();
    await selectRows('Acme', 'Globex');
    const context = await contextItemIds('Initech');
    expect(context.slice(0, 2)).toEqual(OPEN_ITEMS);
    expect(context).toContain('row-action-archive');
  });

  it('CONTROL — a selection of ONE is not a bulk act: the row opens its own actions', async () => {
    renderGrid({ schema: { selection: { type: 'multiple' } } });
    await settle();
    await selectRows('Acme');
    const context = await contextItemIds('Acme');
    expect(context).toContain('row-action-archive');
    expect(context).not.toContain('row-context-clear-selection');
  });
});

describe('objectstack#28434 · the browser keeps its own menu where it is the useful one', () => {
  it('on a link inside a cell', async () => {
    renderGrid();
    await settle();
    const anchor = within(rowOf('Acme')).getByRole('link', { name: 'Acme' });
    expect(anchor).toHaveAttribute('href');
    expect(rightClick(anchor)).toBe(true);
    expect(contextMenu()).toBeNull();
  });

  it('on a cell in edit mode', async () => {
    renderGrid({ schema: { editable: true } });
    await settle();
    const cell = plainCellOf('Acme');
    await userEvent.dblClick(cell);
    await userEvent.click(cell);
    const input = await waitFor(() => {
      const el = cell.querySelector('input, textarea');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(rightClick(input)).toBe(true);
    expect(contextMenu()).toBeNull();
    // The editing cell itself, outside its input, keeps it too.
    expect(cell).toHaveAttribute('data-editing-cell');
    expect(rightClick(cell)).toBe(true);
    expect(contextMenu()).toBeNull();
  });

  it('with a text selection inside the row', async () => {
    renderGrid();
    await settle();
    const cell = plainCellOf('Acme');
    const range = document.createRange();
    range.selectNodeContents(cell);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(rightClick(cell)).toBe(true);
    expect(contextMenu()).toBeNull();
  });

  it('on a touch long-press (touch keeps the "⋮")', async () => {
    renderGrid();
    await settle();
    const cell = plainCellOf('Acme');
    fireEvent.pointerDown(cell, { pointerType: 'touch' });
    expect(rightClick(cell)).toBe(true);
    expect(contextMenu()).toBeNull();
  });

  it('CONTROL — a right-click on a plain cell of the same row is the row\'s, and the browser\'s menu is held back', async () => {
    renderGrid();
    await settle();
    let allowed = true;
    act(() => { allowed = rightClick(plainCellOf('Acme')); });
    expect(allowed).toBe(false);
    expect(await screen.findByTestId('row-context-menu')).toBeInTheDocument();
  });

  it('CONTROL — a grid with no row action at all whose rows cannot be selected keeps the browser\'s menu', async () => {
    renderGrid({ rowActionDefs: [], schema: { operations: { update: false, delete: false }, selection: { type: 'none' } } });
    await waitFor(() => expect(screen.getByText('Initech')).toBeInTheDocument());
    expect(screen.queryAllByTestId('row-action-trigger')).toHaveLength(0);
    expect(rightClick(plainCellOf('Acme'))).toBe(true);
    expect(contextMenu()).toBeNull();
  });
});

describe('objectstack#28434 · the keyboard opens the same menu, Esc returns focus to the row', () => {
  it.each([
    ['Shift+F10', { key: 'F10', shiftKey: true }],
    ['the context-menu key', { key: 'ContextMenu' }],
  ])('%s on a focused cell opens it; Esc closes it and focus goes back to the cell', async (_label, keyInit) => {
    renderGrid();
    await settle();
    const kebab = await kebabItemIds('Globex');
    const cell = plainCellOf('Globex');
    cell.focus();
    expect(cell).toHaveFocus();
    act(() => { fireEvent.keyDown(cell, keyInit); });
    const menu = await screen.findByTestId('row-context-menu');
    expect(itemIds(menu).slice(2)).toEqual(kebab);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(contextMenu()).toBeNull());
    expect(cell).toHaveFocus();
  });
});
