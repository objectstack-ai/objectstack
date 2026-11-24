/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36289 — a right-click on a list cell opens a menu in two
 * sections: the cell's own Copy, Paste, Clear (and Change history), then the
 * row's items as before. Driven through the real `ObjectGrid` → `data-table`
 * chain, with a data source whose `update` records each save.
 *
 * 1. The cell's section comes first, a separator, then the row's section;
 *    a right-click off a data cell (the selection cell) opens the row's only.
 * 2. Copy writes the cell's value to the clipboard, as Ctrl/Cmd+C does.
 * 3. Paste writes the clipboard's text into the cell and saves it; text the
 *    cell's editor would refuse (an email box holding no address) is not
 *    saved and the cell says why, in the editor's words. Ctrl+V on the
 *    selected cell refuses it the same way.
 * 4. A clipboard the browser will not read says so on the cell, never silent.
 * 5. Clear empties and saves the cell; on a required field it is unavailable.
 * 6. A read-only field: Paste and Clear unavailable, Copy available. A field
 *    type pasted text cannot stand for (a lookup, a multi-select): Paste
 *    unavailable.
 * 7. A grid the reader cannot edit: Paste and Clear unavailable everywhere.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const clipboard = vi.hoisted(() => ({
  written: [] as string[],
  text: '' as string,
  refuse: false,
}));

beforeEach(() => {
  // The record verdict and approval-lock reads an editable grid makes answer
  // nothing: every row stays editable (fail open).
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true }),
  }));
  clipboard.written = [];
  clipboard.text = '';
  clipboard.refuse = false;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(async (text: string) => { clipboard.written.push(text); }),
      readText: vi.fn(async () => {
        if (clipboard.refuse) throw new DOMException('Read permission denied.', 'NotAllowedError');
        return clipboard.text;
      }),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FIELDS = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Name', required: true },
  email: { type: 'email', label: 'Email' },
  notes: { type: 'text', label: 'Notes' },
  code: { type: 'text', label: 'Code', readonly: true },
  owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  tags: { type: 'multiselect', label: 'Tags', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
};

function makeDataSource() {
  const store: Record<string, any> = {
    r1: { id: 'r1', name: 'Acme', email: 'ops@acme.test', notes: 'Call back Monday', code: 'C-1', owner: null, tags: ['a'] },
    r2: { id: 'r2', name: 'Globex', email: 'hi@globex.test', notes: 'Quiet', code: 'C-2', owner: null, tags: [] },
  };
  return {
    store,
    find: vi.fn(async (object: string) =>
      object === 'sys_activity'
        ? { data: [] }
        : { data: Object.values(store).map((r) => ({ ...r })), total: 2, hasMore: false, pageSize: 50 }),
    update: vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
      store[id] = { ...store[id], ...changes };
      return { ...store[id] };
    }),
    getObjectSchema: async (name: string) => ({ name, fields: FIELDS }),
  } as any;
}

async function renderGrid(opts: { editable?: boolean } = {}) {
  const ds = makeDataSource();
  const utils = render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: 'account',
          editable: opts.editable ?? true,
          columns: ['name', 'email', 'notes', 'code', 'owner', 'tags'],
          selection: { type: 'multiple' },
        } as any}
        dataSource={ds}
      />
    </ActionProvider>,
  );
  await screen.findByText('Globex', {}, { timeout: 5000 });
  await waitFor(() => expect(screen.getByText('Tags')).toBeInTheDocument());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
  const cell = (name: string, column: string) =>
    row(name).querySelector<HTMLElement>(`td[data-cell-column="${column}"]`)!;
  const openMenu = async (el: HTMLElement) => {
    act(() => { fireEvent.contextMenu(el, { button: 2, clientX: 40, clientY: 60 }); });
    return screen.findByTestId('row-context-menu');
  };
  return { ...utils, ds, row, cell, openMenu };
}

