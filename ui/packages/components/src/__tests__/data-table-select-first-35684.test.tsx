/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `data-table`'s select-first cell model (objectstack#35684), behind the
 * `GridCellSelection` a host mounts. The list page mounts it through
 * `ObjectGrid`'s `cellSelection`; its keys while selected and while editing
 * are `data-table-keys-35687.test.tsx`.
 *
 *   1. A click selects a cell: a ring, no editor, no record opened. Without
 *      the provider the same click still edits (the control).
 *   2. Double-click, Enter or F2 edits; the value is kept.
 *   3. Space is typed like any key and opens the editor, never the record
 *      (the maintainer's correction on #35683); a two-state cell flips on
 *      Space or on a second click instead, and commits.
 *   4. A plain click on a link the cell draws selects the cell and follows
 *      nothing; a Ctrl/Cmd-click follows it, and a double-click on it edits
 *      (objectstack#36015). The title link (`data-opens-on-click`) keeps its
 *      click. The selected cell's open button and Ctrl/Cmd+Enter open the
 *      link; a copy button a value draws is not drawn.
 *   5. A cell that opens no editor says why on the cell: the host's sentence,
 *      else the table's own.
 *   6. A touch tap opens the record and edits nothing.
 *   7. The edit-only row column is never drawn: each cell saves itself
 *      (objectstack#35685, `data-table-autosave-35685.test.tsx`).
 *   8. In a reference cell the host names (`referenceCells`), a plain click on
 *      a record chip opens its record through the host and selects the cell;
 *      a click beside the chips only selects; Ctrl/Cmd+Enter opens the first
 *      chip; the cell draws an edit button, not the open button, and the edit
 *      button opens the editor through the same gate as double-click
 *      (objectstack#36015).
 *   9. objectstack#35689: a touch tap or double-tap never edits in place, the
 *      edit button included; in the grid a read-only cell carries
 *      `aria-readonly`, on the cell and on the focus inside it.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Registers `data-table` at module scope, not in a hook (objectui#3010).
import '../renderers';
// `react-page` reaches a dynamic `import('@object-ui/react-runtime')`: pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@object-ui/react-runtime';
import { GridCellSelectionProvider, type GridCellSelection } from '../context/gridCellSelection';

afterEach(cleanup);

const ROWS = [
  { id: '1', name: 'Alpha', amount: 10, done: false, site: 'a.example' },
  { id: '2', name: 'Beta', amount: 20, done: true, site: 'b.example' },
];

function renderTable({
  selection = {},
  extra = {},
  withTitle = false,
}: { selection?: GridCellSelection | null; extra?: Record<string, unknown>; withTitle?: boolean } = {}) {
  const DataTable = ComponentRegistry.get('data-table')!;
  const onRowClick = vi.fn();
  const onCellChange = vi.fn();
  const onSiteClick = vi.fn();
  const onTitleClick = vi.fn();
  // The title link a host marks as the one a click follows (objectstack#36015).
  const titleColumn = {
    header: 'Title',
    accessorKey: 'title',
    cell: (_value: unknown, row: { id: string }) => (
      <a href={`/record/${row.id}`} data-opens-on-click="" onClick={(e) => { e.preventDefault(); onTitleClick(row.id); }}>
        Record {row.id}
      </a>
    ),
  };
  const schema = {
    type: 'data-table',
    columns: [
      { header: 'Name', accessorKey: 'name' },
      { header: 'Amount', accessorKey: 'amount', type: 'number' },
      { header: 'Done', accessorKey: 'done', type: 'boolean' },
      {
        header: 'Site',
        accessorKey: 'site',
        cell: (value: string) => (
          <span>
            <a href={`https://${value}`} onClick={(e) => { e.preventDefault(); onSiteClick(value); }}>{value}</a>
            <button type="button" data-cell-copy="">Copy site</button>
          </span>
        ),
      },
      ...(withTitle ? [titleColumn] : []),
    ],
    data: ROWS,
    editable: true,
    singleClickEdit: true,
    searchable: false,
    pagination: false,
    onRowClick,
    onCellChange,
    ...extra,
  };
  const utils = render(
    <GridCellSelectionProvider value={selection}>
      <DataTable schema={schema} />
    </GridCellSelectionProvider>,
  );
  const cell = (row: number, col: number) =>
    utils.container.querySelectorAll('tbody tr')[row].querySelectorAll('td[data-grid-cell]')[col] as HTMLElement;
  const editor = () => utils.container.querySelector<HTMLInputElement>('td[data-editing-cell] input');
  const catcher = () => utils.container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]');
  return { ...utils, cell, editor, catcher, onRowClick, onCellChange, onSiteClick, onTitleClick };
}

describe('data-table select-first — a click selects (objectstack#35684)', () => {
  it('selects the cell with a ring and focus in it, and neither edits nor opens the record', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    expect(t.cell(0, 0)).toHaveAttribute('data-selected-cell');
    expect(t.cell(0, 0)).toHaveAttribute('aria-selected', 'true');
    expect(t.cell(0, 0).querySelector('[data-slot="cell-selection-frame"]')).not.toBeNull();
    expect(t.editor()).toBeNull();
    expect(t.onRowClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(t.catcher());
    // Another cell takes the selection.
    fireEvent.click(t.cell(1, 1));
    expect(t.cell(0, 0)).not.toHaveAttribute('data-selected-cell');
    expect(t.cell(1, 1)).toHaveAttribute('data-selected-cell');
  });

  it('control: without the provider the same click still opens the editor', () => {
    // `keyboardNavigation` only addresses the cells (`data-grid-cell`) the probe reads.
    const t = renderTable({ selection: null, extra: { keyboardNavigation: true } });
    fireEvent.click(t.cell(0, 0));
    expect(t.editor()).not.toBeNull();
    expect(t.cell(0, 0)).not.toHaveAttribute('data-selected-cell');
  });
});

describe('data-table select-first — double-click, Enter and F2 edit', () => {
  it('a double-click opens the editor on the value, caret after it', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    fireEvent.doubleClick(t.cell(0, 0));
    expect(t.editor()).toHaveValue('Alpha');
    expect(t.editor()!.selectionStart).toBe(5);
    expect(t.editor()!.selectionEnd).toBe(5);
    expect(t.onRowClick).not.toHaveBeenCalled();
  });

  it('a double-click over the text edits, though the browser selected a word on the way', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    // The second press keeps the word under the pointer unselected…
    expect(fireEvent.mouseDown(t.cell(0, 0), { detail: 2 })).toBe(false);
    // …and a word a browser selected anyway does not stop the edit.
    const range = document.createRange();
    range.selectNodeContents(screen.getByText('Alpha'));
    window.getSelection()!.addRange(range);
    fireEvent.doubleClick(t.cell(0, 0));
    expect(t.editor()).toHaveValue('Alpha');
    expect(window.getSelection()!.isCollapsed).toBe(true);
  });

  it('a second click on the selected cell gives the focus back to it, so a typed key still edits', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    // A real press focuses the cell it lands on; `fireEvent.click` does not.
    t.cell(0, 0).focus();
    fireEvent.click(t.cell(0, 0));
    expect(document.activeElement).toBe(t.catcher());
    fireEvent.change(t.catcher()!, { target: { value: 'Z' } });
    expect(t.editor()).toHaveValue('Z');
  });

  it.each(['Enter', 'F2'])('%s on the selected cell opens the editor on the value', (key) => {
    const t = renderTable();
    fireEvent.click(t.cell(1, 0));
    fireEvent.keyDown(t.catcher()!, { key });
    expect(t.editor()).toHaveValue('Beta');
  });
});

describe('data-table select-first — Space types; a two-state cell flips', () => {
  it('Space on the selected cell is typed into it: the editor opens on it and no record opens', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    // The key is left to the catcher (not prevented), which reads it as typing.
    expect(fireEvent.keyDown(t.catcher()!, { key: ' ' })).toBe(true);
    expect(t.onRowClick).not.toHaveBeenCalled();
    fireEvent.change(t.catcher()!, { target: { value: ' ' } });
    expect(t.editor()).toHaveValue(' ');
    expect(t.onRowClick).not.toHaveBeenCalled();
  });

  it('Space on a selected boolean flips it and commits, and opens nothing', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 2));
    fireEvent.keyDown(t.catcher()!, { key: ' ' });
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'done', true, ROWS[0]);
    expect(t.onRowClick).not.toHaveBeenCalled();
  });

  it('the first click selects a boolean; a second click flips it', () => {
    const t = renderTable();
    fireEvent.click(t.cell(1, 2));
    expect(t.onCellChange).not.toHaveBeenCalled();
    fireEvent.click(t.cell(1, 2));
    expect(t.onCellChange).toHaveBeenCalledWith(1, 'done', false, ROWS[1]);
  });
});

