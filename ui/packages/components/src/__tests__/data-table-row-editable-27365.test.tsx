/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27365 — `DataTableSchema.isRowEditable`, the host's per-row
 * inline-edit verdict.
 *
 * `editable` and the per-column locks answer for every row alike. A host that
 * knows one row is refused by the server (ObjectGrid, from the record-grained
 * write verdict) hands the table a per-row predicate; a row it answers `false`
 * for must read exactly like a row of a read-only table:
 *
 *   - no trigger opens an editor on it — double-click, Enter, typing;
 *   - every other row is untouched, and with no predicate every row is
 *     editable exactly as before.
 *
 * Mounted select-first with a per-cell save, the one way the table edits
 * (objectstack#35827): a click selects a cell on any row, editable or not.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderSelectFirstTable } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` (objectui#3010).
import '../renderers';
// `react-page` reaches a dynamic `import('@object-ui/react-runtime')`: pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@object-ui/react-runtime';

const ROWS = [
  { id: 'own', name: 'My Project' },
  { id: 'other', name: 'Legacy Sunset' },
];

const baseSchema = (extra: Record<string, unknown> = {}) =>
  ({
    type: 'data-table' as const,
    editable: true,
    columns: [{ header: 'Name', accessorKey: 'name' }],
    data: ROWS,
    ...extra,
  }) as any;

/** The `<td>` showing `text`. */
const cellOf = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('tbody td')).find(
    (td) => td.textContent?.trim() === text,
  ) as HTMLElement;

const editor = (container: HTMLElement) => container.querySelector('td[data-editing-cell] input');
const catcher = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;

const refuseOther = (row: { id: string }) => row.id !== 'other';

describe('data-table — isRowEditable narrows editing per row (objectstack#27365)', () => {
  it('a refused row opens no editor on double-click', () => {
    const { container } = renderSelectFirstTable(baseSchema({ isRowEditable: refuseOther }));
    const cell = cellOf(container, 'Legacy Sunset');
    fireEvent.click(cell);
    fireEvent.doubleClick(cell);
    expect(editor(container)).toBeNull();
  });

  it('a refused row opens no editor on Enter or on a typed key', () => {
    const { container } = renderSelectFirstTable(baseSchema({ isRowEditable: refuseOther }));
    fireEvent.click(cellOf(container, 'Legacy Sunset'));
    fireEvent.keyDown(catcher(container), { key: 'Enter' });
    expect(editor(container)).toBeNull();
    fireEvent.change(catcher(container), { target: { value: 'x' } });
    expect(editor(container)).toBeNull();
  });

  it('CONTROL: the allowed row of the same table still opens its editor on double-click', () => {
    const { container } = renderSelectFirstTable(baseSchema({ isRowEditable: refuseOther }));
    const cell = cellOf(container, 'My Project');
    fireEvent.click(cell);
    fireEvent.doubleClick(cell);
    expect(editor(container)).not.toBeNull();
  });

  it('CONTROL: Enter on the allowed row opens its editor', () => {
    const { container } = renderSelectFirstTable(baseSchema({ isRowEditable: refuseOther }));
    fireEvent.click(cellOf(container, 'My Project'));
    fireEvent.keyDown(catcher(container), { key: 'Enter' });
    expect(editor(container)).not.toBeNull();
  });

  it('CONTROL: with no predicate every row is editable, as before', () => {
    const { container } = renderSelectFirstTable(baseSchema());
    const cell = cellOf(container, 'Legacy Sunset');
    fireEvent.click(cell);
    fireEvent.doubleClick(cell);
    expect(editor(container)).not.toBeNull();
  });

  it('narrows only: a predicate answering `true` cannot open a table that is not `editable`', () => {
    const { container } = renderSelectFirstTable(
      baseSchema({ editable: false, isRowEditable: () => true }),
    );
    const cell = cellOf(container, 'My Project');
    fireEvent.click(cell);
    fireEvent.doubleClick(cell);
    expect(editor(container)).toBeNull();
  });
});
