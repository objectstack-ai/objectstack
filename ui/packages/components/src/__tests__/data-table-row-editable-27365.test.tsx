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
 *   - no trigger opens an editor on it — click, double-click, Enter;
 *   - its cells take no edit cursor, and a click on them is NOT swallowed, so
 *     the row's own click (ObjectGrid's record drawer) still fires;
 *   - every other row is untouched, and with no predicate every row is
 *     editable exactly as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` (objectui#3010).
import '../renderers';

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

const refuseOther = (row: { id: string }) => row.id !== 'other';

describe('data-table — isRowEditable narrows editing per row (objectstack#27365)', () => {
  it('a refused row opens no editor on click, and its click reaches the row', () => {
    const onRowClick = vi.fn();
    const { container } = renderComponent(
      baseSchema({ singleClickEdit: true, isRowEditable: refuseOther, onRowClick }),
    );
    const cell = cellOf(container, 'Legacy Sunset');
    expect(cell).not.toHaveClass('cursor-text');
    fireEvent.click(cell);
    expect(cell.querySelector('input')).toBeNull();
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('a refused row opens no editor on double-click', () => {
    const { container } = renderComponent(baseSchema({ isRowEditable: refuseOther }));
    const cell = cellOf(container, 'Legacy Sunset');
    fireEvent.doubleClick(cell);
    expect(cell.querySelector('input')).toBeNull();
  });

  it('a refused row opens no editor on Enter', () => {
    const { container } = renderComponent(baseSchema({ isRowEditable: refuseOther }));
    const cell = cellOf(container, 'Legacy Sunset');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(cell.querySelector('input')).toBeNull();
  });

  it('CONTROL: the allowed row of the same table still opens its editor, on each trigger', () => {
    const { container } = renderComponent(
      baseSchema({ singleClickEdit: true, isRowEditable: refuseOther }),
    );
    const cell = cellOf(container, 'My Project');
    expect(cell).toHaveClass('cursor-text');
    fireEvent.click(cell);
    expect(cell.querySelector('input')).not.toBeNull();
  });

  it('CONTROL: Enter on the allowed row opens its editor', () => {
    const { container } = renderComponent(baseSchema({ isRowEditable: refuseOther }));
    const cell = cellOf(container, 'My Project');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(cell.querySelector('input')).not.toBeNull();
  });

  it('CONTROL: with no predicate every row is editable, as before', () => {
    const { container } = renderComponent(baseSchema({ singleClickEdit: true }));
    const cell = cellOf(container, 'Legacy Sunset');
    fireEvent.click(cell);
    expect(cell.querySelector('input')).not.toBeNull();
  });

  it('narrows only: a predicate answering `true` cannot open a table that is not `editable`', () => {
    const { container } = renderComponent(
      baseSchema({ editable: false, singleClickEdit: true, isRowEditable: () => true }),
    );
    const cell = cellOf(container, 'My Project');
    fireEvent.click(cell);
    expect(cell.querySelector('input')).toBeNull();
  });
});