describe('data-table select-first — a click on a link the cell draws only selects (objectstack#36015)', () => {
  it('a plain click selects the cell and follows nothing; a Ctrl or Cmd click follows the link', () => {
    const t = renderTable();
    const link = screen.getByText('a.example');
    const plain = fireEvent.click(link);
    expect(t.onSiteClick).not.toHaveBeenCalled();
    // The browser's own navigation was cancelled too.
    expect(plain).toBe(false);
    expect(t.cell(0, 3)).toHaveAttribute('data-selected-cell');
    expect(t.onRowClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(t.catcher());
    fireEvent.click(link, { ctrlKey: true });
    expect(t.onSiteClick).toHaveBeenCalledTimes(1);
    fireEvent.click(link, { metaKey: true });
    expect(t.onSiteClick).toHaveBeenCalledTimes(2);
  });

  it('a double-click on the link edits, as on any cell', () => {
    const t = renderTable();
    fireEvent.click(screen.getByText('a.example'));
    fireEvent.doubleClick(screen.getByText('a.example'));
    expect(t.editor()).toHaveValue('a.example');
    expect(t.onSiteClick).not.toHaveBeenCalled();
  });

  it('control: the title link (data-opens-on-click) keeps its click and selects nothing', () => {
    const t = renderTable({ withTitle: true });
    fireEvent.click(screen.getByText('Record 1'));
    expect(t.onTitleClick).toHaveBeenCalledWith('1');
    expect(t.cell(0, 4)).not.toHaveAttribute('data-selected-cell');
  });

  it('the selected cell draws an open button that follows the link; an unselected cell draws none', () => {
    const t = renderTable();
    expect(t.cell(0, 3).querySelector('[data-testid="cell-open-button"]')).toBeNull();
    fireEvent.click(t.cell(0, 3));
    const open = t.cell(0, 3).querySelector<HTMLButtonElement>('[data-testid="cell-open-button"]')!;
    expect(open).toHaveAccessibleName('Open');
    expect(open.className).toContain('flex');
    fireEvent.click(open);
    expect(t.onSiteClick).toHaveBeenCalledWith('a.example');
    // The cell stays selected.
    expect(t.cell(0, 3)).toHaveAttribute('data-selected-cell');
  });

  it('a selected cell with nothing to open hides its open button', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    const open = t.cell(0, 0).querySelector<HTMLButtonElement>('[data-testid="cell-open-button"]')!;
    expect(open.className).toContain('hidden');
    expect(open.className).not.toMatch(/(^|\s)flex(\s|$)/);
  });

  it('Ctrl or Cmd+Enter on the selected cell follows the link; plain Enter edits', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 3));
    fireEvent.keyDown(t.catcher()!, { key: 'Enter', ctrlKey: true });
    expect(t.onSiteClick).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(t.catcher()!, { key: 'Enter', metaKey: true });
    expect(t.onSiteClick).toHaveBeenCalledTimes(2);
    expect(t.editor()).toBeNull();
    fireEvent.keyDown(t.catcher()!, { key: 'Enter' });
    expect(t.editor()).toHaveValue('a.example');
  });

  it('a copy button a value draws is hidden in the select-first table, and only there', () => {
    const t = renderTable();
    expect(t.cell(0, 3).className).toContain('[&_[data-cell-copy]]:hidden');
    cleanup();
    const control = renderTable({ selection: null, extra: { keyboardNavigation: true } });
    expect(control.cell(0, 3).className).not.toContain('[data-cell-copy]');
  });
});

