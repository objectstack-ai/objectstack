/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27807 — with some rows selected, the header's select-all is
 * announced as mixed AND drawn as a dash, never as the check mark that means
 * "all selected". Controls: all selected draws the check; none draws nothing.
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

function renderTable() {
  const DataTable = ComponentRegistry.get('data-table') as any;
  return render(
    <DataTable
      schema={{
        data: [
          { id: 'a', name: 'Ada' },
          { id: 'b', name: 'Grace' },
          { id: 'c', name: 'Linus' },
        ],
        pagination: false,
        searchable: false,
        selectable: true,
        columns: [{ header: 'Name', accessorKey: 'name' }],
      }}
    />,
  );
}

function selectAllOf(container: HTMLElement) {
  return container.querySelector('thead [data-slot="select-all"] [role="checkbox"]') as HTMLElement;
}

function rowCheckboxes(container: HTMLElement) {
  return Array.from(container.querySelectorAll('tbody [data-slot="row-select"] [role="checkbox"]')) as HTMLElement[];
}

describe('data-table select-all mixed state (objectstack#27807)', () => {
  it('a partial selection draws the dash, not the check, and stays aria-checked="mixed"', () => {
    const { container } = renderTable();
    const rows = rowCheckboxes(container);
    expect(rows).toHaveLength(3);
    fireEvent.click(rows[0]);
    const header = selectAllOf(container);
    expect(header).toHaveAttribute('aria-checked', 'mixed');
    expect(header.querySelector('[data-glyph="dash"]')).not.toBeNull();
    expect(header.querySelector('[data-glyph="check"]')).toBeNull();
  });

  it('control: all rows selected draws the check', () => {
    const { container } = renderTable();
    for (const row of rowCheckboxes(container)) fireEvent.click(row);
    const header = selectAllOf(container);
    expect(header).toHaveAttribute('aria-checked', 'true');
    expect(header.querySelector('[data-glyph="check"]')).not.toBeNull();
    expect(header.querySelector('[data-glyph="dash"]')).toBeNull();
  });

  it('control: no rows selected draws nothing', () => {
    const { container } = renderTable();
    const header = selectAllOf(container);
    expect(header).toHaveAttribute('aria-checked', 'false');
    expect(header.querySelector('svg')).toBeNull();
  });
});