const item = (menu: HTMLElement, id: string) => within(menu).getByTestId(id);
const isUnavailable = (el: HTMLElement) => el.hasAttribute('data-disabled');
const settleClipboard = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('a list cell\'s right-click menu (objectstack#36289)', () => {
  it('lists the cell\'s Copy, Paste, Clear and Change history, a separator, then the row\'s items', async () => {
    const g = await renderGrid();
    const menu = await g.openMenu(g.cell('Acme', 'notes'));
    const ids = Array.from(menu.querySelectorAll<HTMLElement>('[data-testid^="row-context-"]')).map((el) => el.dataset.testid);
    const separator = ids.indexOf('row-context-cell-separator');
    expect(ids.slice(0, separator)).toEqual([
      'row-context-cell-copy',
      'row-context-cell-paste',
      'row-context-cell-clear',
      'row-context-field-history',
    ]);
    // The row's section is below the line, and nothing of the cell's is there.
    expect(ids.indexOf('row-context-open')).toBeGreaterThan(separator);
    expect(ids.slice(separator + 1).some((id) => id?.startsWith('row-context-cell-'))).toBe(false);
  });

  it('off a data cell (the selection cell) only the row\'s section opens', async () => {
    const g = await renderGrid();
    const selectCell = g.row('Acme').querySelector<HTMLElement>('td:not([data-cell-column])')!;
    const menu = await g.openMenu(selectCell);
    expect(within(menu).queryByTestId('row-context-cell-copy')).toBeNull();
    expect(within(menu).queryByTestId('row-context-cell-separator')).toBeNull();
    // CONTROL: the row's own items are there.
    expect(item(menu, 'row-context-open')).toBeInTheDocument();
  });

  it('Copy writes the cell\'s value to the clipboard', async () => {
    const g = await renderGrid();
    const menu = await g.openMenu(g.cell('Acme', 'notes'));
    fireEvent.click(item(menu, 'row-context-cell-copy'));
    expect(clipboard.written).toEqual(['Call back Monday']);
  });

  it('Paste writes the clipboard\'s text into the cell and saves it', async () => {
    const g = await renderGrid();
    clipboard.text = 'Call back Monday';
    const menu = await g.openMenu(g.cell('Globex', 'notes'));
    fireEvent.click(item(menu, 'row-context-cell-paste'));
    await settleClipboard();
    await waitFor(() => expect(g.ds.update).toHaveBeenCalledTimes(1));
    expect(g.ds.update.mock.calls[0].slice(0, 3)).toEqual(['account', 'r2', { notes: 'Call back Monday' }]);
    await waitFor(() => expect(g.cell('Globex', 'notes')).toHaveTextContent('Call back Monday'));
  });

  it('Paste of text that is no email into an email cell saves nothing and says why, as the editor does', async () => {
    const g = await renderGrid();
    clipboard.text = 'not an address';
    const menu = await g.openMenu(g.cell('Globex', 'email'));
    fireEvent.click(item(menu, 'row-context-cell-paste'));
    await settleClipboard();
    expect(await screen.findByTestId('cell-readonly-reason'))
      .toHaveTextContent('Please enter a valid email address');
    expect(g.ds.update).not.toHaveBeenCalled();
    expect(g.cell('Globex', 'email')).toHaveTextContent('hi@globex.test');
  });

  it('Ctrl+V on the selected cell refuses the same text the same way (control: a real address saves)', async () => {
    const g = await renderGrid();
    fireEvent.click(g.cell('Globex', 'email'));
    const catcher = () => g.container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
    fireEvent.paste(catcher(), { clipboardData: { getData: () => 'not an address' } });
    expect(await screen.findByTestId('cell-readonly-reason'))
      .toHaveTextContent('Please enter a valid email address');
    expect(g.ds.update).not.toHaveBeenCalled();
    fireEvent.paste(catcher(), { clipboardData: { getData: () => 'team@globex.test' } });
    await waitFor(() => expect(g.ds.update).toHaveBeenCalledTimes(1));
    expect(g.ds.update.mock.calls[0].slice(0, 3)).toEqual(['account', 'r2', { email: 'team@globex.test' }]);
  });

  it('a clipboard the browser will not read says so on the cell', async () => {
    const g = await renderGrid();
    clipboard.refuse = true;
    const menu = await g.openMenu(g.cell('Globex', 'notes'));
    fireEvent.click(item(menu, 'row-context-cell-paste'));
    await settleClipboard();
    expect(await screen.findByTestId('cell-readonly-reason'))
      .toHaveTextContent('The browser didn\'t let the list read the clipboard');
    expect(g.ds.update).not.toHaveBeenCalled();
  });

  it('Clear empties the cell and saves it', async () => {
    const g = await renderGrid();
    const menu = await g.openMenu(g.cell('Acme', 'notes'));
    fireEvent.click(item(menu, 'row-context-cell-clear'));
    await waitFor(() => expect(g.ds.update).toHaveBeenCalledTimes(1));
    expect(g.ds.update.mock.calls[0].slice(0, 3)).toEqual(['account', 'r1', { notes: null }]);
  });

  it('Clear is unavailable on a required field (control: available on an optional one)', async () => {
    const g = await renderGrid();
    let menu = await g.openMenu(g.cell('Acme', 'name'));
    expect(isUnavailable(item(menu, 'row-context-cell-clear'))).toBe(true);
    expect(isUnavailable(item(menu, 'row-context-cell-paste'))).toBe(false);
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('row-context-menu')).toBeNull());
    menu = await g.openMenu(g.cell('Acme', 'notes'));
    expect(isUnavailable(item(menu, 'row-context-cell-clear'))).toBe(false);
  });

  it('a read-only field: Paste and Clear unavailable, Copy available', async () => {
    const g = await renderGrid();
    const menu = await g.openMenu(g.cell('Acme', 'code'));
    expect(isUnavailable(item(menu, 'row-context-cell-copy'))).toBe(false);
    expect(isUnavailable(item(menu, 'row-context-cell-paste'))).toBe(true);
    expect(isUnavailable(item(menu, 'row-context-cell-clear'))).toBe(true);
    fireEvent.click(item(menu, 'row-context-cell-copy'));
    expect(clipboard.written).toEqual(['C-1']);
  });

  it('a lookup and a multi-select take no pasted text: Paste unavailable, Clear available', async () => {
    const g = await renderGrid();
    for (const column of ['owner', 'tags']) {
      const menu = await g.openMenu(g.cell('Acme', column));
      expect(isUnavailable(item(menu, 'row-context-cell-paste'))).toBe(true);
      expect(isUnavailable(item(menu, 'row-context-cell-clear'))).toBe(false);
      fireEvent.keyDown(menu, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('row-context-menu')).toBeNull());
    }
  });

  it('a grid the reader cannot edit: Paste and Clear unavailable, Copy available', async () => {
    const g = await renderGrid({ editable: false });
    const menu = await g.openMenu(g.cell('Acme', 'notes'));
    expect(isUnavailable(item(menu, 'row-context-cell-copy'))).toBe(false);
    expect(isUnavailable(item(menu, 'row-context-cell-paste'))).toBe(true);
    expect(isUnavailable(item(menu, 'row-context-cell-clear'))).toBe(true);
  });
});