describe('data-table select-first — a cell that opens no editor says why', () => {
  it("the host's sentence, on a double-click and on Enter, and no editor", () => {
    const t = renderTable({
      selection: {
        describeCell: (_row, key) => (key === 'amount' ? { readOnlyReason: 'This value is calculated.' } : null),
      },
    });
    fireEvent.click(t.cell(0, 1));
    fireEvent.doubleClick(t.cell(0, 1));
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent('This value is calculated.');
    expect(t.editor()).toBeNull();
    // The next key closes it; Enter asks again.
    fireEvent.keyDown(t.catcher()!, { key: 'ArrowLeft' });
    expect(screen.queryByTestId('cell-readonly-reason')).toBeNull();
    fireEvent.keyDown(t.catcher()!, { key: 'ArrowRight' });
    fireEvent.keyDown(t.catcher()!, { key: 'Enter' });
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent('This value is calculated.');
    expect(t.editor()).toBeNull();
  });

  it("the table's own sentence when the column is not editable and the host names none", () => {
    const t = renderTable({ extra: { editable: false } });
    fireEvent.click(t.cell(0, 0));
    expect(t.cell(0, 0)).toHaveAttribute('data-selected-cell');
    fireEvent.doubleClick(t.cell(0, 0));
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent("This cell can't be edited here.");
    expect(t.editor()).toBeNull();
  });

  it('typing into a read-only cell writes nothing and says why', () => {
    const t = renderTable({ selection: { describeCell: () => ({ readOnlyReason: 'Locked.' }) } });
    fireEvent.click(t.cell(0, 0));
    fireEvent.change(t.catcher()!, { target: { value: 'x' } });
    expect(t.editor()).toBeNull();
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent('Locked.');
    expect(t.onCellChange).not.toHaveBeenCalled();
  });
});

