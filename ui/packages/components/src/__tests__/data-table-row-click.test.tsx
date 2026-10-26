/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: row.onClick must NOT fire when the click originates from a
 * Radix overlay (DropdownMenu, Dialog, etc.) rendered in a Portal but still
 * bubbling up the React virtual tree.
 *
 * Bug context: in the CRM list page (e.g. /apps/crm_enterprise/lead) clicking
 * "Edit" inside a row's "..." dropdown used to navigate to the record detail
 * page because the click event bubbled up through React's synthetic tree to
 * the <TableRow> onClick handler which calls onRowClick.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';
import type { DataTableSchema } from '@object-ui/types';

/**
 * Types a literal below as the node it is rather than as the `BaseSchema`
 * `renderComponent` accepts (objectui#11347): since objectui#8347 removed
 * `BaseSchema`'s index signature, a literal checked against `BaseSchema`
 * may author only `BaseSchema`'s own keys.
 */
const dataTableNode = (schema: DataTableSchema): DataTableSchema => schema;

describe('data-table — row click heuristic ignores overlay items', () => {
  const baseSchema = {
    type: 'data-table' as const,
    columns: [
      { header: 'Name', accessorKey: 'name' },
      {
        header: 'Actions',
        accessorKey: '_actions',
        // Render a portal-like menu item directly inside the row to mimic
        // a Radix DropdownMenuItem that has bubbled into the row React tree.
        cell: () => (
          <div role="menu">
            <div role="menuitem" data-testid="row-edit-item">
              Edit
            </div>
          </div>
        ),
      },
    ],
    data: [{ id: '1', name: 'Alice' }],
  } as any;

  it('clicking [role="menuitem"] does not call onRowClick', () => {
    const onRowClick = vi.fn();
    const { container } = renderComponent({ ...baseSchema, onRowClick });

    const item = container.querySelector('[data-testid="row-edit-item"]') as HTMLElement;
    expect(item).toBeTruthy();
    fireEvent.click(item);

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('clicking a [role="dialog"] descendant inside the row does not call onRowClick', () => {
    const onRowClick = vi.fn();
    const schema = {
      ...baseSchema,
      columns: [
        baseSchema.columns[0],
        {
          header: 'Confirm',
          accessorKey: '_dialog',
          cell: () => (
            <div role="dialog">
              <span data-testid="dialog-text">Are you sure?</span>
            </div>
          ),
        },
      ],
      onRowClick,
    };
    const r = renderComponent(schema);
    const dialogText = r.container.querySelector('[data-testid="dialog-text"]') as HTMLElement;
    fireEvent.click(dialogText);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('clicking a plain text cell still calls onRowClick (sanity)', () => {
    const onRowClick = vi.fn();
    const { container } = renderComponent(dataTableNode({
      type: 'data-table',
      columns: [{ header: 'Name', accessorKey: 'name' }],
      data: [{ id: '1', name: 'Alice' }],
      onRowClick,
    }));

    // Click on the name cell text (not a button/link/menu).
    const cell = Array.from(container.querySelectorAll('td')).find((td) =>
      td.textContent?.includes('Alice')
    ) as HTMLElement;
    expect(cell).toBeTruthy();
    fireEvent.click(cell);

    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
