/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28923 — the `data-table` row ⋯ trigger is visible at rest.
 *
 * The table draws an `Actions` header whenever rows carry actions, so a
 * trigger hidden until the pointer reaches a row left a headed column of cells
 * that looked empty, read as "no actions available". As the list grid's
 * `RowActionMenu` does since objectstack#28871, the trigger is now drawn on
 * every row at rest in the muted tone, on every pointer type alike, and rises
 * to full strength on row hover, focus-within, a selected row, its own focus,
 * an open menu and a coarse pointer (which cannot hover).
 *
 * jsdom applies no stylesheet, so "visible" is read off the classes that decide
 * it: no `opacity-0` / `invisible` / `hidden` at rest, the muted tone as the
 * resting colour, and the variants that lift it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
import '../data-table';

const ROWS = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Grace' },
];

function renderTable() {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(
    <PredicateScopeProvider scope={{}}>
      <DataTable
        schema={{
          type: 'data-table',
          data: ROWS,
          pagination: false,
          searchable: false,
          columns: [{ header: 'Name', accessorKey: 'name' }],
          rowActions: true,
          onRowEdit: vi.fn(),
        }}
      />
    </PredicateScopeProvider>,
  );
}

const classesOf = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean);

describe('data-table row-actions trigger at rest (objectstack#28923)', () => {
  it('is drawn at rest on every row: nothing hides it before the pointer reaches the row', () => {
    renderTable();
    const triggers = screen.getAllByTestId('data-table-row-actions');
    expect(triggers).toHaveLength(ROWS.length);
    for (const trigger of triggers) {
      for (const hiding of ['opacity-0', 'invisible', 'hidden', 'sr-only']) {
        expect(trigger).not.toHaveClass(hiding);
      }
      // No zero opacity under any variant either: a hover reveal written as
      // `opacity-0 hover:opacity-100` is still empty at rest.
      expect(classesOf(trigger).filter((c) => /(^|:)opacity-0$/.test(c))).toEqual([]);
      expect(trigger).toHaveAccessibleName('Row actions');
    }
  });

  it('rests in the muted tone and lifts to full strength on hover, focus, selection and an open menu', () => {
    renderTable();
    for (const trigger of screen.getAllByTestId('data-table-row-actions')) {
      expect(trigger).toHaveClass(
        'text-muted-foreground',
        'group-hover/row:text-foreground',
        'group-focus-within/row:text-foreground',
        'group-data-[state=selected]/row:text-foreground',
        'data-[state=open]:text-foreground',
        'focus-visible:text-foreground',
      );
    }
  });

  it('is drawn at rest on every pointer type alike; a coarse pointer, which cannot hover, gets full strength', () => {
    renderTable();
    for (const trigger of screen.getAllByTestId('data-table-row-actions')) {
      // The coarse pointer only strengthens the tone; it is never the thing
      // that makes the trigger appear.
      expect(classesOf(trigger).filter((c) => c.startsWith('pointer-coarse:'))).toEqual([
        'pointer-coarse:text-foreground',
      ]);
    }
  });

  it('control: the open menu marks the trigger open, the state the full-strength variant keys on', async () => {
    renderTable();
    const [trigger] = screen.getAllByTestId('data-table-row-actions');
    expect(trigger).toHaveAttribute('data-state', 'closed');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('data-state', 'open');
    expect(await screen.findByRole('menuitem', { name: /edit/i })).toBeInTheDocument();
  });
});