describe('data-table select-first — no edit-only column, ever (objectstack#35554, objectstack#35685)', () => {
  const editHeader = (c: HTMLElement) => c.querySelector('[data-testid="data-table-edit-column-header"]');
  const lastHeader = (c: HTMLElement) => [...c.querySelectorAll('thead th')].pop()!;
  // The shape `ObjectGrid` hands the list page: a save path and no row menu.
  const EDIT_ONLY = { rowActions: true, onRowSave: () => Promise.resolve() };

  it('none at rest and none after a commit: the commit saves itself', () => {
    const onRowSave = vi.fn(() => Promise.resolve());
    const t = renderTable({ extra: { ...EDIT_ONLY, onRowSave } });
    expect(editHeader(t.container)).toBeNull();
    expect(lastHeader(t.container)).toHaveTextContent('Site');
    fireEvent.click(t.cell(0, 0));
    fireEvent.change(t.catcher()!, { target: { value: 'A' } });
    fireEvent.keyDown(t.editor()!, { key: 'Enter' });
    expect(editHeader(t.container)).toBeNull();
    expect(lastHeader(t.container)).toHaveTextContent('Site');
    expect(t.container.querySelector('button[title="Save row"]')).toBeNull();
    expect(onRowSave).toHaveBeenCalledTimes(1);
  });

  it('control: without the provider the column is drawn at rest, as before', () => {
    const t = renderTable({ selection: null, extra: EDIT_ONLY });
    expect(editHeader(t.container)).not.toBeNull();
    expect(lastHeader(t.container)).toBe(editHeader(t.container));
  });
});

describe('data-table select-first — a touch tap opens the record', () => {
  it('opens the record through the row and selects or edits nothing', () => {
    const t = renderTable();
    const row = t.container.querySelectorAll('tbody tr')[0];
    fireEvent.pointerDown(row, { pointerType: 'touch' });
    fireEvent.click(t.cell(0, 0));
    expect(t.onRowClick).toHaveBeenCalledTimes(1);
    expect(t.cell(0, 0)).not.toHaveAttribute('data-selected-cell');
    fireEvent.doubleClick(t.cell(0, 0));
    expect(t.editor()).toBeNull();
  });
});

describe('data-table select-first — a reference chip opens its record in place (objectstack#36015)', () => {
  const ACCOUNTS = [
    { id: '1', name: 'Alpha', account: 'acc_1', owner: 'usr_1' },
    { id: '2', name: 'Beta', account: 'acc_2', owner: 'usr_2' },
  ];
  // A chip as `ReferencedRecordLink` draws it.
  const chip = (objectName: string, recordId: string, label: string, onFollow: (id: string) => void) => (
    <span>
      <a
        href={`/${objectName}/record/${recordId}`}
        data-record-link=""
        data-record-object={objectName}
        data-record-id={recordId}
        onClick={(e) => { e.preventDefault(); onFollow(recordId); }}
      >
        {label}
      </a>
    </span>
  );
  function renderReferences({ readOnly = false, withHost = true }: { readOnly?: boolean; withHost?: boolean } = {}) {
    const DataTable = ComponentRegistry.get('data-table')!;
    const openRecord = vi.fn();
    const onFollow = vi.fn();
    const selection: GridCellSelection = {
      describeCell: (_row, columnKey) => (readOnly && columnKey === 'account' ? { readOnlyReason: 'Not here.' } : null),
      ...(withHost
        ? { referenceCells: { isReferenceColumn: (key: string) => key === 'account', openRecord } }
        : {}),
    };
    const schema = {
      type: 'data-table',
      columns: [
        { header: 'Name', accessorKey: 'name' },
        { header: 'Account', accessorKey: 'account', cell: (v: string) => chip('crm_account', v, `Account ${v}`, onFollow) },
        { header: 'Owner', accessorKey: 'owner', cell: (v: string) => chip('sys_user', v, `Person ${v}`, onFollow) },
      ],
      data: ACCOUNTS,
      editable: true,
      singleClickEdit: true,
      searchable: false,
      pagination: false,
    };
    const utils = render(
      <GridCellSelectionProvider value={selection}>
        <DataTable schema={schema} />
      </GridCellSelectionProvider>,
    );
    const cell = (row: number, col: number) =>
      utils.container.querySelectorAll('tbody tr')[row].querySelectorAll('td[data-grid-cell]')[col] as HTMLElement;
    const editor = () => utils.container.querySelector('td[data-editing-cell] input');
    const catcher = () => utils.container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]');
    const editButton = (row: number, col: number) => cell(row, col).querySelector<HTMLButtonElement>('[data-testid="cell-edit-button"]');
    return { ...utils, cell, editor, catcher, editButton, openRecord, onFollow };
  }

  it('a plain click on the chip opens its record through the host and selects the cell; the link is not followed', () => {
    const t = renderReferences();
    const plain = fireEvent.click(screen.getByText('Account acc_1'));
    expect(t.openRecord).toHaveBeenCalledWith('crm_account', 'acc_1');
    expect(t.onFollow).not.toHaveBeenCalled();
    expect(plain).toBe(false);
    expect(t.cell(0, 1)).toHaveAttribute('data-selected-cell');
    // A double-click on the chip does not also edit the cell.
    fireEvent.doubleClick(screen.getByText('Account acc_1'));
    expect(t.editor()).toBeNull();
  });

  it('a double-click on the chip opens its record once', () => {
    const t = renderReferences();
    const chipText = screen.getByText('Account acc_1');
    fireEvent.click(chipText, { detail: 1 });
    fireEvent.click(chipText, { detail: 2 });
    fireEvent.doubleClick(chipText, { detail: 2 });
    expect(t.openRecord).toHaveBeenCalledTimes(1);
    expect(t.openRecord).toHaveBeenCalledWith('crm_account', 'acc_1');
    expect(t.editor()).toBeNull();
  });

  it('a click beside the chip only selects; a Ctrl or Cmd click follows the link', () => {
    const t = renderReferences();
    fireEvent.click(t.cell(1, 1));
    expect(t.cell(1, 1)).toHaveAttribute('data-selected-cell');
    expect(t.openRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Account acc_2'), { ctrlKey: true });
    fireEvent.click(screen.getByText('Account acc_2'), { metaKey: true });
    expect(t.onFollow).toHaveBeenCalledTimes(2);
    expect(t.openRecord).not.toHaveBeenCalled();
  });

  it('Ctrl or Cmd+Enter on a selected reference cell opens its first chip through the host', () => {
    const t = renderReferences();
    fireEvent.click(t.cell(1, 1));
    fireEvent.keyDown(t.catcher()!, { key: 'Enter', ctrlKey: true });
    expect(t.openRecord).toHaveBeenCalledWith('crm_account', 'acc_2');
    expect(t.onFollow).not.toHaveBeenCalled();
    expect(t.editor()).toBeNull();
  });

  it('a reference cell draws the edit button, shown on hover and while selected; it edits and draws no open button', () => {
    const t = renderReferences();
    const button = t.editButton(0, 1)!;
    expect(button).toHaveAccessibleName('Edit');
    // Asked when the pointer enters the cell.
    expect(button.className).toContain('hidden');
    fireEvent.pointerEnter(t.cell(0, 1));
    expect(button.className).toMatch(/(^|\s)flex(\s|$)/);
    expect(button.className).toContain('group-hover/cell:opacity-100');
    fireEvent.click(t.cell(0, 1));
    expect(t.editButton(0, 1)!.className).toContain('opacity-100');
    expect(t.cell(0, 1).querySelector('[data-testid="cell-open-button"]')).toBeNull();
    fireEvent.click(t.editButton(0, 1)!);
    expect(t.editor()).not.toBeNull();
    expect(t.openRecord).not.toHaveBeenCalled();
  });

  it('a reference cell that opens no editor draws no edit button', () => {
    const t = renderReferences({ readOnly: true });
    fireEvent.pointerEnter(t.cell(0, 1));
    fireEvent.click(t.cell(0, 1));
    expect(t.editButton(0, 1)!.className).toContain('hidden');
  });

  it('a column the host does not name (a person) keeps the link behaviour: the chip only selects, the open button opens it', () => {
    const t = renderReferences();
    expect(t.editButton(0, 2)).toBeNull();
    fireEvent.click(screen.getByText('Person usr_1'));
    expect(t.openRecord).not.toHaveBeenCalled();
    expect(t.onFollow).not.toHaveBeenCalled();
    expect(t.cell(0, 2)).toHaveAttribute('data-selected-cell');
    expect(t.cell(0, 2).querySelector('[data-testid="cell-open-button"]')).not.toBeNull();
  });

  it('control: with no host reference cells, the chip only selects and no edit button is drawn', () => {
    const t = renderReferences({ withHost: false });
    fireEvent.click(screen.getByText('Account acc_1'));
    expect(t.onFollow).not.toHaveBeenCalled();
    expect(t.cell(0, 1)).toHaveAttribute('data-selected-cell');
    expect(t.editButton(0, 1)).toBeNull();
  });
});

describe('data-table select-first — a touch never edits in place (objectstack#35689)', () => {
  it('a touch tap opens the record; a touch double-tap neither selects nor edits', () => {
    const t = renderTable();
    fireEvent.pointerDown(t.cell(0, 1), { pointerType: 'touch' });
    fireEvent.click(t.cell(0, 1), { detail: 1 });
    fireEvent.pointerDown(t.cell(0, 1), { pointerType: 'touch' });
    fireEvent.click(t.cell(0, 1), { detail: 2 });
    fireEvent.doubleClick(t.cell(0, 1));
    expect(t.onRowClick).toHaveBeenCalled();
    expect(t.editor()).toBeNull();
    expect(t.cell(0, 1)).not.toHaveAttribute('data-selected-cell');
    expect(t.onCellChange).not.toHaveBeenCalled();
  });

  it("a tap on a reference cell's edit button, on a cell not selected, edits nothing; a mouse click on it edits", () => {
    const openRecord = vi.fn();
    const t = renderTable({ selection: { referenceCells: { isReferenceColumn: (key) => key === 'site', openRecord } } });
    const button = () => t.cell(0, 3).querySelector<HTMLButtonElement>('[data-testid="cell-edit-button"]')!;
    // A finger reaching the cell does not draw the button.
    fireEvent.pointerEnter(t.cell(0, 3), { pointerType: 'touch' });
    expect(button().className).toContain('hidden');
    // Drawn for a mouse before, a tap on it is still not an edit.
    fireEvent.pointerEnter(t.cell(0, 3), { pointerType: 'mouse' });
    expect(button().className).toMatch(/(^|\s)flex(\s|$)/);
    fireEvent.pointerDown(button(), { pointerType: 'touch' });
    fireEvent.click(button());
    expect(t.editor()).toBeNull();
    expect(t.cell(0, 3)).not.toHaveAttribute('data-selected-cell');
    // CONTROL: the mouse's click on the same button edits.
    fireEvent.pointerDown(button(), { pointerType: 'mouse' });
    fireEvent.click(button());
    expect(t.editor()).not.toBeNull();
  });
});

describe('data-table select-first — a touch press is read by its own click only (objectstack#35689)', () => {
  it('after a tap on the edit button, a click with no pointer of its own (assistive tech) edits', () => {
    const t = renderTable({ selection: { referenceCells: { isReferenceColumn: (key) => key === 'site', openRecord: vi.fn() } } });
    const button = () => t.cell(0, 3).querySelector<HTMLButtonElement>('[data-testid="cell-edit-button"]')!;
    fireEvent.pointerEnter(t.cell(0, 3), { pointerType: 'mouse' });
    fireEvent.pointerDown(button(), { pointerType: 'touch' });
    fireEvent.click(button());
    expect(t.editor()).toBeNull();
    fireEvent.click(button());
    expect(t.editor()).not.toBeNull();
  });
});

describe('data-table select-first — a read-only cell says so in the grid (objectstack#35689)', () => {
  it("the selected cell reads the host's facts: aria-readonly on the cell and on its focus; an editable one carries none", () => {
    const t = renderTable({
      selection: { describeCell: (_row, key) => (key === 'amount' ? { readOnlyReason: 'This value is calculated.' } : null) },
    });
    expect(t.container.querySelector('table')).toHaveAttribute('role', 'grid');
    fireEvent.click(t.cell(0, 1));
    expect(t.cell(0, 1)).toHaveAttribute('aria-readonly', 'true');
    expect(t.catcher()).toHaveAttribute('aria-readonly', 'true');
    expect(document.activeElement).toBe(t.catcher());
    fireEvent.keyDown(t.catcher()!, { key: 'ArrowLeft' });
    expect(t.cell(0, 0)).not.toHaveAttribute('aria-readonly');
    expect(t.catcher()).not.toHaveAttribute('aria-readonly');
  });

  it("the host's facts are asked as the cell becomes selected, never per render; a new host value is asked again", () => {
    const DataTable = ComponentRegistry.get('data-table')!;
    let locked = false;
    const describeCell = vi.fn((_row: unknown, key: string) => (key === 'amount' && locked ? { readOnlyReason: 'Locked.' } : null));
    const schemaOf = () => ({
      type: 'data-table',
      columns: [{ header: 'Name', accessorKey: 'name' }, { header: 'Amount', accessorKey: 'amount', type: 'number' }],
      data: ROWS,
      editable: true,
      searchable: false,
      pagination: false,
    });
    const Host = ({ value, schema }: { value: GridCellSelection; schema: Record<string, unknown> }) => (
      <GridCellSelectionProvider value={value}><DataTable schema={schema} /></GridCellSelectionProvider>
    );
    const value = { describeCell };
    const utils = render(<Host value={value} schema={schemaOf()} />);
    const amount = () => utils.container.querySelectorAll('tbody tr')[0].querySelectorAll('td[data-grid-cell]')[1];
    fireEvent.click(amount());
    expect(amount()).toHaveAttribute('data-selected-cell');
    expect(amount()).not.toHaveAttribute('aria-readonly');
    const asked = describeCell.mock.calls.length;
    expect(asked).toBeGreaterThan(0);
    // The table renders again, three times, with nothing the answer reads changed.
    for (let i = 0; i < 3; i++) utils.rerender(<Host value={value} schema={schemaOf()} />);
    expect(describeCell).toHaveBeenCalledTimes(asked);
    // The host's answer changed and it hands a new value: the cell says so
    // where it is, without the reader moving.
    locked = true;
    utils.rerender(<Host value={{ describeCell }} schema={schemaOf()} />);
    expect(amount()).toHaveAttribute('data-selected-cell');
    expect(amount()).toHaveAttribute('aria-readonly', 'true');
    expect(utils.container.querySelector('[data-slot="cell-type-catcher"]')).toHaveAttribute('aria-readonly', 'true');
  });

  it("every cell of a table that edits nothing is read-only, by the table's own facts", () => {
    const t = renderTable({ extra: { editable: false } });
    const cells = [...t.container.querySelectorAll('td[data-grid-cell]')];
    expect(cells.length).toBe(ROWS.length * 4);
    for (const td of cells) expect(td).toHaveAttribute('aria-readonly', 'true');
  });

  it('CONTROL: outside the grid no cell carries aria-readonly', () => {
    const t = renderTable({ selection: null, extra: { editable: false } });
    expect(t.container.querySelector('table')).not.toHaveAttribute('role');
    expect(t.container.querySelector('[aria-readonly]')).toBeNull();
  });
});
